# Contributing to qorechain-sdk

Thanks for your interest in contributing! This is an open, community-driven
project and we welcome issues, pull requests, and discussion.

## Getting started

This is a [pnpm](https://pnpm.io/) monorepo. After cloning:

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Before you push

Please make sure the following all pass locally before opening a pull request:

```bash
pnpm -r build
pnpm -r lint
pnpm -r typecheck
pnpm -r test
bash scripts/check.sh
```

The `scripts/check.sh` check must report `OK`.

## Pull requests

- Keep changes focused and well described.
- Add or update tests for any behavior change.
- Add a changeset (`pnpm changeset`) when your change affects a published package.
- Follow the existing code style; formatting and linting are enforced in CI.

## Code of Conduct

By participating in this project you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Reporting security issues

Please do not open public issues for security vulnerabilities. See
[SECURITY.md](./SECURITY.md) for responsible disclosure instructions.
