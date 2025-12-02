# Installation

This guide covers all installation methods for Todoist Bridge.

## System Requirements

| Requirement | Minimum |
|-------------|---------|
| Node.js | 20.0.0+ |
| Memory | 128 MB |
| Disk | 50 MB + database |
| Network | Outbound HTTPS |

## Installation Methods

### Docker (Recommended)

Docker provides isolation and easy updates.

```bash
# Pull the latest image
docker pull ghcr.io/YOUR_USERNAME/todoist-bridge:latest

# Create required directories
mkdir -p ./data ./credentials

# Copy and edit configuration
wget -O config.yaml https://raw.githubusercontent.com/YOUR_USERNAME/todoist-bridge/main/config.example.yaml
# Edit config.yaml with your settings

# Run
docker run -d \
  --name todoist-bridge \
  --restart unless-stopped \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/credentials:/app/credentials \
  -v $(pwd)/data:/app/data \
  ghcr.io/YOUR_USERNAME/todoist-bridge:latest
```

### Docker Compose

See [Docker Deployment](Docker-Deployment) for a complete Docker Compose setup.

### Manual Installation

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/todoist-bridge.git
cd todoist-bridge

# Install dependencies
npm install

# Build TypeScript
npm run build

# Create configuration
cp config.example.yaml config.yaml
# Edit config.yaml

# Run
npm start
```

### Development Mode

For development with auto-reload:

```bash
npm run dev
```

## Directory Structure

After installation, your directory should look like:

```
todoist-bridge/
├── config.yaml          # Your configuration
├── credentials/         # OAuth tokens (auto-created)
│   ├── google-credentials.json  # You provide this
│   ├── google-token.json        # Auto-generated
│   └── alexa-cookie.json        # Auto-generated
├── data/               # Database (auto-created)
│   └── sync.db
└── ...
```

## Post-Installation

After installation, configure the sources you want to use. **You don't need both** - choose Google Tasks, Alexa, or both.

### If using Google Tasks:
1. Follow [Google Setup](Google-Setup) to configure OAuth
2. Get your list IDs from [Finding IDs](Finding-IDs)

### If using Alexa:
1. Follow [Alexa Setup](Alexa-Setup) to configure authentication
2. No special IDs needed - use `"all"` for reminders

### Then:
1. Edit `config.yaml` with your mappings
2. Set `enabled: false` for sources you don't want
3. Start the application

## Updating

### Docker

```bash
docker pull ghcr.io/YOUR_USERNAME/todoist-bridge:latest
docker stop todoist-bridge
docker rm todoist-bridge
# Re-run docker run command
```

### Manual

```bash
git pull
npm install
npm run build
npm start
```

## Running as a Service

### systemd (Linux)

Create `/etc/systemd/system/todoist-bridge.service`:

```ini
[Unit]
Description=Todoist Bridge Daemon
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/todoist-bridge
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable todoist-bridge
sudo systemctl start todoist-bridge
sudo systemctl status todoist-bridge
```

### launchd (macOS)

Create `~/Library/LaunchAgents/com.todoist-bridge.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.todoist-bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/todoist-bridge/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/todoist-bridge</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/todoist-bridge.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/todoist-bridge.error.log</string>
</dict>
</plist>
```

Load the service:

```bash
launchctl load ~/Library/LaunchAgents/com.todoist-bridge.plist
```

## Next Steps

- [Google Setup](Google-Setup) - Configure Google OAuth
- [Configuration](Configuration) - Full configuration reference
