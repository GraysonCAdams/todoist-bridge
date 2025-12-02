# Finding Google Task List and Todoist Project IDs

This guide explains how to find the IDs needed for manual mapping configuration.

## Google Task List IDs

### Method 1: Google Tasks API Explorer (Recommended)

1. Go to [Google Tasks API Explorer - tasklists.list](https://developers.google.com/tasks/reference/rest/v1/tasklists/list)
2. Click **"Try it"** or **"Execute"**
3. Sign in with your Google account when prompted
4. The response shows all your task lists:

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

### Method 2: Browser DevTools

1. Open [Google Tasks](https://tasks.google.com) or [Google Calendar](https://calendar.google.com)
2. Open DevTools (F12 or Cmd+Option+I)
3. Go to **Network** tab
4. Filter requests by `tasks`
5. Click on different task lists in the UI
6. Look for requests to `tasks.googleapis.com` - list IDs appear in URLs and responses

---

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

### Method 3: Browser DevTools

1. Open [Todoist](https://todoist.com)
2. Open DevTools → Network tab
3. Filter by `projects` or `sync`
4. Project IDs appear in API responses

---

## Using IDs in Configuration

Once you have the IDs, add them to `config.yaml`:

```yaml
mappings:
  auto_map: true  # Still auto-map other lists

  # Manual overrides for specific lists
  manual:
    - google_list_id: "MTIzNDU2Nzg5MDEyMzQ1Njc4OTA"
      todoist_project_id: "2345678901"
    - google_list_id: "QWJjRGVmR2hpSktsTW5PcFFy"
      todoist_project_id: "2345678902"

  # Exclude lists you don't want synced
  exclude:
    - list_id: "SomeListIdToSkip"
    - name_pattern: "^Archive"  # Regex pattern
```
