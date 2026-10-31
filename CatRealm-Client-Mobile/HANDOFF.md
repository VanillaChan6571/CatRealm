# CatRealm Mobile — Handoff

The old mock-only skeleton description is obsolete. Mobile has real authentication,
realm/channel data, sockets, E2EE DMs, profiles, notes, theater, voice, and push code.
It remains under development; passing TypeScript does not prove native behavior.

## Product source of truth

Use `../CatRealm-Client` for API behavior, assets, theme colors, and product
semantics. Adapt layout for touch without inventing divergent backend contracts.
The early `CatRealm-Mobile-Mockup.html` is not authoritative.

## Architecture

- `app/`: Expo Router screens. `(app)/_layout.tsx` owns sockets and persistent overlays.
- `src/stores/`: Zustand state and server operations.
- `src/lib/api.ts`: per-request auth clients; account-bound clients reject stale work.
- `src/lib/accountSession.ts`: generation-based invalidation across account changes.
- `src/lib/resetAllStores.ts`: clears account state and leaves active media sessions.
- `src/lib/storage.ts`: Keychain/Keystore-backed secret storage; never put tokens in AsyncStorage.
- `src/components/TheaterMiniPlayer.tsx`: persistent expanded/floating theater surface.
- `src/components/theater/TheaterMediaSurface.tsx`: independent native-video and YouTube players.
- `src/lib/audioSessionManager.ts`: serialized, shared native audio-session lifecycle.
- `modules/catrealm-notification-diagnostics`: local Expo module, packaged through CocoaPods.
- `modules/catrealm-native-calling`: unfinished scaffold, not a working native calling feature.

## Rules for changes

Use `@/` aliases, theme tokens, accessible touch targets, scoped store selectors,
and explicit account/session checks after asynchronous work. Keep state outside
screen components when it must survive navigation (for example, theater volume).

A library changing the iOS audio category can break another library's capture.
Do not call `setAudioModeAsync` from notification effects during live voice.
Notification players must use `keepAudioSessionActive`. The expo-video patch
keeps mixing video from overriding an existing recording session; LiveKit startup
and shutdown are serialized, and each room must release its ownership once.

Do not introduce an unguarded full-list sync fallback or treat connection failures
as intentional realm removal. The pending monorepo guarded-sync work must be
coordinated across Central and its clients before release.

## Validation and remaining work

Run the commands in README and add regression tests for changes. Root monorepo
CI validates mobile independently; the nested workflow is for the standalone repo.

Use [the device checklist](../docs/mobile-validation-1.8.7.md) before release.
Outstanding native work includes complete iOS CallKit/PushKit lifecycle handling,
Android native incoming calls, and device validation of audio routes/interruption
recovery. Do not enable the existing calling scaffold just by adding a podspec:
it still contains incomplete outgoing-call and cold-start paths.
