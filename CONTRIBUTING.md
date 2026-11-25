# Contributing to mTerminal

Use GitHub Issues for bug reports and feature requests. Search existing issues first.
For a bug, include the mTerminal version, your operating system and architecture, steps to
reproduce it, and what you expected. Redact hostnames, usernames, credentials, tokens, and
private terminal output before posting. Report vulnerabilities using the [security policy](SECURITY.md).

## Set up the project

Use Node.js 24.12 or newer within Node 24 and npm 11. See the
[README](README.md#develop-from-source) for native dependencies and account service setup.

```sh
npm ci
npm run dev
```

## Open a pull request

1. Branch from `main` and keep the change focused. For a larger change, discuss it in an issue first.
2. Run `npm run check` and the tests relevant to your change. See the
   [README](README.md#develop-from-source) for test commands and prerequisites.
3. Explain what changed, how you verified it, and what remains untested. Link any related issue.
   Include screenshots for visible interface changes.

Follow the [code of conduct](CODE_OF_CONDUCT.md) when participating.
