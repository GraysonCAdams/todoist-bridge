# Docker Deployment

This guide covers deploying Todoist Bridge with Docker and Docker Compose.

## Quick Start

```bash
# Pull image
docker pull ghcr.io/graysoncadams/todoist-bridge:latest

# Create directories
mkdir -p ./data ./credentials

# Create and edit config
cp config.example.yaml config.yaml
# Edit config.yaml

# Run
docker run -d \
  --name todoist-bridge \
  --restart unless-stopped \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/credentials:/app/credentials \
  -v $(pwd)/data:/app/data \
  ghcr.io/graysoncadams/todoist-bridge:latest
```

## Docker Compose

### Basic Setup

Create `docker-compose.yml`:

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
      - TZ=America/New_York
      - LOG_LEVEL=info
```

### With Port Exposure (for initial auth)

```yaml
services:
  todoist-bridge:
    image: ghcr.io/graysoncadams/todoist-bridge:latest
    container_name: todoist-bridge
    restart: unless-stopped
    ports:
      - "3000:3000"  # Google OAuth callback
      - "3001:3001"  # Alexa auth proxy
    volumes:
      - ./config.yaml:/app/config.yaml:ro
      - ./credentials:/app/credentials
      - ./data:/app/data
    environment:
      - TZ=America/New_York
      - LOG_LEVEL=info
```

### Production Setup

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
      - TZ=America/New_York
      - LOG_LEVEL=info
      - NODE_ENV=production
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
        reservations:
          memory: 128M
    healthcheck:
      test: ["CMD", "node", "-e", "console.log('healthy')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## Commands

### Start

```bash
docker compose up -d
```

### View Logs

```bash
# Follow logs
docker compose logs -f

# Last 100 lines
docker compose logs --tail 100

# Specific service
docker compose logs todoist-bridge
```

### Stop

```bash
docker compose down
```

### Restart

```bash
docker compose restart
```

### Update

```bash
docker compose pull
docker compose up -d
```

## Volume Management

### Required Volumes

| Volume | Purpose | Read-Only |
|--------|---------|-----------|
| `config.yaml` | Configuration | Yes |
| `credentials/` | OAuth tokens | No |
| `data/` | SQLite database | No |

### Data Persistence

Data is stored in mounted volumes:

```bash
./data/sync.db           # SQLite database
./credentials/           # OAuth tokens
```

### Backup

```bash
# Stop the container
docker compose stop

# Backup
tar -czvf backup.tar.gz data/ credentials/ config.yaml

# Restart
docker compose start
```

### Restore

```bash
# Stop container
docker compose stop

# Restore
tar -xzvf backup.tar.gz

# Restart
docker compose start
```

## First-Time Authentication

OAuth flows require browser interaction. For first-time setup:

### Option 1: Interactive Container

```bash
docker run -it --rm \
  -p 3000:3000 \
  -p 3001:3001 \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/credentials:/app/credentials \
  -v $(pwd)/data:/app/data \
  ghcr.io/graysoncadams/todoist-bridge:latest
```

Complete authorization in browser, then Ctrl+C and start normally.

### Option 2: Authenticate on Host First

1. Install Node.js on the host
2. Run `npm install && npm run build && npm start`
3. Complete authorization
4. Stop the host process
5. Start Docker container (credentials already exist)

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `LOG_LEVEL` | Log verbosity | `info` |
| `TZ` | Timezone | UTC |
| `TODOIST_API_TOKEN` | API token override | - |
| `DATABASE_PATH` | Database path override | `/app/data/sync.db` |
| `POLL_INTERVAL_MINUTES` | Sync interval override | `5` |

## Multi-Architecture Support

The image supports:
- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64, Apple Silicon, Raspberry Pi 4)

Docker automatically pulls the correct architecture.

## Image Tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest stable release |
| `v1.0.0` | Specific version |
| `main` | Latest main branch build |
| `sha-abc123` | Specific commit |

## Security Considerations

### Non-Root User

The container runs as a non-root user (`appuser:appgroup`, UID/GID 1001).

### Read-Only Config

Mount config as read-only:

```yaml
volumes:
  - ./config.yaml:/app/config.yaml:ro
```

### Secrets Management

For production, consider using Docker secrets:

```yaml
secrets:
  todoist_token:
    file: ./secrets/todoist_token.txt

services:
  todoist-bridge:
    secrets:
      - todoist_token
    environment:
      - TODOIST_API_TOKEN_FILE=/run/secrets/todoist_token
```

## Networking

### No Inbound Connections Required

After initial OAuth setup, Todoist Bridge only makes outbound connections:
- Google APIs (googleapis.com)
- Todoist API (todoist.com)
- Amazon (for Alexa)

### Proxy Configuration

If behind a proxy:

```yaml
environment:
  - HTTP_PROXY=http://proxy:8080
  - HTTPS_PROXY=http://proxy:8080
  - NO_PROXY=localhost,127.0.0.1
```

## Monitoring

### Health Checks

The image includes a basic health check. For more advanced monitoring:

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "require('fs').existsSync('/app/data/sync.db')"]
  interval: 60s
  timeout: 10s
  retries: 3
```

### Log Aggregation

Use Docker's logging drivers:

```yaml
logging:
  driver: "syslog"
  options:
    syslog-address: "udp://logserver:514"
    tag: "todoist-bridge"
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs

# Verify config
docker compose config
```

### Permission errors

```bash
# Fix ownership
sudo chown -R 1001:1001 ./data ./credentials
```

### Database locked

```bash
# Stop container
docker compose stop

# Check for stale locks
ls -la ./data/

# Restart
docker compose start
```

## Next Steps

- [Troubleshooting](Troubleshooting) - Common issues
- [Configuration](Configuration) - Full config reference
