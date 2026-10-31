import AVFoundation
import CallKit
import ExpoModulesCore
import Foundation
import PushKit

public class CatRealmNativeCallingModule: Module, PKPushRegistryDelegate, CXProviderDelegate {
  private var pushRegistry: PKPushRegistry?
  private var provider: CXProvider?
  private var callIdByUUID: [UUID: String] = [:]
  private var uuidByCallId: [String: UUID] = [:]

  public func definition() -> ModuleDefinition {
    Name("NativeCallBridge")

    Events("nativeCallAction", "voipTokenUpdated")

    OnCreate {
      DispatchQueue.main.async {
        self.configureProvider()
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        self.pushRegistry = registry
      }
    }

    AsyncFunction("supportsNativeIncomingCalls") { () -> Bool in true }

    AsyncFunction("reportIncomingCall") { (call: [String: Any]) -> Bool in
      self.reportIncomingCall(call)
      return true
    }

    AsyncFunction("reportOutgoingCall") { (_call: [String: Any]) -> Bool in true }

    AsyncFunction("markCallConnected") { (callId: String) -> Bool in
      guard let uuid = self.uuidByCallId[callId] else { return false }
      self.provider?.reportOutgoingCall(with: uuid, connectedAt: Date())
      return true
    }

    AsyncFunction("endCall") { (callId: String, reason: String?) -> Bool in
      self.endCall(callId: callId, reason: reason)
      return true
    }

    AsyncFunction("dismissIncomingCall") { (callId: String) -> Bool in
      self.endCall(callId: callId, reason: "cancelled")
      return true
    }
  }

  private func configureProvider() {
    let config = CXProviderConfiguration(localizedName: "CatRealm")
    config.supportsVideo = true
    config.maximumCallsPerCallGroup = 1
    config.maximumCallGroups = 1
    config.supportedHandleTypes = [.generic]
    let provider = CXProvider(configuration: config)
    provider.setDelegate(self, queue: .main)
    self.provider = provider
  }

  private func reportIncomingCall(_ call: [String: Any]) {
    guard let callId = call["callId"] as? String,
          let callerName = call["callerName"] as? String else { return }
    let uuid = uuidByCallId[callId] ?? UUID()
    callIdByUUID[uuid] = callId
    uuidByCallId[callId] = uuid

    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: callerName)
    update.localizedCallerName = callerName
    update.hasVideo = (call["mediaType"] as? String) == "video"
    provider?.reportNewIncomingCall(with: uuid, update: update) { error in
      if error == nil {
        self.sendEvent("nativeCallAction", ["type": "displayed", "callId": callId, "occurredAt": Date().timeIntervalSince1970 * 1000])
      }
    }
  }

  private func endCall(callId: String, reason: String?) {
    guard let uuid = uuidByCallId[callId] else { return }
    let endedReason: CXCallEndedReason
    switch reason {
    case "failed": endedReason = .failed
    case "declined": endedReason = .declinedElsewhere
    case "answered_elsewhere": endedReason = .answeredElsewhere
    default: endedReason = .remoteEnded
    }
    provider?.reportCall(with: uuid, endedAt: Date(), reason: endedReason)
    callIdByUUID.removeValue(forKey: uuid)
    uuidByCallId.removeValue(forKey: callId)
  }

  public func providerDidReset(_ provider: CXProvider) {
    callIdByUUID.removeAll()
    uuidByCallId.removeAll()
  }

  public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard let callId = callIdByUUID[action.callUUID] else {
      action.fail()
      return
    }
    sendEvent("nativeCallAction", ["type": "answer", "callId": callId, "occurredAt": Date().timeIntervalSince1970 * 1000])
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    guard let callId = callIdByUUID[action.callUUID] else {
      action.fail()
      return
    }
    sendEvent("nativeCallAction", ["type": "decline", "callId": callId, "occurredAt": Date().timeIntervalSince1970 * 1000])
    callIdByUUID.removeValue(forKey: action.callUUID)
    uuidByCallId.removeValue(forKey: callId)
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {}
  public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}

  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    sendEvent("voipTokenUpdated", ["token": token])
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    guard type == .voIP else { return }
    sendEvent("voipTokenUpdated", ["token": NSNull()])
  }

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else {
      completion()
      return
    }
    reportIncomingCall(payload.dictionaryPayload)
    completion()
  }
}
