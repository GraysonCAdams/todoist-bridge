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

### 4. Create OAuth Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Select **Desktop app** as the application type
4. Enter a name (e.g., "Todoist Bridge Desktop")
5. Click **Create**
6. Click **Download JSON** on the confirmation dialog
7. Save the file as `credentials/google-credentials.json`

### 5. Verify Credentials File

Your credentials file should look similar to:

```json
{
  "installed": {
    "client_id": "123456789-abcdefg.apps.googleusercontent.com",
    "project_id": "todoist-bridge-12345",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_secret": "GOCSPX-...",
    "redirect_uris": ["http://localhost"]
  }
}
```

## First Run Authorization

On first run, Todoist Bridge will:

1. Print an authorization URL to the console
2. Start a local server on port 3000
3. Wait for you to complete authorization

Follow these steps:

1. Copy the URL printed to the console
2. Open it in your browser
3. Sign in with your Google account
4. Grant access to Google Tasks
5. You'll be redirected to localhost
6. The token is automatically captured and saved

The token is saved to `credentials/google-token.json` and refreshed automatically.

## Configuration

After setup, configure Google Tasks in `config.yaml`:

```yaml
sources:
  google:
    enabled: true
    credentials_path: "./credentials/google-credentials.json"
    token_path: "./credentials/google-token.json"
    lists:
      - source_list_id: "YOUR_LIST_ID"
        todoist_project_id: "YOUR_PROJECT_ID"
```

See [Finding IDs](Finding-IDs) to get your Google Task List IDs.

## Docker Considerations

When running in Docker:

1. Complete OAuth authorization on the host first
2. Mount the credentials directory:

```yaml
volumes:
  - ./credentials:/app/credentials
```

Or run once interactively:

```bash
docker run -it --rm \
  -p 3000:3000 \
  -v $(pwd)/credentials:/app/credentials \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  ghcr.io/YOUR_USERNAME/todoist-bridge:latest
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

### "Invalid client_id"

- Download credentials again from Cloud Console
- Ensure you're using the correct project

### "Authorization timeout"

- Complete browser authorization within 5 minutes
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
- Consider using environment variables in CI/CD

## Next Steps

- [Finding IDs](Finding-IDs) - Get your list IDs
- [Alexa Setup](Alexa-Setup) - Optional Alexa integration
- [Configuration](Configuration) - Full configuration options
