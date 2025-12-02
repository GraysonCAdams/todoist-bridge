<p align="center">
  <h1 align="center">Todoist Bridge</h1>
  <p align="center">
    Unified task synchronization from Google Tasks and Alexa to Todoist
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

Todoist Bridge is a Node.js daemon that performs continuous one-way synchronization from Google Tasks and/or Amazon Alexa to Todoist. It runs as a background service, polling your task sources at configurable intervals and automatically creating, updating, and completing tasks in Todoist.

### Supported Sources

You can use **any combination** of the following sources:

| Source | Description |
|--------|-------------|
| Google Tasks | Sync task lists from Google Tasks |
| Alexa Reminders | Sync reminders from Alexa devices |
| Alexa Shopping List | Sync your Alexa shopping list |

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
| **Custom Tags** | Apply labels to synced tasks for easy filtering |
| **Flexible Mapping** | Map any source list to any Todoist project or Inbox |
| **Subtask Support** | Single-level subtask hierarchy preserved |
| **Completed Tasks** | Optional retroactive import of completed tasks |
| **Delete After Sync** | Optionally remove tasks from source after syncing |
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
    environment:
      - LOG_LEVEL=info
      - TZ=America/New_York
```

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

### Full Configuration

```yaml
# Polling interval in minutes
poll_interval_minutes: 5

# Todoist configuration
todoist:
  api_token: "your-todoist-api-token"

# Sources to sync from
sources:
  # Google Tasks
  google:
    enabled: true
    credentials_path: "./credentials/google-credentials.json"
    token_path: "./credentials/google-token.json"
    lists:
      - source_list_id: "abc123"
        todoist_project_id: "456789"  # or "inbox"
        include_completed: false
        delete_after_sync: false
        tags:
          - "google-tasks"

  # Alexa Reminders
  alexa:
    enabled: false
    cookie_path: "./credentials/alexa-cookie.json"
    amazon_page: "amazon.com"
    proxy_port: 3001
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

On first run, you'll be prompted to authorize with Google:

1. A URL will be printed to the console
2. Open the URL in your browser
3. Sign in with your Google account
4. Grant access to Google Tasks
5. The token is saved for future runs

#### Alexa (if enabled)

1. A proxy server starts on the configured port (default: 3001)
2. Open `http://localhost:3001` in your browser
3. Sign in with your Amazon account
4. Cookies are saved for future runs

### Finding IDs

See the [Wiki: Finding IDs](../../wiki/Finding-IDs) for detailed instructions on obtaining:
- Google Task List IDs
- Todoist Project IDs

### Field Mapping

| Source | Todoist | Notes |
|--------|---------|-------|
| Title | Content | Direct mapping |
| Notes/Description | Description | Direct mapping |
| Status | is_completed | Mapped appropriately |
| Due Date | due_date | Date only |
| Parent | parent_id | Single level subtasks |

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Google Tasks   │     │  Alexa Skills   │
│      API        │     │      API        │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼──────┐
              │  Todoist Bridge  │
              │   Daemon    │
              └──────┬──────┘
                     │
              ┌──────▼──────┐
              │   SQLite    │
              │  State DB   │
              └──────┬──────┘
                     │
              ┌──────▼──────┐
              │  Todoist    │
              │    API      │
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
| `src/sync/` | Sync engines and mappers |
| `src/utils/` | Logger and retry utilities |

---

## Wiki

Detailed documentation is available in the [Wiki](../../wiki):

- [Home](../../wiki/Home) - Overview and quick start
- [Installation](../../wiki/Installation) - Detailed installation guide
- [Google Setup](../../wiki/Google-Setup) - Google Cloud and OAuth configuration
- [Alexa Setup](../../wiki/Alexa-Setup) - Amazon Alexa integration
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
