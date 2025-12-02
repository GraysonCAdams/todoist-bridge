# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email the maintainer directly (check repository owner's profile)
3. Include a detailed description of the vulnerability
4. Provide steps to reproduce if possible

### What to Include

- Type of vulnerability
- Affected component (auth, sync, storage, etc.)
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Initial response**: Within 48 hours
- **Status update**: Within 7 days
- **Resolution target**: Within 30 days (depending on severity)

## Security Best Practices for Users

### Credential Storage

- Never commit `credentials/` directory contents
- Never commit `config.yaml` with real tokens
- Use environment variables in CI/CD
- Set restrictive file permissions: `chmod 600 credentials/*`

### Docker Security

- Run as non-root user (default in our image)
- Mount config as read-only: `-v ./config.yaml:/app/config.yaml:ro`
- Use specific image tags, not `latest` in production
- Regularly update to latest versions

### Network Security

- Todoist Bridge only makes outbound HTTPS connections
- No inbound ports required after initial OAuth setup
- Consider running in isolated network if possible

## Known Security Considerations

### Alexa Integration

The Alexa integration uses `alexa-remote2`, an unofficial library that stores Amazon session cookies. These cookies provide access to your Amazon account's Alexa features. Keep `alexa-cookie.json` secure.

### OAuth Tokens

Google OAuth tokens in `google-token.json` provide access to your Google Tasks. While scoped to Tasks only, protect these files.

### API Tokens

Your Todoist API token provides full access to your Todoist account. Never expose it in logs or public repositories.
