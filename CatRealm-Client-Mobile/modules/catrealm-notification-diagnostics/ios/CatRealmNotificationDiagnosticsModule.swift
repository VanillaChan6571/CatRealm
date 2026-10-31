import ExpoModulesCore
import Foundation
import Darwin

public class CatRealmNotificationDiagnosticsModule: Module {
  private let suiteName = "group.com.nwya.catrealm.mobile"
  private let diagnosticKey = "catrealm.notification-preview-diagnostic"

  public func definition() -> ModuleDefinition {
    Name("CatRealmNotificationDiagnostics")

    // Read this process only; no device identifiers, user content, or history.
    AsyncFunction("getMemoryUsage") { () -> [String: Double]? in
      #if DEBUG
      var info = task_vm_info_data_t()
      let capacity = MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size
      var count = mach_msg_type_number_t(capacity)
      let result = withUnsafeMutablePointer(to: &info) { pointer in
        pointer.withMemoryRebound(to: integer_t.self, capacity: capacity) { buffer in
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), buffer, &count)
        }
      }
      guard result == KERN_SUCCESS else { return nil }
      return [
        "footprintBytes": Double(info.phys_footprint),
        "residentBytes": Double(info.resident_size)
      ]
      #else
      return nil
      #endif
    }

    AsyncFunction("getLatest") { () -> [String: Any]? in
      UserDefaults(suiteName: suiteName)?.dictionary(forKey: diagnosticKey)
    }

    AsyncFunction("clearLatest") { () -> Bool in
      guard let defaults = UserDefaults(suiteName: suiteName) else { return false }
      defaults.removeObject(forKey: diagnosticKey)
      return defaults.synchronize()
    }
  }
}
