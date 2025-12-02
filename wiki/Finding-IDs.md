# Finding IDs

This guide explains how to find Google Task List IDs and Todoist Project IDs.

## Google Task List IDs

### Method 1: Google Tasks API Explorer (Recommended)

1. Go to [Google Tasks API Explorer - tasklists.list](https://developers.google.com/tasks/reference/rest/v1/tasklists/list)
2. Click **Try it** or **Execute**
3. Sign in with your Google account when prompted
4. Authorize access to Google Tasks
5. The response shows all your task lists:

```json
{
  "items": [
    {
      "id": "MTIzNDU2Nzg5MDEyMzQ1Njc4OTA",
      "title": "My Tasks",
      "updated": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": "QWJjRGVmR2hpSktsTW5PcFFy",
      "title": "Work",
      "updated": "2024-01-14T08:00:00.000Z"
    }
  ]
}
```

The `id` field is what you need for configuration.

### Method 2: Debug Logging

Run Todoist Bridge with debug logging to see list IDs:

```bash
LOG_LEVEL=debug npm start
```

Look for log entries like:

```
DEBUG - Found task list: My Tasks (id: MTIzNDU2Nzg5MDEyMzQ1Njc4OTA)
```

### Method 3: Browser DevTools

1. Open [Google Tasks](https://tasks.google.com)
2. Open DevTools (F12 or Cmd+Option+I)
3. Go to the **Network** tab
4. Filter by `tasks`
5. Click different task lists in the UI
6. Inspect requests to `tasks.googleapis.com`
7. List IDs appear in URLs and response bodies

## Todoist Project IDs

### Method 1: Todoist API (Recommended)

Using curl with your API token:

```bash
curl -s "https://api.todoist.com/rest/v2/projects" \
  -H "Authorization: Bearer YOUR_API_TOKEN" | jq
```

Response:

```json
[
  {
    "id": "2345678901",
    "name": "Inbox",
    "order": 0
  },
  {
    "id": "2345678902",
    "name": "Work",
    "order": 1
  }
]
```

### Method 2: Todoist Web App URL

1. Open [Todoist](https://todoist.com) in your browser
2. Click on a project
3. Look at the URL: `https://todoist.com/app/project/2345678901`
4. The number at the end is the project ID

### Method 3: Using "inbox"

For the Inbox, use the special value `"inbox"`:

```yaml
sources:
  google:
    lists:
      - source_list_id: "abc123"
        todoist_project_id: "inbox"  # Syncs to Inbox
```

### Method 4: Browser DevTools

1. Open [Todoist](https://todoist.com)
2. Open DevTools > Network tab
3. Filter by `projects` or `sync`
4. Project IDs appear in API responses

## Quick Reference Script

Create a script to list all your IDs:

```bash
#!/bin/bash
# list-ids.sh

echo "=== Todoist Projects ==="
curl -s "https://api.todoist.com/rest/v2/projects" \
  -H "Authorization: Bearer $TODOIST_API_TOKEN" | \
  jq -r '.[] | "\(.name): \(.id)"'
```

Run with:

```bash
TODOIST_API_TOKEN=your-token ./list-ids.sh
```

## Using IDs in Configuration

Once you have the IDs, add them to `config.yaml`:

```yaml
sources:
  google:
    enabled: true
    lists:
      # Sync "Work" list to "Work Projects" in Todoist
      - source_list_id: "MTIzNDU2Nzg5MDEyMzQ1Njc4OTA"
        todoist_project_id: "2345678901"
        tags:
          - "google"

      # Sync "Quick Tasks" to Inbox
      - source_list_id: "QWJjRGVmR2hpSktsTW5PcFFy"
        todoist_project_id: "inbox"

  alexa:
    enabled: true
    lists:
      - source_list_id: "all"
        todoist_project_id: "2345678902"
```

## ID Format Reference

| Source | ID Format | Example |
|--------|-----------|---------|
| Google Task List | Base64 string | `MTIzNDU2Nzg5MDEyMzQ1Njc4OTA` |
| Todoist Project | Numeric string | `2345678901` |
| Todoist Inbox | Literal | `inbox` |
| Alexa Reminders | Literal | `all` |

## Common Mistakes

### Wrong ID type

```yaml
# Wrong - Google list ID where Todoist ID expected
todoist_project_id: "MTIzNDU2Nzg5MDEyMzQ1Njc4OTA"

# Correct
todoist_project_id: "2345678901"
```

### Missing quotes

```yaml
# Wrong - numeric IDs need quotes in YAML
todoist_project_id: 2345678901

# Correct
todoist_project_id: "2345678901"
```

### Copy-paste errors

Double-check IDs don't have:
- Extra whitespace
- Invisible characters
- Truncated characters

## Next Steps

- [Configuration](Configuration) - Full configuration reference
- [Google Setup](Google-Setup) - Google OAuth setup
- [Alexa Setup](Alexa-Setup) - Alexa integration
