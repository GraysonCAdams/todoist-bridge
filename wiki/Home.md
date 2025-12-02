# Todoist Bridge Wiki

Welcome to the Todoist Bridge documentation. This wiki provides detailed guides for setting up and running Todoist Bridge.

## Overview

Todoist Bridge is a background daemon that synchronizes tasks from Google Tasks and/or Amazon Alexa to Todoist. It runs continuously, polling your task sources at configurable intervals.

### Flexible Source Configuration

You can enable **any combination** of sources:

- Google Tasks only
- Alexa only (reminders and/or shopping list)
- Both Google Tasks and Alexa

Each source is independently configurable - use only what you need.

## Quick Navigation

| Page | Description |
|------|-------------|
| [Installation](Installation) | System requirements and installation methods |
| [Google Setup](Google-Setup) | Google Cloud Console and OAuth configuration |
| [Alexa Setup](Alexa-Setup) | Amazon Alexa integration setup |
| [Finding IDs](Finding-IDs) | How to locate list and project IDs |
| [Docker Deployment](Docker-Deployment) | Running with Docker and Docker Compose |
| [Configuration](Configuration) | Complete configuration reference |
| [Troubleshooting](Troubleshooting) | Common issues and solutions |

## Quick Start

### 1. Prerequisites

**Required:**
- Node.js 20+ (or Docker)
- Todoist account

**Optional (choose one or both):**
- Google Cloud account (for Google Tasks sync)
- Amazon Alexa account (for Alexa sync)

### 2. Get API Credentials

- **Todoist** (required): Copy API token from Settings > Integrations > Developer
- **Google** (if using): Create OAuth credentials in Google Cloud Console
- **Alexa** (if using): Authenticate via browser during first run

### 3. Configure

Create `config.yaml` with your settings:

```yaml
todoist:
  api_token: "your-token"

sources:
  google:
    enabled: true
    lists:
      - source_list_id: "your-google-list-id"
        todoist_project_id: "your-todoist-project-id"
```

### 4. Run

```bash
# Docker
docker run -d \
  -v ./config.yaml:/app/config.yaml:ro \
  -v ./credentials:/app/credentials \
  -v ./data:/app/data \
  ghcr.io/YOUR_USERNAME/todoist-bridge:latest

# Or native
npm install && npm run build && npm start
```

## How It Works

1. **Polling**: The daemon polls configured sources at the specified interval
2. **Detection**: Changes are detected by comparing against the SQLite state database
3. **Sync**: New, updated, or deleted tasks are synchronized to Todoist
4. **State**: Sync state is persisted for reliable change tracking

## Architecture

```
Sources (Google Tasks, Alexa)
         │
         ▼
    ┌─────────┐
    │  Sync   │ ← Polling Loop
    │ Engine  │
    └────┬────┘
         │
    ┌────▼────┐
    │ SQLite  │ ← State Tracking
    │   DB    │
    └────┬────┘
         │
         ▼
     Todoist API
```

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/YOUR_USERNAME/todoist-bridge/issues) page.
