/**
 * Alexa Authentication
 */

import AlexaRemote from 'alexa-remote2';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import type { AlexaSourceConfig } from './types.js';
import type { Logger } from '../../utils/logger.js';

interface AlexaCookie {
  cookie: string;
  csrf?: string;
  localCookie?: string;
  macDms?: Record<string, unknown>;
  formerRegistrationData?: Record<string, unknown>;
}

// Success page HTML styled to match Amazon's login design language
const successPageHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Complete</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: "Amazon Ember", Arial, sans-serif;
      background-color: #fff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .header {
      width: 100%;
      background: linear-gradient(to bottom, #232f3e 0%, #131921 100%);
      padding: 11px 18px;
      text-align: center;
    }
    .logo-text {
      color: #fff;
      font-size: 24px;
      font-weight: bold;
      letter-spacing: -0.5px;
    }
    .container {
      max-width: 350px;
      width: 100%;
      padding: 20px;
      margin-top: 20px;
    }
    .card {
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 20px 26px;
      background: #fff;
    }
    .success-icon {
      width: 60px;
      height: 60px;
      margin: 0 auto 16px;
      background: #067D62;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .success-icon svg {
      width: 32px;
      height: 32px;
      fill: #fff;
    }
    h1 {
      font-size: 28px;
      font-weight: 400;
      color: #0F1111;
      text-align: center;
      margin-bottom: 10px;
    }
    .message {
      font-size: 14px;
      color: #565959;
      text-align: center;
      line-height: 20px;
      margin-bottom: 20px;
    }
    .divider {
      height: 44px;
      position: relative;
    }
    .divider::before {
      content: "";
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(to right, #fff, #ddd, #fff);
    }
    .footer {
      margin-top: auto;
      padding: 30px;
      text-align: center;
      font-size: 12px;
      color: #555;
      background: linear-gradient(to bottom, rgba(0,0,0,0.03), rgba(0,0,0,0.08));
      width: 100%;
    }
    .footer-links {
      margin-bottom: 8px;
    }
    .footer-links a {
      color: #0066c0;
      text-decoration: none;
      margin: 0 8px;
    }
    .footer-links a:hover {
      text-decoration: underline;
      color: #c45500;
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="logo-text">amazon</span>
  </div>
  <div class="container">
    <div class="card">
      <div class="success-icon">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
      </div>
      <h1>Success!</h1>
      <p class="message">
        Your Amazon Alexa account has been connected successfully.
        You can close this browser window.
      </p>
      <div class="divider"></div>
      <p class="message" style="font-size: 13px; color: #888;">
        Task sync will begin automatically.
      </p>
    </div>
  </div>
  <div class="footer">
    <div class="footer-links">
      <a href="#">Conditions of Use</a>
      <a href="#">Privacy Notice</a>
      <a href="#">Help</a>
    </div>
    <div>© 1996-2024, Amazon.com, Inc. or its affiliates</div>
  </div>
</body>
</html>`;

export class AlexaAuth {
  private config: AlexaSourceConfig;
  private logger: Logger;
  private alexa: AlexaRemote | null = null;

  constructor(config: AlexaSourceConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Detect the proxy host from the first browser request.
   * This allows the auth flow to work regardless of how the user accesses the server.
   */
  private async detectProxyHost(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        // Extract hostname from the Host header (format: "hostname:port" or just "hostname")
        const hostHeader = req.headers.host || '';
        const hostname = hostHeader.split(':')[0] || 'localhost';

        this.logger.info({ detectedHost: hostname, hostHeader }, 'Auto-detected proxy host from browser request');

        // Send a response that tells user to wait and auto-refreshes
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Detecting host...</title>
            <meta http-equiv="refresh" content="2">
            <style>
              body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
              .card { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
              h1 { color: #232f3e; margin-bottom: 10px; }
              p { color: #666; }
              .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #ff9900; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
              @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="spinner"></div>
              <h1>Host Detected: ${hostname}</h1>
              <p>Starting Amazon login proxy...</p>
              <p style="font-size: 12px; color: #999;">This page will refresh automatically.</p>
            </div>
          </body>
          </html>
        `);

        // Close the detection server after responding
        server.close(() => {
          this.logger.debug('Host detection server closed');
          resolve(hostname);
        });
      });

      server.on('error', (err: Error) => {
        this.logger.error({ err }, 'Failed to start host detection server');
        reject(new Error(`Failed to start host detection server: ${err.message}`));
      });

      server.listen(port, '0.0.0.0', () => {
        this.logger.debug({ port }, 'Host detection server started');
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Host detection timeout (5 minutes). No browser connection received.'));
      }, 300000);
    });
  }

  async getAuthenticatedClient(): Promise<AlexaRemote> {
    this.alexa = new AlexaRemote();

    const savedCookie = this.loadCookie();
    const proxyPort = this.config.proxy_port || 3001;

    // Determine proxy host - either from config, or auto-detect from browser
    let proxyHost = this.config.proxy_host;

    // If no saved cookie and no explicit proxy_host, auto-detect from browser request
    if (!savedCookie?.cookie && !proxyHost) {
      console.log('\n==========================================');
      console.log('Alexa Authorization Required');
      console.log('==========================================');
      console.log(`\nPlease visit this URL to start authorization:\n`);
      console.log(`http://<YOUR_SERVER_IP>:${proxyPort}`);
      console.log(`\n(e.g., http://192.168.1.140:${proxyPort} or http://localhost:${proxyPort})`);
      console.log('\nThe host will be automatically detected from your browser.');
      console.log('\n==========================================\n');

      try {
        proxyHost = await this.detectProxyHost(proxyPort);
        this.logger.info({ proxyHost }, 'Using auto-detected host for Alexa proxy');
      } catch (error) {
        this.logger.error({ err: error }, 'Host detection failed, falling back to localhost');
        proxyHost = 'localhost';
      }
    }

    // Default to localhost if still not set (e.g., when we have a saved cookie)
    proxyHost = proxyHost || 'localhost';

    return new Promise((resolve, reject) => {
      const options = {
        cookie: savedCookie?.cookie,
        proxyOnly: !savedCookie?.cookie, // Only use proxy if no cookie exists
        proxyOwnIp: proxyHost, // Used for generating redirect URLs
        proxyPort: proxyPort,
        proxyListenBind: '0.0.0.0', // Bind to all interfaces for Docker accessibility
        amazonPage: this.config.amazon_page || 'amazon.com',
        amazonPageProxyLanguage: 'en_US',
        acceptLanguage: 'en-US',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        useWsMqtt: false, // Don't need real-time updates for sync
        cookieRefreshInterval: 7 * 24 * 60 * 60 * 1000, // 7 days
        formerRegistrationData: savedCookie?.formerRegistrationData,
        macDms: savedCookie?.macDms,
        proxyCloseWindowHTML: successPageHTML, // Custom success page matching Amazon's design
      } as Record<string, unknown>;

      // If we need interactive auth (after detection), show the actual URL
      if (!savedCookie?.cookie) {
        console.log('\n==========================================');
        console.log('Amazon Login Ready');
        console.log('==========================================');
        console.log(`\nProxy URL: http://${proxyHost}:${proxyPort}`);
        console.log('\nLog in with your Amazon account (2FA required).');
        console.log('\n==========================================\n');
      }

      this.alexa!.init(options, (err) => {
        if (err) {
          // Check if this is the expected "please login" message when no cookie exists
          const isLoginPrompt = err.message?.includes('Please open') ||
                               err.message?.includes('login to Amazon');

          if (isLoginPrompt && !savedCookie?.cookie) {
            // This is expected - the proxy is running and waiting for login
            // Don't reject, just log and wait for the cookie event
            this.logger.info(
              { proxyUrl: `http://${proxyHost}:${proxyPort}` },
              `Alexa proxy server started, waiting for browser login at http://${proxyHost}:${proxyPort}`
            );
            return; // Don't reject - wait for cookie event
          }

          // Check if it's a cookie issue
          if (err.message?.includes('cookie') || err.message?.includes('auth')) {
            this.logger.warn({ err }, 'Alexa cookie may be expired, try re-authenticating');
          }
          this.logger.error({ err }, 'Alexa authentication failed');
          reject(new Error(`Alexa authentication failed: ${err.message}`));
          return;
        }

        // Save the cookie for future use
        this.saveCookie(this.alexa!);
        this.logger.info('Alexa authentication successful');
        resolve(this.alexa!);
      });

      // Handle proxy events - this fires when user completes browser login
      this.alexa!.on('cookie', (cookie: string, csrf: string, macDms: Record<string, unknown>) => {
        this.logger.debug('Received new Alexa cookie from browser login');
        const cookieData: AlexaCookie = {
          cookie,
          csrf,
          macDms,
          formerRegistrationData: (this.alexa as unknown as { cookieData?: { formerRegistrationData?: Record<string, unknown> } })?.cookieData?.formerRegistrationData,
        };
        this.saveCookieData(cookieData);

        // If we were waiting for login (no saved cookie), resolve now
        if (!savedCookie?.cookie) {
          this.logger.info('Alexa authentication successful (via browser login)');
          resolve(this.alexa!);
        }
      });

      // Add timeout for waiting for browser login (10 minutes)
      if (!savedCookie?.cookie) {
        setTimeout(() => {
          reject(new Error('Alexa authentication timeout (10 minutes). Please try again.'));
        }, 600000);
      }
    });
  }

  private loadCookie(): AlexaCookie | null {
    const cookiePath = this.config.cookie_path;
    if (!cookiePath || !existsSync(cookiePath)) {
      return null;
    }

    try {
      const content = readFileSync(cookiePath, 'utf-8');
      const data = JSON.parse(content) as AlexaCookie;
      this.logger.debug('Loaded Alexa cookie from disk');
      return data;
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to load Alexa cookie');
      return null;
    }
  }

  private saveCookie(alexa: AlexaRemote): void {
    try {
      // Access cookie data from the alexa instance
      const cookieData: AlexaCookie = {
        cookie: (alexa as any).cookie,
        csrf: (alexa as any).csrf,
        macDms: (alexa as any).macDms,
        formerRegistrationData: (alexa as any).cookieData?.formerRegistrationData,
      };

      if (cookieData.cookie) {
        this.saveCookieData(cookieData);
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to save Alexa cookie');
    }
  }

  private saveCookieData(cookieData: AlexaCookie): void {
    const cookiePath = this.config.cookie_path;
    if (!cookiePath) return;

    try {
      const dir = dirname(cookiePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(cookiePath, JSON.stringify(cookieData, null, 2));
      this.logger.debug('Alexa cookie saved');
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to save Alexa cookie data');
    }
  }

  getClient(): AlexaRemote | null {
    return this.alexa;
  }
}
