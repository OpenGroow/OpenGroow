# Contributing to OpenClaw Docker Config

Thank you for your interest in contributing! This repository provides Docker configuration for deploying OpenClaw.

## How to Contribute

### Reporting Issues

Before creating an issue:
- Check existing issues to avoid duplicates
- Verify the issue is related to the Docker configuration, not OpenClaw itself

When creating an issue, include:
- **Clear title** describing the problem
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
- **Environment** (OS, Docker version, OpenClaw version)
- **Relevant logs** from `docker compose logs`

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues:
- Use a clear, descriptive title
- Explain the proposed functionality
- Describe why it would be useful
- Provide examples of usage

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Test your changes**:
   - Build the Docker image locally
   - Test deployment on a VPS or local environment
   - Verify all configurations work as expected
3. **Update documentation**:
   - Update README.md if adding new features
   - Document new environment variables
   - Update configuration examples
4. **Commit with clear messages**:
   - Use present tense ("Add feature" not "Added feature")
   - Reference issues when relevant
   - Keep commits focused on single concerns

### Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/openclaw-docker-config.git
cd openclaw-docker-config

# Set up environment
cp docker/.env.example docker/.env
vim docker/.env  # Add your configuration

# Test build
cd docker
docker compose build

# Test deployment (requires infra repo)
# See README.md for full deployment instructions
```

## Configuration Guidelines

When adding or modifying configuration:

- Use environment variables for all user-specific values
- Provide sensible defaults with `${VAR:-default}` syntax
- Document all variables in `docker/.env.example`
- Keep skills minimal and generic
- Avoid hardcoding paths, usernames, or domains

## Skill Contributions

When adding skills to the manifest:

- Only add well-tested ClawHub skills
- Document the skill's purpose in `config/skills-manifest.txt`
- Avoid personal or niche use-case skills
- Test skill installation in a fresh deployment

## Code Style

- Use consistent formatting (2-space indentation for YAML/JSON)
- Comment complex configurations
- Keep docker-compose.yml organized and readable
- Follow Docker best practices (multi-stage builds, layer caching)

## Questions?

- Check the [README](README.md) first
- Open a discussion for general questions
- Join the OpenClaw community channels
- Reference the [OpenClaw documentation](https://docs.openclaw.ai/)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
