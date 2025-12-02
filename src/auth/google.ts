import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createInterface } from 'readline';
import { createServer } from 'http';
import { URL } from 'url';
import type { Config } from '../config.js';
import type { Logger } from '../utils/logger.js';

// Out-of-Band redirect URI for Desktop/Installed apps
const OOB_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

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

    // Use OOB redirect URI for Desktop/Installed app flow
    this.oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      OOB_REDIRECT_URI
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

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Force refresh token generation
    });

    // Check if running interactively (TTY) or in Docker/non-interactive mode
    const isInteractive = process.stdin.isTTY;

    let code: string;

    if (isInteractive) {
      console.log('\n==========================================');
      console.log('Google Authorization Required');
      console.log('==========================================');
      console.log('\n1. Visit this URL to authorize the application:\n');
      console.log(authUrl);
      console.log('\n2. After authorizing, Google will display an authorization code.');
      console.log('3. Copy that code and paste it below.\n');
      console.log('==========================================\n');

      code = await this.promptForAuthCode();
    } else {
      // Non-interactive mode (Docker) - use web interface
      console.log('\n==========================================');
      console.log('Google Authorization Required');
      console.log('==========================================');
      console.log('\n1. Visit this URL to authorize the application:\n');
      console.log(authUrl);
      console.log('\n2. After authorizing, Google will display an authorization code.');
      console.log(`3. Enter the code at: http://localhost:${AUTH_WEB_PORT}/auth\n`);
      console.log('==========================================\n');

      code = await this.waitForAuthCodeViaWeb(authUrl);
    }

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    await this.saveToken(tokens as unknown as Token);

    this.logger.info('Google authorization successful');
    return this.oauth2Client;
  }

  private async promptForAuthCode(): Promise<string> {
    return new Promise((resolve, reject) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        rl.close();
        reject(new Error('Authorization timeout (5 minutes)'));
      }, 300000);

      rl.question('Enter authorization code: ', (code) => {
        clearTimeout(timeout);
        rl.close();

        const trimmedCode = code.trim();
        if (!trimmedCode) {
          reject(new Error('No authorization code provided'));
          return;
        }

        resolve(trimmedCode);
      });
    });
  }

  private async waitForAuthCodeViaWeb(authUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          if (!req.url) {
            res.writeHead(400);
            res.end('Bad request');
            return;
          }

          const url = new URL(req.url, `http://localhost:${AUTH_WEB_PORT}`);

          // Serve the auth form page
          if (url.pathname === '/auth' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
                <head>
                  <title>Google Authorization</title>
                  <style>
                    body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                    h1 { color: #333; }
                    .step { margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 5px; }
                    .step-number { font-weight: bold; color: #4285f4; }
                    a { color: #4285f4; word-break: break-all; }
                    input[type="text"] { width: 100%; padding: 10px; font-size: 16px; margin: 10px 0; box-sizing: border-box; }
                    button { background: #4285f4; color: white; padding: 12px 24px; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; }
                    button:hover { background: #3367d6; }
                    .error { color: red; margin-top: 10px; }
                  </style>
                </head>
                <body>
                  <h1>Google Authorization Required</h1>
                  <div class="step">
                    <span class="step-number">Step 1:</span>
                    <a href="${authUrl}" target="_blank">Click here to authorize with Google</a>
                  </div>
                  <div class="step">
                    <span class="step-number">Step 2:</span>
                    After authorizing, Google will display an authorization code. Copy that code.
                  </div>
                  <div class="step">
                    <span class="step-number">Step 3:</span>
                    Paste the authorization code below:
                    <form method="POST" action="/auth">
                      <input type="text" name="code" placeholder="Paste authorization code here" required autofocus />
                      <button type="submit">Submit</button>
                    </form>
                  </div>
                </body>
              </html>
            `);
            return;
          }

          // Handle form submission
          if (url.pathname === '/auth' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              const params = new URLSearchParams(body);
              const code = params.get('code')?.trim();

              if (!code) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(`
                  <html>
                    <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                      <h1>Error</h1>
                      <p>No authorization code provided. <a href="/auth">Try again</a></p>
                    </body>
                  </html>
                `);
                return;
              }

              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <head><title>Authorization Successful</title></head>
                  <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: green;">Authorization Successful</h1>
                    <p>You can close this window. The application will continue automatically.</p>
                  </body>
                </html>
              `);
              server.close();
              resolve(code);
            });
            return;
          }

          // Redirect root to /auth
          if (url.pathname === '/') {
            res.writeHead(302, { 'Location': '/auth' });
            res.end();
            return;
          }

          res.writeHead(404);
          res.end('Not found');
        } catch (error) {
          res.writeHead(500);
          res.end('Internal error');
          reject(error);
        }
      });

      server.listen(AUTH_WEB_PORT, '0.0.0.0', () => {
        this.logger.info(`Authorization web interface available at http://localhost:${AUTH_WEB_PORT}/auth`);
      });

      // Timeout after 10 minutes for web-based auth
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('Authorization timeout (10 minutes)'));
      }, 600000);

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
