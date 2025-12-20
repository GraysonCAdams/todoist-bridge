import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'url';
import { randomBytes } from 'node:crypto';
import type { Logger } from '../../utils/logger.js';
import type { GoogleSourceConfig } from './types.js';

// my.home-assistant.io OAuth redirect URL
const MY_HA_REDIRECT_URL = 'https://my.home-assistant.io/redirect/oauth';
// Path that my.home-assistant.io redirects to on user's server
const MY_HA_CALLBACK_PATH = '/auth/external/callback';

interface Credentials {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

interface Token {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string;
  expiry_date?: number | null;
}

const SCOPES = ['https://www.googleapis.com/auth/tasks'];

// Success page HTML
const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Successful</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 400px;
    }
    .icon {
      width: 80px;
      height: 80px;
      background: #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .icon svg { width: 40px; height: 40px; fill: white; }
    h1 { color: #1f2937; font-size: 24px; margin-bottom: 12px; }
    p { color: #6b7280; line-height: 1.6; }
    .hint { margin-top: 24px; font-size: 14px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
    </div>
    <h1>Authorization Successful!</h1>
    <p>Your Google account has been connected successfully. You can close this window.</p>
    <p class="hint">Task synchronization will begin automatically.</p>
  </div>
  <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`;

export class GoogleAuth {
  private config: GoogleSourceConfig;
  private logger: Logger;
  private oauth2Client: OAuth2Client | null = null;
  private server: Server | null = null;

  constructor(config: GoogleSourceConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async getAuthenticatedClient(): Promise<OAuth2Client> {
    // Load credentials
    const credentialsPath = this.config.credentials_path;
    if (!existsSync(credentialsPath)) {
      throw new Error(
        `Google credentials not found at ${credentialsPath}. ` +
        'Download OAuth credentials from Google Cloud Console.'
      );
    }

    const credentialsContent = readFileSync(credentialsPath, 'utf-8');
    const credentials: Credentials = JSON.parse(credentialsContent);

    const { client_id, client_secret } =
      credentials.installed || credentials.web || {};

    if (!client_id || !client_secret) {
      throw new Error('Invalid credentials file: missing client_id or client_secret');
    }

    // Determine redirect URI based on configuration
    const useMyHA = this.config.use_homeassistant_redirect ?? false;
    const redirectUri = useMyHA ? MY_HA_REDIRECT_URL : (this.config.oauth_redirect_url || 'http://localhost:3000/oauth/google/callback');

    this.oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri
    );

    // Try to load existing token
    const tokenPath = this.config.token_path;
    if (existsSync(tokenPath)) {
      const tokenContent = readFileSync(tokenPath, 'utf-8');
      const token: Token = JSON.parse(tokenContent);
      this.oauth2Client.setCredentials(token);

      // Check if token is expired and refresh if needed
      if (this.isTokenExpired(token)) {
        this.logger.info('Google token expired, refreshing...');
        await this.refreshToken();
      }

      this.logger.info('Google authentication successful (using saved token)');
      return this.oauth2Client;
    }

    // No token exists, need to authorize
    this.logger.info('No Google token found, starting authorization flow...');
    return this.authorizeInteractive(client_id, client_secret, useMyHA);
  }

  private isTokenExpired(token: Token): boolean {
    if (!token.expiry_date) return false;
    // Add 1 minute buffer
    return Date.now() >= token.expiry_date - 60000;
  }

  private async refreshToken(): Promise<void> {
    if (!this.oauth2Client) throw new Error('OAuth client not initialized');

    const { credentials } = await this.oauth2Client.refreshAccessToken();
    this.oauth2Client.setCredentials(credentials);
    await this.saveToken(credentials as unknown as Token);
    this.logger.info('Google token refreshed successfully');
  }

  private async authorizeInteractive(clientId: string, clientSecret: string, useMyHA: boolean): Promise<OAuth2Client> {
    const port = this.config.oauth_port || 3000;

    if (useMyHA) {
      // Using my.home-assistant.io redirect flow
      return this.runMyHAOAuthFlow(clientId, clientSecret, port);
    }

    // Standard OAuth flow with configurable or auto-detected redirect
    const callbackPath = this.config.oauth_callback_path || '/oauth/google/callback';
    const redirectUri = this.config.oauth_redirect_url || `http://localhost:${port}${callbackPath}`;

    return this.runStandardOAuthFlow(clientId, clientSecret, redirectUri, port, callbackPath);
  }

  /**
   * OAuth flow using my.home-assistant.io as the redirect proxy.
   * This works like Home Assistant addons - Google redirects to my.home-assistant.io,
   * which then redirects to the user's server at /auth/external/callback.
   */
  private async runMyHAOAuthFlow(clientId: string, clientSecret: string, port: number): Promise<OAuth2Client> {
    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, MY_HA_REDIRECT_URL);

    // Generate state for CSRF protection
    const state = randomBytes(32).toString('hex');

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state,
    });

    // Start server and wait for callback on the my.home-assistant.io callback path
    const code = await this.waitForAuthCallback(port, MY_HA_CALLBACK_PATH, state, true);

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    await this.saveToken(tokens as unknown as Token);

    this.logger.info('Google authorization successful (via my.home-assistant.io)');
    return this.oauth2Client;
  }

  /**
   * Standard OAuth flow with direct redirect to user's server.
   */
  private async runStandardOAuthFlow(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    port: number,
    callbackPath: string
  ): Promise<OAuth2Client> {
    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    // Generate state for CSRF protection
    const state = randomBytes(32).toString('hex');

    // Start server and wait for callback
    const code = await this.waitForAuthCallback(port, callbackPath, state, false);

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    await this.saveToken(tokens as unknown as Token);

    this.logger.info('Google authorization successful');
    return this.oauth2Client;
  }

  private async waitForAuthCallback(
    port: number,
    callbackPath: string,
    expectedState: string,
    isMyHAFlow: boolean
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let authUrl: string | null = null;

      this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (!req.url) {
            res.writeHead(400);
            res.end('Bad request');
            return;
          }

          const url = new URL(req.url, `http://localhost:${port}`);

          // Handle the callback path
          if (url.pathname === callbackPath) {
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`<html><body><h1>Authorization Failed</h1><p>Error: ${error}</p></body></html>`);
              this.server?.close();
              reject(new Error(`OAuth error: ${error}`));
              return;
            }

            // Verify state to prevent CSRF (skip for my.home-assistant.io flow as state may be transformed)
            if (!isMyHAFlow && state !== expectedState) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`<html><body><h1>Authorization Failed</h1><p>Invalid state parameter</p></body></html>`);
              this.server?.close();
              reject(new Error('Invalid state parameter'));
              return;
            }

            if (code) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(SUCCESS_HTML);
              this.server?.close();
              resolve(code);
              return;
            }

            res.writeHead(400);
            res.end('Missing authorization code');
            return;
          }

          // For any other path, redirect to auth URL if available
          if (authUrl) {
            res.writeHead(302, { Location: authUrl });
            res.end();
          } else {
            res.writeHead(404);
            res.end('Not found');
          }
        } catch (error) {
          res.writeHead(500);
          res.end('Internal error');
          reject(error);
        }
      });

      this.server.listen(port, '0.0.0.0', () => {
        // Generate the auth URL after server is listening
        authUrl = this.oauth2Client!.generateAuthUrl({
          access_type: 'offline',
          scope: SCOPES,
          prompt: 'consent',
          state: expectedState,
        });

        this.logger.info({ port, callbackPath }, `OAuth callback server listening`);

        console.log('\n==========================================');
        console.log('Google Authorization Required');
        console.log('==========================================');

        if (isMyHAFlow) {
          console.log('\nUsing my.home-assistant.io OAuth redirect.');
          console.log('\nBefore proceeding, ensure you have:');
          console.log('1. Set your server URL at https://my.home-assistant.io');
          console.log(`2. Your server is accessible on port ${port}`);
          console.log('\nThen visit this URL to authorize:\n');
        } else {
          console.log('\nVisit this URL to authorize:\n');
        }

        console.log(authUrl);
        console.log('\n==========================================\n');
      });

      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        this.server?.close();
        reject(new Error('Authorization timeout (5 minutes)'));
      }, 300000);

      this.server.on('close', () => {
        clearTimeout(timeout);
      });

      this.server.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`OAuth server error: ${err.message}`));
      });
    });
  }

  private async saveToken(token: Token): Promise<void> {
    const tokenPath = this.config.token_path;
    const dir = dirname(tokenPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(tokenPath, JSON.stringify(token, null, 2));
    this.logger.debug('Google token saved');
  }
}
