# Configuration

Complete reference for Todoist Bridge configuration options.

## Configuration Methods

Todoist Bridge supports two configuration methods:

1. **YAML file** (`config.yaml` or `config.yml`)
2. **Environment variables**

Environment variables take precedence over YAML values.

## Complete Configuration Reference

```yaml
# Polling interval in minutes (1-60)
poll_interval_minutes: 5

# Todoist configuration
todoist:
  # API token from Todoist Settings > Integrations > Developer
  api_token: "your-todoist-api-token"

# Sources to sync from
sources:
  # Google Tasks source
  google:
    # Enable/disable Google Tasks sync
    enabled: true

    # Path to OAuth credentials JSON from Google Cloud Console
    credentials_path: "./credentials/google-credentials.json"

    # Path to store OAuth tokens (auto-generated)
    token_path: "./credentials/google-token.json"

    # List mappings
    lists:
      - # Google Task List ID (see Finding IDs wiki)
        source_list_id: "abc123"

        # Todoist Project ID or "inbox"
        todoist_project_id: "456789"

        # Include completed tasks in sync
        include_completed: false

        # Delete from Google after syncing to Todoist
        delete_after_sync: false

        # Tags/labels to apply to synced tasks
        tags:
          - "google-tasks"

  # Alexa source (optional)
  alexa:
    # Enable/disable Alexa sync
    enabled: false

    # Path to store Amazon authentication cookies
    cookie_path: "./credentials/alexa-cookie.json"

    # Amazon domain for your region
    amazon_page: "amazon.com"

    # Port for authentication proxy server
    proxy_port: 3001

    # Continue if Alexa fails (don't stop other sources)
    fail_silently: true

    # Retry attempts for Alexa API calls (1-10)
    max_retries: 3

    # Reminder mappings
    lists:
      - source_list_id: "all"
        todoist_project_id: "789012"
        include_completed: false
        delete_after_sync: false
        tags:
          - "alexa"

    # Shopping list sync
    sync_shopping_list:
      enabled: false
      todoist_project_id: "123456"
      include_completed: false
      delete_after_sync: false
      tags:
        - "shopping"

# Global sync settings
sync:
  # Import completed tasks only on first run
  sync_completed_once: true

# Storage configuration
storage:
  # SQLite database path
  database_path: "./data/sync.db"

# Logging configuration
logging:
  # Log level: trace, debug, info, warn, error
  level: "info"
```

## Environment Variables

| Variable | YAML Path | Description |
|----------|-----------|-------------|
| `TODOIST_API_TOKEN` | `todoist.api_token` | Todoist API token |
| `DATABASE_PATH` | `storage.database_path` | SQLite database path |
| `POLL_INTERVAL_MINUTES` | `poll_interval_minutes` | Sync interval |
| `LOG_LEVEL` | `logging.level` | Log verbosity |

## Configuration Options Detail

### poll_interval_minutes

How often to poll sources for changes.

| Type | Default | Range |
|------|---------|-------|
| integer | 5 | 1-60 |

### todoist.api_token

Your Todoist API token. Get it from:
Todoist Settings > Integrations > Developer

| Type | Required |
|------|----------|
| string | Yes |

### sources.google

#### enabled

Enable or disable Google Tasks sync.

| Type | Default |
|------|---------|
| boolean | true |

#### credentials_path

Path to Google OAuth credentials JSON file.

| Type | Default |
|------|---------|
| string | `./credentials/google-credentials.json` |

#### token_path

Path to store generated OAuth tokens.

| Type | Default |
|------|---------|
| string | `./credentials/google-token.json` |

#### lists

Array of list mappings.

##### source_list_id

Google Task List ID.

| Type | Required |
|------|----------|
| string | Yes |

##### todoist_project_id

Target Todoist project ID or `"inbox"`.

| Type | Required |
|------|----------|
| string | Yes |

##### include_completed

Sync completed tasks.

| Type | Default |
|------|---------|
| boolean | false |

##### delete_after_sync

Remove tasks from Google after syncing.

| Type | Default |
|------|---------|
| boolean | false |

##### tags

Labels to apply to synced tasks.

| Type | Default |
|------|---------|
| string[] | [] |

### sources.alexa

#### enabled

Enable or disable Alexa sync.

| Type | Default |
|------|---------|
| boolean | false |

#### cookie_path

Path to store Amazon cookies.

| Type | Default |
|------|---------|
| string | `./credentials/alexa-cookie.json` |

#### amazon_page

Amazon domain for your region.

| Type | Default | Options |
|------|---------|---------|
| string | `amazon.com` | amazon.com, amazon.co.uk, amazon.de, etc. |

#### proxy_port

Port for auth proxy server.

| Type | Default |
|------|---------|
| integer | 3001 |

#### fail_silently

Don't stop other syncs if Alexa fails.

| Type | Default |
|------|---------|
| boolean | true |

#### max_retries

API retry attempts.

| Type | Default | Range |
|------|---------|-------|
| integer | 3 | 1-10 |

### sync.sync_completed_once

Import completed tasks on first run only.

| Type | Default |
|------|---------|
| boolean | true |

### storage.database_path

SQLite database file path.

| Type | Default |
|------|---------|
| string | `./data/sync.db` |

### logging.level

Log verbosity level.

| Type | Default | Options |
|------|---------|---------|
| string | `info` | trace, debug, info, warn, error |

## Example Configurations

### Minimal (Google only)

```yaml
todoist:
  api_token: "your-token"

sources:
  google:
    enabled: true
    lists:
      - source_list_id: "abc123"
        todoist_project_id: "inbox"
```

### Multiple Google Lists

```yaml
todoist:
  api_token: "your-token"

sources:
  google:
    enabled: true
    lists:
      - source_list_id: "list1"
        todoist_project_id: "project1"
        tags: ["work"]
      - source_list_id: "list2"
        todoist_project_id: "project2"
        tags: ["personal"]
      - source_list_id: "list3"
        todoist_project_id: "inbox"
```

### Alexa Only

```yaml
todoist:
  api_token: "your-token"

sources:
  google:
    enabled: false

  alexa:
    enabled: true
    amazon_page: "amazon.com"
    lists:
      - source_list_id: "all"
        todoist_project_id: "inbox"
    sync_shopping_list:
      enabled: true
      todoist_project_id: "shopping-project-id"
```

### Full Featured

```yaml
poll_interval_minutes: 10

todoist:
  api_token: "your-token"

sources:
  google:
    enabled: true
    lists:
      - source_list_id: "work-list-id"
        todoist_project_id: "work-project-id"
        include_completed: false
        delete_after_sync: false
        tags:
          - "google"
          - "work"
      - source_list_id: "personal-list-id"
        todoist_project_id: "inbox"
        tags:
          - "personal"

  alexa:
    enabled: true
    amazon_page: "amazon.com"
    fail_silently: true
    max_retries: 5
    lists:
      - source_list_id: "all"
        todoist_project_id: "reminders-project-id"
        delete_after_sync: true
        tags:
          - "alexa"
          - "reminder"
    sync_shopping_list:
      enabled: true
      todoist_project_id: "shopping-project-id"
      delete_after_sync: true
      tags:
        - "shopping"

sync:
  sync_completed_once: true

storage:
  database_path: "./data/sync.db"

logging:
  level: "info"
```

## Validation

Configuration is validated at startup using Zod schemas. Invalid configuration produces clear error messages:

```
Error: Invalid configuration
  - todoist.api_token: Required
  - sources.google.lists[0].source_list_id: Required
```

## Next Steps

- [Finding IDs](Finding-IDs) - Get list and project IDs
- [Google Setup](Google-Setup) - OAuth configuration
- [Alexa Setup](Alexa-Setup) - Amazon integration
