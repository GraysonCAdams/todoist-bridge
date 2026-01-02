/**
 * Microsoft Authentication using MSAL
 * Uses Device Code Flow for easy CLI authentication
 *
 * IMPORTANT: Uses MSAL's cache plugin to persist refresh tokens.
 * This ensures silent token refresh works across container restarts.
 */

import {
  PublicClientApplication,
  Configuration,
  DeviceCodeRequest,
  SilentFlowRequest,
  AccountInfo,
  AuthenticationResult,
  ICachePlugin,
  TokenCacheContext,
} from '@azure/msal-node';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Logger } from '../../utils/logger.js';
import type { MicrosoftSourceConfig } from './types.js';

// Microsoft Graph scopes for To-Do access
const SCOPES = [
  'Tasks.ReadWrite',
  'User.Read',
  'offline_access',
];

/**
 * Legacy token storage format (for migration)
 */
interface LegacyMicrosoftToken {
  accessToken: string;
  expiresOn: string;
  account: {
    homeAccountId: string;
    environment: string;
    tenantId: string;
    username: string;
    localAccountId: string;
    name?: string;
  };
  scopes: string[];
}

/**
 * New token storage format - stores MSAL's full cache
 */
interface MicrosoftTokenCache {
  version: 2;
  msalCache: string; // MSAL's serialized cache
  accountHomeId?: string; // For quick account lookup
}

export class MicrosoftAuth {
  private config: MicrosoftSourceConfig;
  private logger: Logger;
  private msalApp: PublicClientApplication | null = null;
  private currentAccount: AccountInfo | null = null;
  private cachedAccessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config: MicrosoftSourceConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Get authenticated access token for Microsoft Graph API
   */
  async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 5 min buffer)
    if (this.cachedAccessToken && Date.now() < this.tokenExpiresAt - 300000) {
      return this.cachedAccessToken;
    }

    // Initialize MSAL if needed (loads cache from disk)
    if (!this.msalApp) {
      await this.initializeMsal();
    }

    // Try to acquire token silently first (uses MSAL's internal cache with refresh token)
    const accounts = await this.msalApp!.getTokenCache().getAllAccounts();
    if (accounts.length > 0) {
      this.currentAccount = accounts[0];
      try {
        const silentResult = await this.acquireTokenSilent();
        if (silentResult) {
          this.cacheToken(silentResult);
          return silentResult.accessToken;
        }
      } catch (error) {
        this.logger.debug({ err: error }, 'Silent token acquisition failed, need interactive auth');
      }
    }

    // No valid token, need interactive authentication
    this.logger.info('No valid Microsoft token found, starting device code flow...');
    const result = await this.acquireTokenDeviceCode();
    this.cacheToken(result);
    return result.accessToken;
  }

  /**
   * Create MSAL cache plugin that persists to disk
   */
  private createCachePlugin(): ICachePlugin {
    const tokenPath = this.config.token_path;
    const logger = this.logger;

    return {
      beforeCacheAccess: async (cacheContext: TokenCacheContext): Promise<void> => {
        // Load cache from disk if it exists
        if (existsSync(tokenPath)) {
          try {
            const content = readFileSync(tokenPath, 'utf-8');
            const parsed = JSON.parse(content);

            // Handle new format (version 2)
            if (parsed.version === 2 && parsed.msalCache) {
              cacheContext.tokenCache.deserialize(parsed.msalCache);
            }
            // Legacy format - will need re-auth (can't migrate refresh token)
            else if (parsed.accessToken) {
              logger.info('Found legacy token format, re-authentication required for refresh token support');
            }
          } catch (error) {
            logger.warn({ err: error }, 'Failed to load Microsoft token cache');
          }
        }
      },

      afterCacheAccess: async (cacheContext: TokenCacheContext): Promise<void> => {
        // Save cache to disk if it changed
        if (cacheContext.cacheHasChanged) {
          const dir = dirname(tokenPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }

          const cacheData: MicrosoftTokenCache = {
            version: 2,
            msalCache: cacheContext.tokenCache.serialize(),
          };

          writeFileSync(tokenPath, JSON.stringify(cacheData, null, 2));
          logger.debug('Microsoft token cache saved');
        }
      },
    };
  }

  private async initializeMsal(): Promise<void> {
    if (!this.config.client_id) {
      throw new Error(
        'Microsoft client_id not configured. ' +
        'Create an Azure App Registration and add the client_id to your config.'
      );
    }

    const cachePlugin = this.createCachePlugin();

    const msalConfig: Configuration = {
      auth: {
        clientId: this.config.client_id,
        authority: `https://login.microsoftonline.com/${this.config.tenant_id || 'common'}`,
      },
      cache: {
        cachePlugin,
      },
      system: {
        loggerOptions: {
          logLevel: 0, // Error only
          piiLoggingEnabled: false,
        },
      },
    };

    this.msalApp = new PublicClientApplication(msalConfig);
  }

  private async acquireTokenSilent(): Promise<AuthenticationResult | null> {
    if (!this.msalApp || !this.currentAccount) return null;

    const silentRequest: SilentFlowRequest = {
      account: this.currentAccount,
      scopes: SCOPES,
    };

    try {
      const result = await this.msalApp.acquireTokenSilent(silentRequest);
      if (result) {
        this.logger.info('Microsoft token refreshed silently');
        return result;
      }
      return null;
    } catch (error) {
      this.logger.debug({ err: error }, 'Silent acquisition failed');
      return null;
    }
  }

  /**
   * Device Code Flow - User enters code at microsoft.com/devicelogin
   */
  private async acquireTokenDeviceCode(): Promise<AuthenticationResult> {
    if (!this.msalApp) {
      throw new Error('MSAL app not initialized');
    }

    const deviceCodeRequest: DeviceCodeRequest = {
      scopes: SCOPES,
      deviceCodeCallback: (response) => {
        console.log('\n==========================================');
        console.log('Microsoft Authorization Required');
        console.log('==========================================');
        console.log(`\n${response.message}`);
        console.log('\n==========================================\n');
      },
    };

    const result = await this.msalApp.acquireTokenByDeviceCode(deviceCodeRequest);

    if (!result) {
      throw new Error('Device code authentication failed - no result returned');
    }

    this.currentAccount = result.account;
    this.logger.info('Microsoft authentication successful');
    return result;
  }

  private cacheToken(result: AuthenticationResult): void {
    this.cachedAccessToken = result.accessToken;
    this.tokenExpiresAt = result.expiresOn?.getTime() || Date.now() + 3600000;
  }

  /**
   * Get the current user's ID (for assignment in shared lists)
   */
  async getCurrentUserId(): Promise<string | null> {
    if (!this.msalApp) {
      await this.initializeMsal();
    }
    const accounts = await this.msalApp!.getTokenCache().getAllAccounts();
    return accounts[0]?.localAccountId || null;
  }
}
