#!/bin/sh
set -e

# Fix permissions on mounted volumes if running as root
# This allows the container to work out-of-the-box without manual chown
if [ "$(id -u)" = "0" ]; then
    # Ensure data and credentials directories are writable
    chown -R appuser:appgroup /app/data /app/credentials 2>/dev/null || true

    # Drop privileges and run as appuser
    exec su-exec appuser node dist/index.js "$@"
else
    # Already running as non-root, just start the app
    exec node dist/index.js "$@"
fi
