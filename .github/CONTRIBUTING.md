# Contributing to Todoist Bridge

Thank you for your interest in contributing to Todoist Bridge.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/todoist-bridge.git`
3. Create a branch: `git checkout -b feature/your-feature-name`
4. Install dependencies: `npm install`
5. Make your changes
6. Test your changes: `npm run build && npm start`
7. Commit your changes: `git commit -am 'Add feature'`
8. Push to your fork: `git push origin feature/your-feature-name`
9. Open a Pull Request

## Development Setup

### Prerequisites

- Node.js 20+
- npm
- Google Cloud account (for testing Google Tasks)
- Todoist account (for testing)
- (Optional) Amazon account (for testing Alexa)

### Running Locally

```bash
# Install dependencies
npm install

# Development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

### Project Structure

```
src/
├── index.ts          # Entry point
├── config.ts         # Configuration loading
├── storage.ts        # SQLite database
├── auth/             # Authentication modules
├── clients/          # API client wrappers
├── sync/             # Sync engines
└── utils/            # Utilities (logger, retry)
```

## Code Style

- Use TypeScript strict mode
- Follow existing code patterns
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions focused and small

## Commit Messages

Use clear, descriptive commit messages:

- `fix: resolve token refresh issue`
- `feat: add support for task priority`
- `docs: update configuration examples`
- `refactor: simplify sync engine logic`

## Pull Request Guidelines

1. **One feature per PR**: Keep PRs focused on a single change
2. **Update documentation**: If your change affects usage, update docs
3. **Test your changes**: Ensure the build passes and functionality works
4. **Describe your changes**: Explain what and why in the PR description

## Reporting Issues

When reporting bugs, please include:

- Todoist Bridge version
- Deployment method (Docker/native)
- Relevant configuration (redact secrets)
- Log output with `LOG_LEVEL=debug`
- Steps to reproduce

## Feature Requests

Before submitting a feature request:

1. Check existing issues for similar requests
2. Consider if it fits the project scope
3. Provide a clear use case

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on the issue, not the person

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
