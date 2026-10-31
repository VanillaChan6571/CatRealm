# Contributing to CatRealm Client

Thanks for helping improve the official CatRealm client.

## What Contributions Are Wanted

Good contributions include:

- bug fixes
- reliability improvements
- UX polish
- performance fixes
- focused feature work that has already been discussed or proposed

Please keep pull requests scoped. Small, reviewable fixes are much easier to merge than broad refactors mixed with unrelated cleanup.

## Before You Start

1. Check for an existing issue or discussion.
2. If the change is a new feature or behavior change, open a proposal first.
3. For bug fixes, include a clear reproduction and the expected behavior.

## Development Workflow

Install dependencies:

```bash
npm install
```

Run the web client:

```bash
npm run dev
```

Run the desktop client:

```bash
npm run dev:electron
```

Build before submitting:

```bash
npm run build
```

Run tests when your change touches tested behavior:

```bash
npm test
```

## Code Expectations

- Follow the existing project structure and patterns.
- Prefer focused edits over large stylistic rewrites.
- Keep official CatRealm branding and official-service defaults intact unless the change explicitly targets configuration behavior.
- Preserve contributor-facing debug tooling unless the change is specifically about cleaning or gating it.
- Add or update tests for behavior regressions when practical.

## Pull Request Guidance

A good PR should include:

- what changed
- why it changed
- how it was tested
- screenshots or recordings for UI changes when helpful

If the PR fixes a bug, include the reproduction and the confirmation that it no longer occurs.

## License

By contributing, you agree that your contributions will be licensed under **AGPL-3.0-or-later** with the rest of the project.

