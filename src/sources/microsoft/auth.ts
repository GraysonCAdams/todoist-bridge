/**
 * Microsoft Authentication using MSAL
 * Uses Device Code Flow for easy CLI authentication
 */

import {
  PublicClientApplication,
  Configuration,
  DeviceCodeRequest,
  SilentFlowRequest,
  AccountInfo,
  AuthenticationResult,
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
 * Token storage format
 */
export interface MicrosoftToken {
  accessToken: string;
  expiresOn: string; // ISO date string
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

    // Initialize MSAL if needed
    if (!this.msalApp) {
      this.initializeMsal();
    }

    // Try to load existing token and acquire silently
    const savedToken = this.loadToken();
    if (savedToken?.account) {
      try {
        this.currentAccount = this.reconstructAccountInfo(savedToken.account);
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

  private initializeMsal(): void {
    if (!this.config.client_id) {
      throw new Error(
        'Microsoft client_id not configured. ' +
        'Create an Azure App Registration and add the client_id to your config.'
      );
    }

    const msalConfig: Configuration = {
      auth: {
        clientId: this.config.client_id,
        authority: `https://login.microsoftonline.com/${this.config.tenant_id || 'common'}`,
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

  private reconstructAccountInfo(savedAccount: MicrosoftToken['account']): AccountInfo {
    return {
      homeAccountId: savedAccount.homeAccountId,
      environment: savedAccount.environment,
      tenantId: savedAccount.tenantId,
      username: savedAccount.username,
      localAccountId: savedAccount.localAccountId,
      name: savedAccount.name,
      idTokenClaims: undefined,
      nativeAccountId: undefined,
      authorityType: 'MSSTS',
    };
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
        await this.saveToken(result);
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
    await this.saveToken(result);
    this.logger.info('Microsoft authentication successful');
    return result;
  }

  private cacheToken(result: AuthenticationResult): void {
    this.cachedAccessToken = result.accessToken;
    this.tokenExpiresAt = result.expiresOn?.getTime() || Date.now() + 3600000;
  }

  private loadToken(): MicrosoftToken | null {
    const tokenPath = this.config.token_path;
    if (!existsSync(tokenPath)) {
      return null;
    }

    try {
      const content = readFileSync(tokenPath, 'utf-8');
      const token: MicrosoftToken = JSON.parse(content);

      // Check if token is expired (with 5 minute buffer)
      const expiresOn = new Date(token.expiresOn);
      if (Date.now() >= expiresOn.getTime() - 300000) {
        this.logger.debug('Saved token is expired or expiring soon');
        // Don't return null - we can still use the account info for silent refresh
      }

      return token;
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to load Microsoft token');
      return null;
    }
  }

  private async saveToken(result: AuthenticationResult): Promise<void> {
    const tokenPath = this.config.token_path;
    const dir = dirname(tokenPath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const token: MicrosoftToken = {
      accessToken: result.accessToken,
      expiresOn: result.expiresOn?.toISOString() || new Date(Date.now() + 3600000).toISOString(),
      account: result.account ? {
        homeAccountId: result.account.homeAccountId,
        environment: result.account.environment,
        tenantId: result.account.tenantId,
        username: result.account.username,
        localAccountId: result.account.localAccountId,
        name: result.account.name,
      } : {
        homeAccountId: '',
        environment: '',
        tenantId: '',
        username: '',
        localAccountId: '',
      },
      scopes: result.scopes,
    };

    writeFileSync(tokenPath, JSON.stringify(token, null, 2));
    this.logger.debug('Microsoft token saved');
  }

  /**
   * Get the current user's ID (for assignment in shared lists)
   */
  async getCurrentUserId(): Promise<string | null> {
    const token = this.loadToken();
    return token?.account?.localAccountId || null;
  }
}
