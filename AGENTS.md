# Repository Guidelines

## Project Structure & Module Organization

This workspace currently has no application source, tests, assets, or build configuration. No language or framework is established. When adding the first implementation, document its directory layout and entry point in `README.md`.

Keep related functionality together. Follow the chosen framework’s standard layout; otherwise, use `src/` for application code, `tests/` for automated checks, and `assets/` for static resources. Create these directories only when needed.

## Build, Test, and Development Commands

No install, build, test, or development commands are currently configured. Do not assume commands such as `npm test` or `make build` exist.

When introducing a toolchain, add reproducible commands to `README.md` for dependency installation, local development, testing, and production builds. Include required runtime versions and commit the appropriate dependency lockfile.

## Coding Style & Naming Conventions

Use the selected language’s conventional formatting and naming. Configure a formatter or linter with the first implementation, then follow that configuration consistently.

Prefer descriptive names, small functions, and focused modules. Avoid unrelated formatting changes and dependencies that duplicate existing functionality.

## Testing Guidelines

No test framework or coverage threshold is configured. Add a suitable framework when application behavior is introduced. Test files should identify the module or behavior they cover and follow the framework’s discovery conventions.

Cover new behavior and regression cases. Document the exact test command and any required services or fixtures.

## Commit & Pull Request Guidelines

Git history is unavailable in this workspace, so no existing commit convention can be verified. Use concise, imperative subjects, such as `Add terminal session handling`, and keep commits focused.

Pull requests should describe the change, link relevant issues, and report validation performed. Include screenshots for visible interface changes and explicitly identify any checks not run.

## Security & Configuration

Keep credentials, tokens, local settings, and generated artifacts out of version control. Document required environment variables using placeholder values in an example configuration file.
