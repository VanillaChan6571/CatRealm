// CatRealmCaptureHelper: small macOS companion for the native screen-share publisher.
//
//   --list-screens
//       Print the NSScreen order and pixel sizes as JSON. avfvideosrc's device-index is
//       an index into [NSScreen screens], so this is the source of truth for mapping a
//       display id to the index we pass to it. A wrong mapping would share the wrong screen.
//
//   --request-screen-access
//       Ask macOS for Screen Recording access. This shows the system prompt and lists
//       CatRealm in System Settings; the system attributes it to the parent app. Electron
//       has no API for this, and desktopCapturer just fails until access is granted.
//
//   --audio --exclude-tree <pid>
//       Capture system audio with a Core Audio process tap and write interleaved
//       float32 little-endian stereo PCM at 48 kHz to stdout until stdout closes or the
//       parent exits. Every process descended from <pid> is excluded and the list is
//       refreshed while running, so CatRealm's own voice chat isn't sent into the share.
//       Silence is written while nothing is playing, because a tap delivers no buffers
//       then and the publisher needs a continuous stream.
//       Chromium plays audio from a utility process, which ScreenCaptureKit's per-app
//       filter can't exclude; that's why this is a tap and not ScreenCaptureKit audio.
import AVFoundation
import AppKit
import CoreAudio
import Darwin
import Foundation

func log(_ message: String) { fputs("[capture-helper] \(message)\n", stderr) }

func globalAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

func listScreens() -> Never {
  let screens = NSScreen.screens.enumerated().compactMap { index, screen -> [String: Any]? in
    guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
    let scale = screen.backingScaleFactor
    return ["index": index, "displayId": number.uint32Value, "width": Int(screen.frame.width * scale), "height": Int(screen.frame.height * scale)]
  }
  let data = (try? JSONSerialization.data(withJSONObject: screens)) ?? Data("[]".utf8)
  FileHandle.standardOutput.write(data)
  exit(0)
}

func descendants(of root: pid_t) -> [pid_t] {
  var found: [pid_t] = [root]
  var index = 0
  while index < found.count {
    var children = [pid_t](repeating: 0, count: 512)
    let bytes = children.withUnsafeMutableBytes { proc_listchildpids(found[index], $0.baseAddress, Int32($0.count)) }
    if bytes > 0 { found.append(contentsOf: children.prefix(Int(bytes))) }
    index += 1
  }
  return found
}

func audioObjects(for pids: [pid_t]) -> [AudioObjectID] {
  pids.compactMap { pid -> AudioObjectID? in
    var address = globalAddress(kAudioHardwarePropertyTranslatePIDToProcessObject)
    var value = pid
    var object = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, UInt32(MemoryLayout<pid_t>.size), &value, &size, &object)
    return status == noErr && object != kAudioObjectUnknown ? object : nil
  }
}

func writeAll(_ pointer: UnsafeRawPointer, _ count: Int) {
  var offset = 0
  while offset < count {
    let written = write(STDOUT_FILENO, pointer + offset, count - offset)
    if written < 0 {
      if errno == EINTR { continue }
      exit(0) // The publisher closed its end of the pipe.
    }
    offset += written
  }
}

@available(macOS 14.2, *)
final class TapCapture {
  private let root: pid_t
  private let queue = DispatchQueue(label: "app.catrealm.capture-helper.audio", qos: .userInteractive)
  private let outputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 2, interleaved: true)!
  private var description: CATapDescription?
  private var tap = AudioObjectID(kAudioObjectUnknown)
  private var aggregate = AudioObjectID(kAudioObjectUnknown)
  private var ioProc: AudioDeviceIOProcID?
  private var converter: AVAudioConverter?
  private var inputFormat: AVAudioFormat?
  private var excluded: Set<AudioObjectID> = []
  private var lastWrite = DispatchTime.now()

  init(root: pid_t) { self.root = root }

  func run() -> Never {
    queue.async { self.start() }
    let poll = DispatchSource.makeTimerSource(queue: queue)
    poll.schedule(deadline: .now() + 2, repeating: 2)
    poll.setEventHandler { [weak self] in
      if getppid() == 1 { exit(0) } // CatRealm went away without stopping us.
      self?.refreshExclusions()
    }
    poll.resume()
    let silence = DispatchSource.makeTimerSource(queue: queue)
    silence.schedule(deadline: .now() + .milliseconds(10), repeating: .milliseconds(10))
    silence.setEventHandler { [weak self] in self?.writeSilenceIfIdle() }
    silence.resume()
    var address = globalAddress(kAudioHardwarePropertyDefaultOutputDevice)
    AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, queue) { [weak self] _, _ in
      log("default output changed; restarting tap")
      self?.stop()
      self?.start()
    }
    withExtendedLifetime((poll, silence)) { dispatchMain() }
  }

  private func start() {
    let objects = audioObjects(for: descendants(of: root))
    let tapDescription = CATapDescription(stereoGlobalTapButExcludeProcesses: objects)
    tapDescription.uuid = UUID()
    tapDescription.name = "CatRealm screen share"
    tapDescription.isPrivate = true
    tapDescription.muteBehavior = .unmuted
    excluded = Set(objects)
    description = tapDescription

    var newTap = AudioObjectID(kAudioObjectUnknown)
    var status = AudioHardwareCreateProcessTap(tapDescription, &newTap)
    guard status == noErr else { return giveUp("tap creation failed: \(status)") }
    tap = newTap

    let dictionary: [String: Any] = [
      kAudioAggregateDeviceNameKey: "CatRealm screen share",
      kAudioAggregateDeviceUIDKey: UUID().uuidString,
      kAudioAggregateDeviceIsPrivateKey: true,
      kAudioAggregateDeviceIsStackedKey: false,
      kAudioAggregateDeviceTapAutoStartKey: true,
      kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: tapDescription.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]],
    ]
    var newAggregate = AudioObjectID(kAudioObjectUnknown)
    status = AudioHardwareCreateAggregateDevice(dictionary as CFDictionary, &newAggregate)
    guard status == noErr else { return giveUp("aggregate creation failed: \(status)") }
    aggregate = newAggregate

    var address = globalAddress(kAudioTapPropertyFormat)
    var basic = AudioStreamBasicDescription()
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    status = AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &basic)
    guard status == noErr, let format = AVAudioFormat(streamDescription: &basic) else { return giveUp("tap format failed: \(status)") }
    inputFormat = format
    converter = format == outputFormat ? nil : AVAudioConverter(from: format, to: outputFormat)
    log("tap format \(basic.mSampleRate) Hz, \(basic.mChannelsPerFrame) channels, excluding \(objects.count) process objects")

    status = AudioDeviceCreateIOProcIDWithBlock(&ioProc, aggregate, queue) { [weak self] _, input, _, _, _ in
      self?.handle(input)
    }
    guard status == noErr else { return giveUp("ioproc failed: \(status)") }
    status = AudioDeviceStart(aggregate, ioProc)
    guard status == noErr else { return giveUp("device start failed: \(status)") }
    log("audio capture started")
  }

  // End of stream on stdin would end the whole share, video included. If capture can't
  // start, keep writing silence so that only the audio is lost.
  private func giveUp(_ message: String) {
    log("\(message); sending silence")
    stop()
  }

  private func stop() {
    if let ioProc, aggregate != kAudioObjectUnknown {
      AudioDeviceStop(aggregate, ioProc)
      AudioDeviceDestroyIOProcID(aggregate, ioProc)
    }
    ioProc = nil
    if aggregate != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggregate) }
    if tap != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tap) }
    aggregate = kAudioObjectUnknown
    tap = kAudioObjectUnknown
  }

  // Chromium's audio service can start after we do, or restart, so keep the list current.
  private func refreshExclusions() {
    guard tap != kAudioObjectUnknown, let description else { return }
    let objects = audioObjects(for: descendants(of: root))
    guard Set(objects) != excluded else { return }
    description.processes = objects
    var address = globalAddress(kAudioTapPropertyDescription)
    var value: Unmanaged<CATapDescription> = Unmanaged.passUnretained(description)
    let status = AudioObjectSetPropertyData(tap, &address, 0, nil, UInt32(MemoryLayout<Unmanaged<CATapDescription>>.size), &value)
    if status == noErr {
      excluded = Set(objects)
      log("now excluding \(objects.count) process objects")
    } else {
      log("failed to update exclusions: \(status)")
    }
  }

  private func writeSilenceIfIdle() {
    let now = DispatchTime.now()
    let idle = Double(now.uptimeNanoseconds - lastWrite.uptimeNanoseconds) / 1_000_000_000
    guard idle > 0.04 else { return }
    let zeros = [Float32](repeating: 0, count: Int(idle * outputFormat.sampleRate) * 2)
    zeros.withUnsafeBytes { writeAll($0.baseAddress!, $0.count) }
    lastWrite = now
  }

  private func handle(_ input: UnsafePointer<AudioBufferList>) {
    lastWrite = DispatchTime.now()
    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
    guard let inputFormat, !buffers.isEmpty else { return }
    guard let converter else {
      // Already 48 kHz stereo float32.
      if inputFormat.isInterleaved, let data = buffers[0].mData {
        writeAll(data, Int(buffers[0].mDataByteSize))
      } else if buffers.count >= 2, let left = buffers[0].mData?.assumingMemoryBound(to: Float32.self), let right = buffers[1].mData?.assumingMemoryBound(to: Float32.self) {
        let frames = Int(buffers[0].mDataByteSize) / MemoryLayout<Float32>.size
        var interleaved = [Float32](repeating: 0, count: frames * 2)
        for frame in 0..<frames {
          interleaved[frame * 2] = left[frame]
          interleaved[frame * 2 + 1] = right[frame]
        }
        interleaved.withUnsafeBytes { writeAll($0.baseAddress!, $0.count) }
      }
      return
    }
    let bytesPerFrame = inputFormat.streamDescription.pointee.mBytesPerFrame
    guard bytesPerFrame > 0 else { return }
    let frames = buffers[0].mDataByteSize / bytesPerFrame
    guard frames > 0, let source = AVAudioPCMBuffer(pcmFormat: inputFormat, bufferListNoCopy: input, deallocator: nil) else { return }
    source.frameLength = frames
    let capacity = AVAudioFrameCount(ceil(Double(frames) * outputFormat.sampleRate / inputFormat.sampleRate)) + 32
    guard let converted = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }
    var consumed = false
    var error: NSError?
    converter.convert(to: converted, error: &error) { _, inputStatus in
      if consumed {
        inputStatus.pointee = .noDataNow
        return nil
      }
      consumed = true
      inputStatus.pointee = .haveData
      return source
    }
    if let error { log("conversion failed: \(error)"); return }
    if converted.frameLength > 0, let data = converted.audioBufferList.pointee.mBuffers.mData {
      writeAll(data, Int(converted.frameLength) * 8)
    }
  }
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments.contains("--list-screens") { listScreens() }
if arguments.contains("--request-screen-access") {
  log("screen access \(CGRequestScreenCaptureAccess() ? "granted" : "not granted")")
  exit(0)
}
if arguments.contains("--audio") {
  guard #available(macOS 14.2, *) else { log("system audio capture needs macOS 14.2"); exit(2) }
  var root = getppid()
  if let index = arguments.firstIndex(of: "--exclude-tree"), index + 1 < arguments.count, let pid = pid_t(arguments[index + 1]) {
    root = pid
  }
  TapCapture(root: root).run()
}
log("usage: CatRealmCaptureHelper --list-screens | --request-screen-access | --audio [--exclude-tree <pid>]")
exit(64)
