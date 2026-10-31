# CatRealm Mobile

Native iOS/Android client built with Expo SDK 58, React Native 0.88 RC, React 19.3,
Expo Router, Zustand, and LiveKit. This is an active implementation, not a mock-only skeleton.

## Development

Use the Node version in `.nvmrc`, run `npm ci`, and copy `.env.example` to
`.env.local` if you need a non-default Central URL. Only public configuration
belongs in `EXPO_PUBLIC_*` variables.

SDK 58 currently comes from npm's `next` channel and pins React Native
`0.88.0-rc.4`. The project `.npmrc` temporarily uses `legacy-peer-deps` because
several libraries' stable React Native peer ranges reject release candidates.
Remove that workaround once Expo selects stable React Native and peer resolution
succeeds. Expo core also still declares a Worklets peer range ending at 0.10,
while SDK 58 selects Worklets 0.13; we use the SDK's recommended version.
`tsconfig.json` temporarily selects React Native's supported legacy types
because dependencies including MaskedView still use removed types such as
`NativeMethods`. Migrate to the strict API before the next React Native upgrade.

Jest 30 and `@react-native/jest-preset` are required by the SDK 58 test preset.
Expo's version check still recommends Jest 29, so `expo.install.exclude` lists
only `jest` and `@types/jest` while we follow `jest-expo`'s declared Jest 30 peer.
Review these exceptions when the SDK 58 tooling is updated.
`metro-runtime` is an explicit development dependency so the Worklets bundle-mode
patch applies to a single shared installation during local and CI builds.

Use `npm run ios` or `npm run android` to create a development build.
Expo Go does not include the native WebRTC modules.
After dependency/config/plugin updates, rebuild the native app; a Metro reload is insufficient.

For an installable iPhone debug client, use `eas build --platform ios --profile development`.
This profile enables the development client and iOS Debug configuration; `preview`
is a self-contained Release build and does not use Metro.

For the deployed Metro proxy, enter `https://catrealm.app/devmobile/` in the
development client's server URL field. Start Metro with the process environment
`EXPO_PACKAGER_PROXY_URL=https://catrealm.app` (not an `EXPO_PUBLIC_*` variable)
so its manifest advertises HTTPS bundle URLs on port 443 instead of port 8081.
The reverse proxy must also forward Metro's root bundle, asset, and WebSocket
routes; the proxy URL setting does not preserve a URL path prefix.
In particular, lazy imports request `/src/...bundle` and `/app/...bundle`;
forward those bundle/map requests to Metro without changing ordinary `/app`
website routing. A successful HTTP status is not enough: verify the bundle's
content type is JavaScript, not the landing page's HTML, and disable caching for
development bundles.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm run test:ci -- --runInBand`
- `npx expo install --check`
- `npx expo-doctor`
- `npx expo export --platform android --platform ios`

Production JavaScript exports and prebuild generation do not replace compiling
the native projects or testing on devices. See
[the mobile validation checklist](../docs/mobile-validation-1.8.7.md).

## Theater

The app shell owns a persistent player; theater navigation only changes its
expanded/floating frame. Volume and mute live in the theater store.
Queue, Chat, and Watching share an inline tab panel. Fullscreen Open chat selects
the Chat tab without navigating away or remounting the video. History is fetched
on chat entry even when live messages have already populated the cache.
Direct videos use expo-video and support native PiP/background playback.
YouTube uses its embedded player and supports the in-app floating view only;
native PiP/background playback is not promised for embeds.

LiveKit owns the audio session while voice is connected. Notification players
must not deactivate it, and mixing video must not replace its recording category.
The versioned expo-video patch preserves this rule on iOS. Review all patches
when upgrading their target dependencies.

## iOS refresh rate

The app explicitly enables ProMotion. The versioned React Native patch requests
a 60–120 Hz range, preferring 120 Hz, for JavaScript frame callbacks, native
Animated, and Fabric layout animations. Their existing idle/background lifecycle
is preserved; no always-running display link is added. iOS still chooses the
actual rate based on the display, power settings, and thermal conditions.

`ios.buildReactNativeFromSource` is required so native builds include the patch
instead of the precompiled React Native core. This increases iOS build time.
Refresh-rate changes require a new native build, not an OTA JavaScript update.
Review the patch when upgrading React Native.

Validate a release build on a ProMotion iPhone with Low Power Mode and Limit Frame
Rate disabled: scroll chat and lists, open/close sheets, switch tabs, return from
video playback, and background/foreground the app. Check frame cadence using
Instruments and repeat on a 60 Hz device. Static screens may reduce their refresh
rate normally. These changes address animation-clock preferences; device testing
is still needed to confirm the reported intermittent slowdown is resolved.

## Scope

Chat, E2EE DMs, message requests, blocking, realm sync, theater, voice and push
notifications have implementations. Native incoming-call UI is still unfinished:
the CallKit/PushKit module is a scaffold and Android incoming-call integration
is not implemented. Do not advertise killed-app/lock-screen call answering yet.

See [HANDOFF.md](./HANDOFF.md) for architecture and development conventions.

## License

AGPL-3.0-or-later, consistent with `package.json`.
