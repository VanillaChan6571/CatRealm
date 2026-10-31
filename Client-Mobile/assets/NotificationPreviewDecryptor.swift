import CryptoKit
import Foundation
import Security

@objc(NotificationPreviewDecryptor)
final class NotificationPreviewDecryptor: NSObject {
  private static let accessGroup = "group.com.nwya.catrealm.mobile"
  private static let privateKeyAccount = "catrealm.device-notification-private-key"
  private static let deviceIdAccount = "catrealm.device-id"
  // expo-secure-store namespaces non-authenticated values under "app:no-auth"
  // and retains "app" as its legacy service name. Read both so the NSE can
  // consume values written by current and older app versions.
  private static let secureStoreServices = ["app:no-auth", "app"]

  @objc static func decryptEnvelope(_ envelope: String) -> NSDictionary? {
    guard
      let envelopeData = envelope.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: envelopeData) as? [String: Any],
      (object["v"] as? Int) == 1,
      let epkB64 = object["epk"] as? String,
      let ivB64 = object["iv"] as? String,
      let ciphertextB64 = object["ciphertext"] as? String,
      let epkData = Data(base64Encoded: epkB64),
      let iv = Data(base64Encoded: ivB64),
      let ciphertextAndTag = Data(base64Encoded: ciphertextB64),
      let privateKeyStoredData = readKeychainValue(account: privateKeyAccount),
      let privateKeyStoredValue = String(data: privateKeyStoredData, encoding: .utf8),
      let privateKeyData = Data(base64Encoded: privateKeyStoredValue),
      let deviceIdData = readKeychainValue(account: deviceIdAccount),
      let deviceId = String(data: deviceIdData, encoding: .utf8)
    else { return nil }

    do {
      let privateKey = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privateKeyData)
      let publicKey = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: epkData)
      let sharedSecret = try privateKey.sharedSecretFromKeyAgreement(with: publicKey)
      let key = derivePreviewKey(sharedSecret: sharedSecret, deviceId: deviceId)

      guard ciphertextAndTag.count >= 16 else { return nil }
      let ciphertext = ciphertextAndTag.dropLast(16)
      let tag = ciphertextAndTag.suffix(16)
      let sealedBox = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: ciphertext, tag: tag)
      let plaintext = try AES.GCM.open(sealedBox, using: key)
      let payload = try JSONSerialization.jsonObject(with: plaintext)
      return payload as? NSDictionary
    } catch {
      return nil
    }
  }

  private static func derivePreviewKey(sharedSecret: SharedSecret, deviceId: String) -> SymmetricKey {
    let salt = Data(deviceId.utf8)
    let info = Data("catrealm:notification-preview:v1".utf8)
    return sharedSecret.hkdfDerivedSymmetricKey(
      using: SHA256.self,
      salt: salt,
      sharedInfo: info,
      outputByteCount: 32
    )
  }

  private static func readKeychainValue(account: String) -> Data? {
    let encodedKey = Data(account.utf8)
    for service in secureStoreServices {
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrGeneric as String: encodedKey,
        kSecAttrAccount as String: encodedKey,
        kSecAttrAccessGroup as String: accessGroup,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
      ]
      var result: CFTypeRef?
      if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess {
        return result as? Data
      }
    }
    return nil
  }
}
