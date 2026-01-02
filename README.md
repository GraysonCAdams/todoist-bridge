<p align="center">
  <h1 align="center">Todoist Bridge</h1>
  <p align="center">
    Unified task synchronization from Google Tasks, Alexa, and Microsoft To-Do to Todoist
  </p>
</p>

<p align="center">
  <a href="https://github.com/GraysonCAdams/todoist-bridge/actions/workflows/docker-publish.yml">
    <img src="https://github.com/GraysonCAdams/todoist-bridge/actions/workflows/docker-publish.yml/badge.svg" alt="Build Status">
  </a>
  <a href="https://github.com/GraysonCAdams/todoist-bridge/pkgs/container/todoist-bridge">
    <img src="https://img.shields.io/badge/ghcr.io-available-blue" alt="Container Registry">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  </a>
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen" alt="Node Version">
  <img src="https://img.shields.io/badge/typescript-5.6-blue" alt="TypeScript">
</p>

---

## Table of Contents

- [About](#about)
- [Features](#features)
- [Quick Start](#quick-start)
- [Installation](#installation)
  - [Docker (Recommended)](#docker-recommended)
  - [Docker Compose](#docker-compose)
  - [Manual Installation](#manual-installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Architecture](#architecture)
- [Wiki](#wiki)
- [Contributing](#contributing)
- [Credits](#credits)
- [License](#license)

---

## About

Todoist Bridge is a Node.js daemon that synchronizes tasks between multiple platforms and Todoist. It runs as a background service, polling your task sources at configurable intervals and automatically creating, updating, and completing tasks.

### Supported Sources

You can use **any combination** of the following sources:

| Source | Sync Direction | Description |
|--------|----------------|-------------|
| Google Tasks | One-way → Todoist | Sync task lists from Google Tasks |
| Alexa Reminders | One-way → Todoist | Sync reminders from Alexa devices |
| Alexa Shopping List | One-way → Todoist | Sync your Alexa shopping list |
| Microsoft To-Do | **Bi-directional** ↔ Todoist | Two-way sync with Microsoft To-Do lists |

Enable only what you need - each source is independently configurable.

**Why Todoist Bridge?**

- **Centralize your tasks**: Consolidate tasks from multiple sources into Todoist
- **Modular sources**: Use Google Tasks, Alexa, or both - your choice
- **Hands-free operation**: Set it up once and forget about it
- **Flexible mapping**: Map specific lists to specific projects with custom tags
- **Self-hosted**: Your data stays on your infrastructure

---

## Features

| Feature | Description |
|---------|-------------|
| **Google Tasks Sync** | Full sync of tasks including subtasks, due dates, and descriptions |
| **Alexa Reminders** | Sync reminders from all Alexa devices to Todoist |
| **Alexa Shopping List** | Keep your shopping list in sync |
| **Microsoft To-Do Sync** | Bi-directional sync with Microsoft To-Do (great for shared lists) |
| **Completion Sync** | Complete tasks on either platform, syncs to the other |
| **Shared List Support** | Auto-assign items to yourself in shared Microsoft lists |
| **Custom Tags** | Apply labels to synced tasks for easy filtering |
| **Flexible Mapping** | Map any source list to any Todoist project or Inbox |
| **Subtask Support** | Single-level subtask hierarchy preserved |
| **Completed Tasks** | Optional retroactive import of completed tasks |
| **Delete After Sync** | Optionally remove tasks from source after syncing |
| **Conflict Resolution** | Last-write-wins for bi-directional sync conflicts |
| **SQLite State** | Reliable change detection with local database |
| **Graceful Shutdown** | Clean handling of SIGTERM/SIGINT signals |

---

## Quick Start

### Using Docker

```bash
# Pull the image
docker pull ghcr.io/graysoncadams/todoist-bridge:latest

# Create directories
mkdir -p ./data ./credentials

# Create config file (see Configuration section)
cp config.example.yaml config.yaml
# Edit config.yaml with your settings

# Run the container
docker run -d \
  --name todoist-bridge \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/credentials:/app/credentials \
  -v $(pwd)/data:/app/data \
  ghcr.io/graysoncadams/todoist-bridge:latest
```

---

## Installation

### Docker (Recommended)

Docker provides the simplest deployment path with automatic updates and isolation.

```bash
docker pull ghcr.io/graysoncadams/todoist-bridge:latest
```

See [Docker Compose](#docker-compose) for a complete example.

### Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  todoist-bridge:
    image: ghcr.io/graysoncadams/todoist-bridge:latest
    container_name: todoist-bridge
    restart: unless-stopped
    volumes:
      - ./config.yaml:/app/config.yaml:ro
      - ./credentials:/app/credentials
      - ./data:/app/data
    ports:
      - "3000:3000"  # Google OAuth web form (first run only)
      - "3001:3001"  # Alexa auth proxy (first run only, if using Alexa)
    environment:
      - LOG_LEVEL=info
      - TZ=America/New_York
```

> **Note:** Ports are only needed for initial authorization. After tokens/cookies are saved, you can remove the port mappings. For Alexa, also set `proxy_host` in config.yaml to your Docker host's IP.

Run with:

```bash
docker compose up -d
docker compose logs -f
```

### Manual Installation

**Requirements:**
- Node.js 20.0.0 or higher
- npm

```bash
# Clone the repository
git clone https://github.com/GraysonCAdams/todoist-bridge.git
cd todoist-bridge

# Install dependencies
npm install

# Build
npm run build

# Configure
cp config.example.yaml config.yaml
# Edit config.yaml

# Run
npm start
```

For development:

```bash
npm run dev
```

---

## Configuration

Todoist Bridge uses a YAML configuration file with environment variable overrides.

### Minimal Configuration

Choose one or more sources to sync. Each source can be enabled or disabled independently.

**Google Tasks only:**

```yaml
todoist:
  api_token: "your-todoist-api-token"

sources:
  google:
    enabled: true
    lists:
      - source_list_id: "YOUR_GOOGLE_LIST_ID"
        todoist_project_id: "YOUR_TODOIST_PROJECT_ID"
  alexa:
    enabled: false
```

**Alexa only:**

```yaml
todoist:
  api_token: "your-todoist-api-token"

sources:
  google:
    enabled: false
  alexa:
    enabled: true
    amazon_page: "amazon.com"
    lists:
      - source_list_id: "all"
        todoist_project_id: "YOUR_TODOIST_PROJECT_ID"
```

**Both sources:**

```yaml
todoist:
  api_token: "your-todoist-api-token"

sources:
  google:
    enabled: true
    lists:
      - source_list_id: "YOUR_GOOGLE_LIST_ID"
        todoist_project_id: "YOUR_TODOIST_PROJECT_ID"
  alexa:
    enabled: true
    lists:
      - source_list_id: "all"
        todoist_project_id: "YOUR_ALEXA_PROJECT_ID"
```

**Microsoft To-Do (bi-directional):**

```yaml
todoist:
  api_token: "your-todoist-api-token"

sources:
  google:
    enabled: false
  alexa:
    enabled: false
  microsoft:
    enabled: true
    client_id: "your-azure-app-client-id"
    tenant_id: "consumers"  # Use "consumers" for personal Microsoft accounts
    lists:
      - list_name: "Groceries"
        todoist_project_id: "inbox"
        tags: ["grocery"]
    assign_to_self: true               # For shared lists
    exclude_others_assignments: true   # Ignore items from other users
```

### Full Configuration

```yaml
# Todoist configuration
todoist:
  api_token: "your-todoist-api-token"

# Sources to sync from
sources:
  # Google Tasks (one-way sync to Todoist)
  google:
    enabled: true
    poll_interval_minutes: 5
    credentials_path: "./credentials/google-credentials.json"
    token_path: "./credentials/google-token.json"
    lists:
      - source_list_id: "abc123"
        todoist_project_id: "456789"  # or "inbox"
        include_completed: false
        delete_after_sync: false
        tags:
          - "google-tasks"

  # Alexa Reminders (one-way sync to Todoist)
  alexa:
    enabled: false
    poll_interval_minutes: 5
    cookie_path: "./credentials/alexa-cookie.json"
    amazon_page: "amazon.com"
    proxy_port: 3001
    proxy_host: "192.168.1.140"  # Your Docker host IP (for external access)
    fail_silently: true
    max_retries: 3
    lists:
      - source_list_id: "all"
        todoist_project_id: "789012"
        tags:
          - "alexa"
    # Shopping list sync
    sync_shopping_list:
      enabled: false
      todoist_project_id: "123456"
      tags:
        - "shopping"

  # Microsoft To-Do (bi-directional sync with Todoist)
  microsoft:
    enabled: false
    client_id: "your-azure-app-client-id"
    tenant_id: "consumers"  # Use "consumers" for personal accounts
    token_path: "./credentials/microsoft-token.json"
    poll_interval_minutes: 3
    lists:
      - list_name: "Groceries"
        todoist_project_id: "inbox"
        tags: ["grocery"]
    assign_to_self: false              # Assign items from Todoist to yourself
    exclude_others_assignments: true   # Ignore items from other users

# Global sync settings
sync:
  sync_completed_once: true

# Storage
storage:
  database_path: "./data/sync.db"

# Logging
logging:
  level: "info"  # trace, debug, info, warn, error
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TODOIST_API_TOKEN` | Todoist API token | - |
| `DATABASE_PATH` | SQLite database path | `./data/sync.db` |
| `POLL_INTERVAL_MINUTES` | Sync interval | `5` |
| `LOG_LEVEL` | Log verbosity | `info` |

---

## Usage

### First Run Authentication

#### Google Tasks

**Google Cloud Console Setup:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Tasks API**
4. Go to **APIs & Services** > **Credentials**
5. Create OAuth credentials > **Desktop app** (not "Web application")
6. Download the credentials JSON
7. Save as `./credentials/google-credentials.json`

**Authorization Flow:**

On first run, you'll be prompted to authorize with Google:

**Interactive mode (CLI/Terminal):**
1. A URL will be printed to the console
2. Open the URL in your browser
3. Sign in with your Google account
4. Grant access to Google Tasks
5. Google displays an authorization code - copy it
6. Paste the code in the terminal when prompted
7. The token is saved for future runs

**Docker mode (Non-interactive):**
1. Check the container logs for the Google authorization URL
2. Open the URL in your browser and authorize
3. Google displays an authorization code - copy it
4. Visit `http://localhost:3000/auth` (or your Docker host)
5. Paste the authorization code in the web form
6. The token is saved for future runs

> **Note:** For Docker, ensure port 3000 is exposed for the initial authorization:
> ```yaml
> ports:
>   - "3000:3000"
> ```

#### Alexa (if enabled)

1. A proxy server starts on the configured port (default: 3001)
2. Open `http://localhost:3001` in your browser (or your Docker host IP)
3. Sign in with your Amazon account
4. Cookies are saved for future runs

> **Note for Docker:** When running in Docker, set `proxy_host` in your config to your Docker host's IP address (e.g., `192.168.1.140`) so the authentication redirects work correctly. Also expose the proxy port:
> ```yaml
> # config.yaml
> sources:
>   alexa:
>     proxy_port: 3001
>     proxy_host: "192.168.1.140"  # Your Docker host IP
> ```
> ```yaml
> # docker-compose.yml
> ports:
>   - "3001:3001"
> ```

#### Microsoft To-Do (if enabled)

**Azure App Registration Setup:**

1. Go to [Azure Portal](https://portal.azure.com/) > **App registrations**
2. Click **New registration**
3. Configure the app:
   - **Name:** `Todoist Bridge` (or any name you prefer)
   - **Supported account types:** Select **"Personal Microsoft accounts only"** (recommended for personal To-Do)
4. Click **Register** (leave Redirect URI blank)
5. Copy the **Application (client) ID** - you'll need this for config
6. Go to **API permissions** > **Add a permission**:
   - Select **Microsoft Graph**
   - Choose **Delegated permissions**
   - Add: `Tasks.ReadWrite`, `User.Read`
   - Click **Add permissions**
7. Go to **Authentication**:
   - Under **Advanced settings**, set **Allow public client flows** to **Yes**
   - Click **Save**

> **Important:** Use `tenant_id: "consumers"` in your config for personal Microsoft accounts (@outlook.com, @hotmail.com, etc.)

**Device Code Authentication Flow:**

Microsoft To-Do uses Device Code Flow, which works in any environment (CLI, Docker, headless servers):

1. On first run, the app displays a message like:
   ```
   To sign in, use a web browser to open https://microsoft.com/devicelogin
   and enter the code: ABCD1234
   ```
2. Open that URL in **any browser** (can be on your phone or another computer)
3. Enter the code shown in your terminal
4. Sign in with the **Microsoft account that has the To-Do lists you want to sync**
5. Grant the requested permissions (Tasks.ReadWrite, User.Read)
6. Return to your terminal - authentication completes automatically
7. Token is saved to `./credentials/microsoft-token.json` for future runs

> **Which account gets linked?** Whatever Microsoft account you sign into during step 4 is the one that gets linked. This is how you choose which To-Do lists to sync - by signing into the correct account.

> **Shared Lists:** If you're syncing a shared Microsoft To-Do list, sign in with your own account. Enable `exclude_others_assignments: true` to ignore items added by other users.

### Finding IDs

See the [Wiki: Finding IDs](../../wiki/Finding-IDs) for detailed instructions on obtaining:
- Google Task List IDs
- Todoist Project IDs

### Field Mapping

**Google Tasks / Alexa → Todoist:**

| Source | Todoist | Notes |
|--------|---------|-------|
| Title | Content | Direct mapping |
| Notes/Description | Description | Direct mapping |
| Status | is_completed | Mapped appropriately |
| Due Date | due_date | Date only |
| Parent | parent_id | Single level subtasks |

**Microsoft To-Do ↔ Todoist (bi-directional):**

| Microsoft To-Do | Todoist | Notes |
|-----------------|---------|-------|
| title | content | Syncs both directions |
| body.content | description | Syncs both directions |
| status | is_completed | Completion syncs both ways |
| dueDateTime | due_date | Date and time preserved |
| importance | priority | high→P1, normal→P4, low→P4 |
| reminderDateTime | (via due) | Mapped to Todoist due time |

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Google Tasks   │     │  Alexa Skills   │     │ Microsoft To-Do │
│      API        │     │      API        │     │   Graph API     │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │ (one-way)             │ (one-way)             │ (bi-directional)
         │                       │                       ↕
         └───────────────────────┼───────────────────────┘
                                 │
                          ┌──────▼──────┐
                          │   Todoist   │
                          │   Bridge    │
                          └──────┬──────┘
                                 │
                          ┌──────▼──────┐
                          │   SQLite    │
                          │  State DB   │
                          └──────┬──────┘
                                 │
                          ┌──────▼──────┐
                          │   Todoist   │
                          │     API     │
                          └─────────────┘
```

### Components

| Component | Description |
|-----------|-------------|
| `src/index.ts` | Main entry point and daemon loop |
| `src/config.ts` | Configuration loading and validation |
| `src/storage.ts` | SQLite state management |
| `src/auth/` | Authentication for Google, Todoist, Alexa |
| `src/clients/` | API client wrappers |
| `src/sources/google/` | Google Tasks source (one-way) |
| `src/sources/alexa/` | Alexa source (one-way) |
| `src/sources/microsoft/` | Microsoft To-Do source (bi-directional) |
| `src/utils/` | Logger and retry utilities |

---

## Wiki

Detailed documentation is available in the [Wiki](../../wiki):

- [Home](../../wiki/Home) - Overview and quick start
- [Installation](../../wiki/Installation) - Detailed installation guide
- [Google Setup](../../wiki/Google-Setup) - Google Cloud and OAuth configuration
- [Alexa Setup](../../wiki/Alexa-Setup) - Amazon Alexa integration
- [Microsoft To-Do Setup](../../wiki/Microsoft-Setup) - Azure AD app registration and bi-directional sync
- [Finding IDs](../../wiki/Finding-IDs) - How to find list and project IDs
- [Docker Deployment](../../wiki/Docker-Deployment) - Container deployment guide
- [Troubleshooting](../../wiki/Troubleshooting) - Common issues and solutions

---

## Contributing

Contributions are welcome. Please open an issue to discuss proposed changes before submitting a pull request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/improvement`)
3. Commit your changes (`git commit -am 'Add improvement'`)
4. Push to the branch (`git push origin feature/improvement`)
5. Open a Pull Request

---

## Credits

Todoist Bridge is built on the work of these projects:

| Project | Description | License |
|---------|-------------|---------|
| [googleapis](https://github.com/googleapis/google-api-nodejs-client) | Google APIs Node.js Client | Apache-2.0 |
| [todoist-api-typescript](https://github.com/Doist/todoist-api-typescript) | Official Todoist TypeScript SDK | MIT |
| [alexa-remote2](https://github.com/Apollon77/alexa-remote) | Alexa Remote Control | MIT |
| [@azure/msal-node](https://github.com/AzureAD/microsoft-authentication-library-for-js) | Microsoft Authentication Library | MIT |

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

```
MIT License

Copyright (c) 2024

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
