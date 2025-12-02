# Troubleshooting

Common issues and their solutions.

## General Issues

### Application won't start

**Symptom**: Application exits immediately

**Solutions**:
1. Check configuration is valid YAML
2. Verify required fields are set (todoist.api_token)
3. Check file permissions on config and data directories
4. Run with `LOG_LEVEL=debug` for more details

```bash
LOG_LEVEL=debug npm start
```

### "Configuration validation error"

**Symptom**: Error mentioning Zod or validation

**Solutions**:
1. Check YAML syntax (use a validator)
2. Ensure all required fields are present
3. Verify field types match expected types
4. Check for trailing whitespace in values

### Database errors

**Symptom**: SQLite errors

**Solutions**:
```bash
# Check database file permissions
ls -la data/sync.db

# If corrupted, remove and restart
rm data/sync.db
npm start
```

## Google Tasks Issues

### "Google credentials not found"

**Solution**: Download OAuth credentials from Google Cloud Console and save to `credentials/google-credentials.json`.

See [Google Setup](Google-Setup) for details.

### "Todoist API token not configured"

**Solution**: Set token in config.yaml:
```yaml
todoist:
  api_token: "your-token-here"
```

Or via environment:
```bash
export TODOIST_API_TOKEN="your-token-here"
```

### "Authorization timeout"

**Symptom**: Google OAuth times out

**Solutions**:
1. Complete authorization within 5 minutes
2. Ensure port 3000 is accessible
3. Check firewall settings
4. Try a different browser

### "Access blocked: This app's request is invalid"

**Solutions**:
1. Add your email to OAuth consent screen test users
2. Ensure Tasks API is enabled
3. Verify OAuth credentials are for Desktop app type
4. Check project is correct in Cloud Console

### "Token has been expired or revoked"

**Solutions**:
```bash
# Delete existing token
rm credentials/google-token.json

# Restart to re-authorize
npm start
```

### Tasks not syncing

**Checklist**:
1. Verify list ID is correct (use debug logging)
2. Check list isn't empty
3. Verify tasks have titles (empty titles are skipped)
4. Check Todoist project exists
5. Review sync logs for errors

## Alexa Issues

### "Alexa authentication failed"

**Solutions**:
1. Delete cookie file and re-authenticate:
   ```bash
   rm credentials/alexa-cookie.json
   npm start
   ```
2. Verify `amazon_page` matches your region
3. Complete 2FA if prompted

### "Cookie expired"

**Solution**: Re-authenticate
```bash
rm credentials/alexa-cookie.json
npm start
```

### "Unable to connect to Amazon"

**Solutions**:
1. Check internet connectivity
2. Verify `amazon_page` is correct for your region
3. Try a different proxy port
4. Check for Amazon service outages

### Alexa sync fails but Google works

This is expected if `fail_silently: true` is set. Alexa uses an unofficial API that may be unreliable.

**Solutions**:
1. Check Alexa cookie validity
2. Increase `max_retries`
3. Check Amazon account status
4. Wait and retry (temporary Amazon issues)

### Reminders not appearing

**Note**: Only standard reminders are synced. Some Alexa notification types are not supported.

## Todoist Issues

### "Todoist API rate limit exceeded"

**Solutions**:
1. Increase `poll_interval_minutes`
2. Reduce number of synced lists
3. Wait for rate limit to reset (usually 1 minute)

### Tasks created but no tags

**Solutions**:
1. Verify tags are valid label names in Todoist
2. Labels must exist or be creatable
3. Check tags array syntax in config

### Duplicate tasks

**Cause**: Database was reset while tasks exist in Todoist

**Solutions**:
1. Delete duplicates manually in Todoist
2. Database tracks sync state - don't delete it

### Wrong project

**Solution**: Verify `todoist_project_id` is correct:
```bash
curl -s "https://api.todoist.com/rest/v2/projects" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq
```

## Docker Issues

### Container won't start

**Solutions**:
```bash
# Check logs
docker logs todoist-bridge

# Verify mounts
docker inspect todoist-bridge | jq '.[0].Mounts'

# Check permissions
ls -la ./data ./credentials
```

### Permission denied errors

**Solution**: Fix ownership (container runs as UID 1001):
```bash
sudo chown -R 1001:1001 ./data ./credentials
```

### OAuth redirect not working in Docker

**Solutions**:
1. Expose ports during auth:
   ```bash
   docker run -it -p 3000:3000 -p 3001:3001 ...
   ```
2. Or authenticate on host first, then copy credentials

### Database locked

**Cause**: Multiple instances or unclean shutdown

**Solutions**:
```bash
# Stop container
docker stop todoist-bridge

# Remove lock files
rm -f data/sync.db-wal data/sync.db-shm

# Restart
docker start todoist-bridge
```

## Performance Issues

### High CPU usage

**Solutions**:
1. Increase `poll_interval_minutes`
2. Reduce number of lists
3. Check for sync loops in logs

### High memory usage

**Solutions**:
1. Restart the container periodically
2. Check for memory leaks in logs
3. Set memory limits in Docker

### Slow sync

**Solutions**:
1. Reduce number of tasks per list
2. Disable `include_completed`
3. Check network connectivity

## Logging

### Enable debug logging

```bash
LOG_LEVEL=debug npm start
```

Or in config:
```yaml
logging:
  level: "debug"
```

### Log levels

| Level | Description |
|-------|-------------|
| trace | Very verbose, includes all details |
| debug | Detailed operational information |
| info | Normal operation events |
| warn | Potential issues |
| error | Errors that need attention |

### Log output

Logs use structured JSON format (pretty-printed in development).

```
[timestamp] LEVEL - message
```

## Recovery Procedures

### Full reset

```bash
# Stop application
docker stop todoist-bridge  # or Ctrl+C

# Remove all state
rm -rf data/ credentials/

# Reconfigure
cp config.example.yaml config.yaml
# Edit config.yaml

# Restart
docker start todoist-bridge  # or npm start
```

### Partial reset (keep credentials)

```bash
# Stop application
docker stop todoist-bridge

# Remove only database
rm data/sync.db*

# Restart
docker start todoist-bridge
```

## Getting Help

1. Check logs with `LOG_LEVEL=debug`
2. Review this troubleshooting guide
3. Search [GitHub Issues](https://github.com/YOUR_USERNAME/todoist-bridge/issues)
4. Open a new issue with:
   - Error message
   - Relevant logs (redact tokens)
   - Configuration (redact secrets)
   - Steps to reproduce
