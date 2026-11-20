import Foundation

// Reason: EventKit and Contacts permission requests wait for the user without
// any time limit. An unseen dialog (often parked in Notification Center, or
// re-asked after an ad-hoc re-sign) made every calendar/reminder/contact call
// and the doctor hang until the caller's timeout, with no hint why.

enum PermissionGate {
    static let timeout: TimeInterval = 8

    /// Thread-safe "first caller wins" flag for the two completion paths.
    private final class Once: @unchecked Sendable {
        private let lock = NSLock()
        private var done = false
        func claim() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            if done { return false }
            done = true
            return true
        }
    }

    /// Run a permission request. Returns the answer, or nil when the user has
    /// not answered within `timeout`. The request itself cannot be cancelled.
    static func request(_ start: @escaping (@escaping @Sendable (Bool) -> Void) -> Void) async -> Bool? {
        await withCheckedContinuation { (cont: CheckedContinuation<Bool?, Never>) in
            let once = Once()
            start { granted in
                if once.claim() { cont.resume(returning: granted) }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                if once.claim() { cont.resume(returning: nil) }
            }
        }
    }

    /// For tool commands: report a pending dialog and exit, because the
    /// abandoned request would otherwise keep the process alive.
    static func requireAnswer(service: String, _ answer: Bool?) -> Bool {
        guard let granted = answer else {
            JSONOutput.error(pendingMessage(service: service))
            exit(0)
        }
        return granted
    }

    static func pendingMessage(service: String) -> String {
        "\(service) permission dialog is waiting for an answer (check the screen and Notification Center). Allow access for apple-bridge, then retry. If no dialog appears, reset with: tccutil reset \(tccService(service)) io.l22.apple-bridge"
    }

    private static func tccService(_ service: String) -> String {
        switch service {
        case "Calendar": return "Calendar"
        case "Reminders": return "Reminders"
        case "Contacts": return "AddressBook"
        default: return "All"
        }
    }
}
