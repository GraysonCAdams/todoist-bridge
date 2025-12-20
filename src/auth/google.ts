import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createInterface } from 'readline';
import { createServer } from 'http';
import { URL } from 'url';
import type { Config } from '../config.js';
import type { Logger } from '../utils/logger.js';

// Redirect URI for Desktop/Installed apps (Loopback IP)
const REDIRECT_URI = 'http://localhost:3000';

// Port for the web-based auth code entry (used in Docker/non-interactive mode)
const AUTH_WEB_PORT = 3000;

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

export class GoogleAuth {
  private config: Config;
  private logger: Logger;
  private oauth2Client: OAuth2Client | null = null;

  constructor(config: Config, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async getAuthenticatedClient(): Promise<OAuth2Client> {
    // Load credentials
    const credentialsPath = this.config.sources.google.credentials_path;
    if (!existsSync(credentialsPath)) {
      throw new Error(
        `Google credentials not found at ${credentialsPath}. ` +
        'Download OAuth credentials from Google Cloud Console.'
      );
    }

    const credentialsContent = readFileSync(credentialsPath, 'utf-8');
    const credentials: Credentials = JSON.parse(credentialsContent);

    const { client_id, client_secret, redirect_uris } =
      credentials.installed || credentials.web || {};

    if (!client_id || !client_secret) {
      throw new Error('Invalid credentials file: missing client_id or client_secret');
    }

    // Use Loopback redirect URI for Desktop/Installed app flow
    this.oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      REDIRECT_URI
    );

    // Try to load existing token
    const tokenPath = this.config.sources.google.token_path;
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
    return this.authorizeInteractive();
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

  private async authorizeInteractive(): Promise<OAuth2Client> {
    if (!this.oauth2Client) throw new Error('OAuth client not initialized');

    // Start the local server to listen for the callback
    const codePromise = this.waitForAuthCallback();

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Force refresh token generation
    });

    console.log('\n==========================================');
    console.log('Google Authorization Required');
    console.log('==========================================');
    console.log('\n1. Visit this URL to authorize the application:\n');
    console.log(authUrl);
    console.log('\n2. You will be redirected to localhost automatically.');
    console.log('==========================================\n');

    const code = await codePromise;

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    await this.saveToken(tokens as unknown as Token);

    this.logger.info('Google authorization successful');
    return this.oauth2Client;
  }

  private async waitForAuthCallback(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          if (!req.url) {
            res.writeHead(400);
            res.end('Bad request');
            return;
          }

          const url = new URL(req.url, `http://localhost:${AUTH_WEB_PORT}`);
          const code = url.searchParams.get('code');

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <head><title>Authorization Successful</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                  <h1 style="color: green;">Authorization Successful</h1>
                  <p>You can close this window. The application will continue automatically.</p>
                  <script>window.close();</script>
                </body>
              </html>
            `);
            server.close();
            resolve(code);
            return;
          }

          // Handle errors or other paths
          res.writeHead(404);
          res.end('Not found');
        } catch (error) {
          res.writeHead(500);
          res.end('Internal error');
          reject(error);
        }
      });

      server.listen(AUTH_WEB_PORT, '0.0.0.0', () => {
        this.logger.info(`Listening for authorization callback on http://localhost:${AUTH_WEB_PORT}`);
      });

      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('Authorization timeout (5 minutes)'));
      }, 300000);

      server.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }

  private async saveToken(token: Token): Promise<void> {
    const tokenPath = this.config.sources.google.token_path;
    const dir = dirname(tokenPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(tokenPath, JSON.stringify(token, null, 2));
    this.logger.debug('Google token saved');
  }
}
