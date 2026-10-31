# CatRealm Client

The official CatRealm client for web and desktop.

This repository exists so the community can help fix bugs, improve reliability, and contribute features to the official CatRealm client instead of being blocked by a closed-source workflow.

## Why AGPL?

CatRealm Client is released under **AGPL-3.0-or-later** so improvements stay open. The goal is to welcome community contributions while discouraging companies from taking the client, improving it privately, and never contributing those changes back.

## What This Repo Contains

- React + TypeScript client UI
- Electron desktop wrapper and preload/main-process code
- Real-time client features for servers, DMs, calls, theater, and game activity
- Official CatRealm branding and default Central Server configuration

This repo is intended for contributing to the **official** CatRealm client. It is not a white-label or generic fork template.

## Official Defaults

The client defaults to the official CatRealm Central service:

- Central auth base: `https://auth.catrealm.app`
- Desktop update feed: `https://catrealm.app/downloads/win`

These defaults are intentional for the official client, but local development can override supported endpoints with environment variables.

## Local Development

### Prerequisites

- Node.js 24+
- npm

### Install

```bash
npm install
```

### Configure

Copy `.env.example` to `.env.local` or `.env` and adjust values if needed.

Supported client environment variables:

- `VITE_AUTH_SERVER_URL`
  Defaults to the official CatRealm Central service.
- `VITE_CLIENT_URL`
  Optional override for invite/share links when building outside the official deployment.
- `VITE_HCAPTCHA_SITEKEY`
  Optional override for the hosted hCaptcha key used by central registration flows.

### Run the Web Client

```bash
npm run dev
```

### Run the Desktop Client

```bash
npm run dev:electron
```

### Build

```bash
npm run build
```

Desktop packaging:

```bash
npm run build:electron
```

## Architecture Notes

High-level areas contributors usually touch:

- `src/lib/authApi.ts`
  Shared Central auth configuration and authenticated API helpers.
- `src/hooks/`
  Socket lifecycles, desktop game activity, version checks, and bridge hooks.
- `src/stores/`
  Zustand state for auth, DMs, servers, calls, theater, notes, and presence.
- `src/components/`
  UI and feature surfaces.
- `electron/`
  Desktop main/preload/game-activity implementation.

Useful feature clusters:

- Presence and activity: `src/stores/presenceStore.ts`, `src/hooks/useDesktopGameActivity.ts`
- Central DMs and friends: `src/hooks/useDMSocket.ts`, `src/stores/dmStore.ts`, `src/stores/friendStore.ts`
- Voice/calls/theater: `src/stores/callStore.ts`, `src/stores/theaterStore.ts`, `src/stores/voiceStore.ts`
- Personal notes: `src/stores/personalNotesStore.ts`, `src/components/notes/`

## Debug Tooling

The repo intentionally keeps internal debug tooling available for contributors.

Current localStorage flags include:

- `catrealm:debug-presence`
- `catrealm:debug-game-activity`
- `catrealm:debug-view-as`

There is also a UI hover inspector/debug overlay in the settings/dev surfaces for targeted UI debugging.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for workflow expectations, testing, and patch scope guidance.

