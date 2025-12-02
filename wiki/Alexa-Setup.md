# Alexa Setup

This guide covers setting up Amazon Alexa integration for syncing reminders and shopping lists.

## Important Notice

Alexa integration uses the unofficial `alexa-remote2` library. This is not an official Amazon API and may break if Amazon changes their authentication mechanism.

## Features

- Sync Alexa reminders to Todoist
- Sync Alexa shopping list items
- Custom tags for organization
- Optional delete after sync

## Prerequisites

- Amazon account with Alexa devices
- Alexa app configured with your account

## Configuration

Enable Alexa in `config.yaml`:

```yaml
sources:
  alexa:
    enabled: true
    cookie_path: "./credentials/alexa-cookie.json"
    amazon_page: "amazon.com"  # Your region's Amazon domain
    proxy_port: 3001
    fail_silently: true
    max_retries: 3
```

### Amazon Domains by Region

| Region | Domain |
|--------|--------|
| United States | amazon.com |
| United Kingdom | amazon.co.uk |
| Germany | amazon.de |
| France | amazon.fr |
| Italy | amazon.it |
| Spain | amazon.es |
| Japan | amazon.co.jp |
| Canada | amazon.ca |
| Australia | amazon.com.au |

## First Run Authorization

On first run with Alexa enabled:

1. A proxy server starts on the configured port (default: 3001)
2. Open `http://localhost:3001` in your browser
3. Sign in with your Amazon account
4. Complete any 2FA if enabled
5. Cookies are captured and saved automatically

## Syncing Reminders

### Configuration

```yaml
sources:
  alexa:
    enabled: true
    lists:
      - source_list_id: "all"           # Use "all" for all reminders
        todoist_project_id: "123456"    # Target Todoist project
        include_completed: false        # Skip completed reminders
        delete_after_sync: false        # Keep reminders in Alexa
        tags:
          - "alexa"
          - "reminder"
```

### Reminder Mapping

| Alexa | Todoist | Notes |
|-------|---------|-------|
| Reminder text | Content | Direct mapping |
| Scheduled time | Due datetime | Full datetime support |
| Device name | Description | Optional tracking |
| Status (ON/OFF) | is_completed | ON = incomplete |

## Syncing Shopping List

### Configuration

```yaml
sources:
  alexa:
    enabled: true
    sync_shopping_list:
      enabled: true
      todoist_project_id: "789012"     # Shopping project in Todoist
      include_completed: false         # Skip checked items
      delete_after_sync: false         # Keep in Alexa
      tags:
        - "shopping"
        - "alexa"
```

### Shopping List Mapping

| Alexa | Todoist |
|-------|---------|
| Item name | Content |
| Checked state | is_completed |

## Docker Considerations

### Interactive Authentication

For first-time auth in Docker, run interactively:

```bash
docker run -it --rm \
  -p 3001:3001 \
  -v $(pwd)/credentials:/app/credentials \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  ghcr.io/YOUR_USERNAME/todoist-bridge:latest
```

Then open `http://localhost:3001` and complete authorization.

### Port Mapping

Ensure the proxy port is exposed:

```yaml
services:
  todoist-bridge:
    ports:
      - "3001:3001"  # Only needed for initial auth
```

## Cookie Refresh

- Cookies are refreshed automatically every 7 days
- If authentication fails, delete `alexa-cookie.json` and restart

## Fail Silently Option

When `fail_silently: true`:
- Alexa errors won't stop other sync sources
- Useful for unreliable connections
- Errors are logged but don't crash the daemon

```yaml
sources:
  alexa:
    fail_silently: true
```

## Retry Configuration

Configure API retry behavior:

```yaml
sources:
  alexa:
    max_retries: 3  # 1-10 retries per API call
```

## Troubleshooting

### "Cookie expired"

```bash
rm credentials/alexa-cookie.json
# Restart and re-authenticate
```

### "Unable to connect to Amazon"

- Check your `amazon_page` matches your region
- Verify network connectivity
- Try a different proxy port

### "401 Unauthorized"

- Re-authenticate through the proxy
- Ensure 2FA codes are entered correctly

### "ECONNREFUSED on port 3001"

- Port may be in use
- Change `proxy_port` to another value

### Reminders not syncing

- Alexa may use "notifications" for some reminder types
- Only standard reminders are supported
- Check log output at debug level

## Security Considerations

- `alexa-cookie.json` contains session tokens
- Never commit this file to version control
- The `.gitignore` excludes the credentials directory
- Tokens provide full account access - keep secure

## Limitations

- This uses an unofficial API
- Amazon may change auth requirements without notice
- Some Alexa features are not accessible
- Shopping list is read-only in some regions

## Example Complete Configuration

```yaml
sources:
  alexa:
    enabled: true
    cookie_path: "./credentials/alexa-cookie.json"
    amazon_page: "amazon.com"
    proxy_port: 3001
    fail_silently: true
    max_retries: 3

    # Sync all reminders
    lists:
      - source_list_id: "all"
        todoist_project_id: "inbox"
        include_completed: false
        delete_after_sync: false
        tags:
          - "alexa"

    # Sync shopping list
    sync_shopping_list:
      enabled: true
      todoist_project_id: "2345678901"
      include_completed: false
      delete_after_sync: true  # Remove from Alexa after syncing
      tags:
        - "shopping"
```

## Next Steps

- [Finding IDs](Finding-IDs) - Get Todoist project IDs
- [Docker Deployment](Docker-Deployment) - Production deployment
- [Troubleshooting](Troubleshooting) - More solutions
