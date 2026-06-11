#!/bin/sh
set -e

# Write config and credentials from env vars (Fly.io / CI deployments)
# These env vars hold the full file contents as strings

if [ -n "$GOOGLE_CREDENTIALS" ]; then
    mkdir -p /app/credentials
    printf '%s' "$GOOGLE_CREDENTIALS" > /app/credentials/google-credentials.json
fi

if [ -n "$GOOGLE_TOKEN" ]; then
    mkdir -p /app/credentials
    printf '%s' "$GOOGLE_TOKEN" > /app/credentials/google-token.json
fi

if [ -n "$ALEXA_COOKIE" ]; then
    mkdir -p /app/credentials
    printf '%s' "$ALEXA_COOKIE" > /app/credentials/alexa-cookie.json
fi

# Fix permissions on mounted volumes if running as root, then drop to non-root user
if [ "$(id -u)" = "0" ]; then
    chown -R appuser:appgroup /app/data /app/credentials 2>/dev/null || true
    exec su-exec appuser node dist/index.js "$@"
else
    exec node dist/index.js "$@"
fi
