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
```

## Maintainers: proto sync (pre-release)

The TypeScript codegen is generated from the vendored protos under
`proto/qorechain/**`, which mirror the chain core protos. Before cutting a
release, maintainers should confirm the vendored protos still match the chain by
running the local drift check:

```bash
# Uses the default local core path; override with CORE_PROTO=/path/... if needed.
scripts/check-proto-sync.sh
```

This script is intentionally **maintainer-local** and is not part of public CI:
it reads a private, machine-local checkout of the chain core. If it reports
drift, re-sync the affected protos and regenerate codegen
(`scripts/codegen.sh`).

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
