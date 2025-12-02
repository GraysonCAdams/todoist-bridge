# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release
- Google Tasks to Todoist synchronization
- Alexa Reminders to Todoist synchronization
- Alexa Shopping List to Todoist synchronization
- Docker support with multi-arch builds (amd64, arm64)
- Configurable polling intervals
- Custom tag support per sync mapping
- SQLite-based state tracking
- Graceful shutdown handling
- Health status tracking
- Production logging (JSON) and development logging (pretty)

### Security
- Non-root Docker user
- Credential isolation via volume mounts

## [1.0.0] - YYYY-MM-DD

### Added
- Initial public release

[Unreleased]: https://github.com/GraysonCAdams/todoist-bridge/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/GraysonCAdams/todoist-bridge/releases/tag/v1.0.0
