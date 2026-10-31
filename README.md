# CatRealm

CatRealm is a free, open alternative to Discord: servers ("realms"), DMs with end-to-end encryption, voice and video calls, screen sharing, a theater for watching together, and bots. Anyone can run their own realm, and features aren't locked behind a paywall.

This repo is the public home for CatRealm:

- **Bug reports and feature requests** for every CatRealm app go in [Issues](../../issues).
- **The client source code** (desktop, mobile and the Rust desktop shell) is published here on every stable release, so anyone can read it, build it, and send fixes.

Download the apps at **[catrealm.app](https://catrealm.app)**.

## What's in this repo

| Folder | App | What it is |
| --- | --- | --- |
| [`CatRealm-Client/`](CatRealm-Client) | **Sparky** (desktop) and **Neko no Su** (web) | React + TypeScript app. Runs in the browser and inside Electron on Windows and Linux. |
| [`CatRealm-Client-Mobile/`](CatRealm-Client-Mobile) | **Denshi** (iOS and Android) | Expo / React Native app. |
| [`CatRealm-Client-Tauri2-Rust/`](CatRealm-Client-Tauri2-Rust) | **Sushi** (desktop) | Tauri 2 / Rust shell that loads the same React app from `CatRealm-Client/`. |

The self-hosted realm server is in its own repo: **[CatRealm-SelfHostable-Server](https://github.com/VanillaChan6571/CatRealm-SelfHostable-Server)**.

### How the code gets here

CatRealm is developed in a private workspace. Each stable release (for example `v1.9.2`) copies the current client source into this repo as one `Release vX.Y.Z` commit with a matching tag. Between releases these folders don't change, so `main` always matches the latest stable build. Older releases are available under [Tags](../../tags).

## Reporting a bug

1. Search [existing issues](../../issues) first. If someone already reported it, add your details there instead of opening a new one.
2. Open a [Bug Report](../../issues/new/choose) and include:
   - what you did, what you expected, and what happened instead
   - your app and version (shown in Settings), and your platform (Windows, Linux, web browser, Android or iOS)
   - screenshots, recordings or logs if you have them
3. Have an idea instead of a bug? Use the **Feature Request** template.

**Security issues:** please don't post them publicly. Email **support@catrealm.app** with the details and we'll follow up privately.

## Sending a fix (pull requests)

Bug fixes are very welcome. Small, focused pull requests are the easiest to review and merge.

1. **Fork** this repo and create a branch from `main`.
2. **Make your change** in the relevant client folder. Keep it to one fix or feature, and follow the code style around it.
3. **Test it** with the commands below and describe how you checked it.
4. **Open a pull request** that says what changed, why, and how you tested it. Add screenshots or a short recording for UI changes, and link the issue it fixes (`Fixes #123`).

For new features or bigger behavior changes, open an issue first so we can agree on the approach before you spend time on it.

**What happens next:** because these folders are replaced on every release, PRs aren't merged directly. Instead, an accepted change is applied to the main CatRealm codebase, credited to you, and ships in the next stable release. Once it lands here in a `Release` commit, your PR is closed with a link to that release.

### Building and testing each client

**Desktop and web** (`CatRealm-Client/`, Node.js 24+):

```bash
cd CatRealm-Client
npm install
npm run dev            # web client at http://localhost:5173
npm run dev:electron   # desktop (Electron) client
npm test               # unit tests
npm run build          # typecheck and production build
```

**Mobile** (`CatRealm-Client-Mobile/`, Node version in `.nvmrc`):

```bash
cd CatRealm-Client-Mobile
npm ci
npm run typecheck
npm run lint
npm run test:ci -- --runInBand
npm run android        # or: npm run ios
```

Mobile needs a development build. Expo Go doesn't include the native WebRTC modules.

**Sushi (Tauri)** (`CatRealm-Client-Tauri2-Rust/`, Node.js and a Rust toolchain):

```bash
cd CatRealm-Client && npm install && npm run dev   # terminal 1
cd CatRealm-Client-Tauri2-Rust && npm install && npm run dev   # terminal 2
```

Each folder's own README has more detail, including Linux prerequisites for Sushi. By default the clients connect to the official CatRealm service at `https://auth.catrealm.app`; see each folder's `.env.example` for local overrides.

## License

The CatRealm clients are licensed under **AGPL-3.0**; see [LICENSE](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
