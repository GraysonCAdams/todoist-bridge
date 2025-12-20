# Google Setup

This guide walks through setting up Google OAuth credentials for Google Tasks access.

## Overview

Todoist Bridge uses OAuth 2.0 to access your Google Tasks. You need to:

1. Create a Google Cloud project
2. Enable the Tasks API
3. Create OAuth credentials
4. Download the credentials file

## Step-by-Step Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click the project dropdown at the top
3. Click **New Project**
4. Enter a name (e.g., "Todoist Bridge")
5. Click **Create**
6. Wait for the project to be created, then select it

### 2. Enable the Tasks API

1. In the Cloud Console, go to **APIs & Services** > **Library**
2. Search for "Tasks API"
3. Click on **Tasks API**
4. Click **Enable**

### 3. Configure OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **External** (unless you have a Google Workspace organization)
3. Click **Create**
4. Fill in the required fields:
   - **App name**: Todoist Bridge
   - **User support email**: Your email
   - **Developer contact email**: Your email
5. Click **Save and Continue**
6. On the Scopes page, click **Add or Remove Scopes**
7. Add the scope: `https://www.googleapis.com/auth/tasks`
8. Click **Update**, then **Save and Continue**
9. On the Test Users page, click **Add Users**
10. Add your Google email address
11. Click **Save and Continue**

### 4. Publish the App (Important)

By default, your app is in "Testing" mode, which means refresh tokens expire after 7 days. To avoid re-authenticating every week:

1. Go to **APIs & Services** > **OAuth consent screen**
2. Under "Publishing status", click **Publish App**
3. Click **Confirm** in the dialog
4. **Note**: You do not need to submit for verification for personal use. You will see a "Google hasn't verified this app" warning when logging in. Click **Advanced** > **Go to Todoist Bridge (unsafe)** to proceed.

### 5. Create OAuth Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Select **Web application** as the application type
4. Enter a name (e.g., "Todoist Bridge")
5. Under **Authorized redirect URIs**, add: `https://my.home-assistant.io/redirect/oauth`
6. Click **Create**
7. Click **Download JSON** on the confirmation dialog
8. Save the file as `credentials/google-credentials.json`

### 6. Verify Credentials File

Your credentials file should look similar to:

```json
{
  "web": {
    "client_id": "123456789-abcdefg.apps.googleusercontent.com",
    "project_id": "todoist-bridge-12345",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_secret": "GOCSPX-...",
    "redirect_uris": ["https://my.home-assistant.io/redirect/oauth"]
  }
}
```

## Production OAuth Setup (Recommended)

For production deployments (Docker, reverse proxy, Home Assistant, etc.), we use **my.home-assistant.io** as an OAuth redirect proxy. This provides a stable HTTPS endpoint that works regardless of how you access your server.

### How It Works

1. Google redirects to `https://my.home-assistant.io/redirect/oauth`
2. my.home-assistant.io reads your server URL from browser localStorage
3. It redirects to your server at `/auth/external/callback` with the auth code
4. Your server receives the code and completes authentication

### Setup Steps

1. **Configure your server URL at my.home-assistant.io**:
   - Go to https://my.home-assistant.io
   - Enter your **Todoist Bridge** server URL with the correct port
   - **IMPORTANT**: Use the Todoist Bridge port (default 3000), NOT Home Assistant's port (8123)
   - Example: `http://192.168.1.140:3000` (your local IP + Todoist Bridge port)
   - This URL is stored in your browser's localStorage

2. **Enable in config.yaml**:
   ```yaml
   sources:
     google:
       enabled: true
       use_homeassistant_redirect: true
       oauth_port: 3000  # Must match the port in my.home-assistant.io URL
   ```

3. **Ensure Google Cloud Console has the correct redirect URI**:
   - `https://my.home-assistant.io/redirect/oauth`

4. **Ensure port 3000 is accessible**:
   - If running in Docker, expose port 3000: `ports: - "3000:3000"`
   - If behind a firewall, allow incoming connections on port 3000

### First Authorization

1. Start Todoist Bridge
2. It will print an authorization URL to the console
3. Visit the URL in your browser (use the same browser where you configured my.home-assistant.io)
4. Sign in with your Google account
5. Grant access to Google Tasks
6. You'll be redirected through my.home-assistant.io to your server
7. The token is saved automatically

### Common Mistake

**Wrong**: `http://192.168.1.140:8123` (This is Home Assistant's port!)
**Right**: `http://192.168.1.140:3000` (This is Todoist Bridge's port)

## Alternative: Direct OAuth

If you prefer not to use my.home-assistant.io, you can configure a direct redirect:

```yaml
sources:
  google:
    enabled: true
    use_homeassistant_redirect: false
    oauth_redirect_url: "https://your-server.example.com/oauth/google/callback"
    oauth_port: 3000
```

Note: Your redirect URL must be HTTPS for production use with Google OAuth.

## Configuration

Full configuration example:

```yaml
sources:
  google:
    enabled: true
    credentials_path: "./credentials/google-credentials.json"
    token_path: "./credentials/google-token.json"

    # Use my.home-assistant.io OAuth redirect (recommended)
    use_homeassistant_redirect: true
    oauth_port: 3000

    lists:
      - source_list_id: "YOUR_LIST_ID"
        todoist_project_id: "YOUR_PROJECT_ID"
```

See [Finding IDs](Finding-IDs) to get your Google Task List IDs.

## Docker Deployment

### Docker Compose Example

```yaml
version: '3.8'
services:
  todoist-bridge:
    image: ghcr.io/graysoncadams/todoist-bridge:latest
    ports:
      - "3000:3000"  # OAuth callback port
    volumes:
      - ./credentials:/app/credentials
      - ./config.yaml:/app/config.yaml:ro
      - ./data:/app/data
```

### Reverse Proxy Configuration (nginx)

```nginx
location /auth/external/callback {
    proxy_pass http://todoist-bridge:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

## Token Refresh

- Tokens are automatically refreshed before expiry
- If refresh fails, you'll be prompted to re-authorize
- Delete `google-token.json` to force re-authorization

## Troubleshooting

### "Access blocked: This app's request is invalid"

- Ensure you added your email to Test Users
- Check that the Tasks API is enabled
- Verify the OAuth consent screen is configured

### "redirect_uri_mismatch"

- Ensure Google Cloud Console has: `https://my.home-assistant.io/redirect/oauth`
- If using direct OAuth, the URI must exactly match your `oauth_redirect_url`

### my.home-assistant.io shows "Instance not configured"

- Visit https://my.home-assistant.io and enter your server URL
- The URL is stored in browser localStorage, so use the same browser for auth

### "Authorization timeout"

- Complete browser authorization within 5 minutes
- Ensure your server is accessible from your browser
- Check that port 3000 is not blocked

### Token expired

```bash
rm credentials/google-token.json
npm start  # Re-authorize
```

## Security Notes

- Keep `google-credentials.json` secure
- Never commit credentials to version control
- The `.gitignore` excludes the credentials directory
- my.home-assistant.io only stores your server URL in browser localStorage

## Next Steps

- [Finding IDs](Finding-IDs) - Get your list IDs
- [Alexa Setup](Alexa-Setup) - Optional Alexa integration
- [Configuration](Configuration) - Full configuration options
