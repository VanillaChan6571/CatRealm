const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test, expect } = require('@jest/globals');

const read = (file) => readFileSync(resolve(__dirname, '../../..', file), 'utf8');

// npm accepts some combinations across this native framework rename even though
// Xcode cannot compile them. Keep the reviewed pair pinned until revalidated.
test('LiveKit SDK and WebRTC bridge use the reviewed native dependency pair', () => {
  const manifest = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  for (const [name, version] of Object.entries({
    '@livekit/react-native': '3.0.0',
    '@livekit/react-native-webrtc': '144.2.0',
  })) {
    expect(manifest.dependencies[name]).toBe(version);
    expect(lock.packages[`node_modules/${name}`].version).toBe(version);
    expect(JSON.parse(read(`node_modules/${name}/package.json`)).version).toBe(version);
  }
});

test('the SDK and bridge both import the native framework provided by the pod', () => {
  const sdkHeader = read('node_modules/@livekit/react-native/ios/Headers/LKAudioProcessingAdapter.h');
  const bridgeHeader = read('node_modules/@livekit/react-native-webrtc/ios/RCTWebRTC/WebRTCModule.h');
  const podspec = read('node_modules/@livekit/react-native-webrtc/livekit-react-native-webrtc.podspec');
  for (const header of [sdkHeader, bridgeHeader]) {
    expect(header).toContain('<LiveKitWebRTC/LiveKitWebRTC.h>');
    expect(header).not.toContain('<WebRTC/');
  }
  expect(podspec).toMatch(/s\.dependency\s+['"]LiveKitWebRTC['"]/);
});
