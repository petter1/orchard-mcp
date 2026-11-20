import Contacts
import EventKit
import Foundation

// Reason: The doctor subcommand provides a single entry point to verify
// all permissions are granted and list accessible resources. Useful for
// first-run setup and debugging.

enum DoctorBridge {
    static func run() async {
        var report: [String: Any] = [
            "version": "0.6.5",
            "platform": "macOS",
            "systemVersion": ProcessInfo.processInfo.operatingSystemVersionString
        ]

        // Calendar permissions
        // Reason: requests go through PermissionGate so an unanswered dialog
        // is reported as "pending" instead of hanging the doctor.
        var calStatus = EKEventStore.authorizationStatus(for: .event)
        if calStatus == .notDetermined {
            report["calendar"] = permissionReport(service: "Calendar", answer: await CalendarBridge.requestAccessAnswer(), grantedName: "fullAccess")
            calStatus = EKEventStore.authorizationStatus(for: .event)
        } else {
            report["calendar"] = ["status": authStatusName(calStatus), "granted": calStatus == .fullAccess]
        }
        if calStatus == .fullAccess {
            let calendars = EKEventStore().calendars(for: .event)
            let accounts = Set(calendars.compactMap { $0.source?.title })
            report["calendarSummary"] = [
                "count": calendars.count,
                "accounts": Array(accounts).sorted()
            ]
        }

        // Reminders permissions
        var remStatus = EKEventStore.authorizationStatus(for: .reminder)
        if remStatus == .notDetermined {
            report["reminders"] = permissionReport(service: "Reminders", answer: await RemindersBridge.requestAccessAnswer(), grantedName: "fullAccess")
            remStatus = EKEventStore.authorizationStatus(for: .reminder)
        } else {
            report["reminders"] = ["status": authStatusName(remStatus), "granted": remStatus == .fullAccess]
        }
        if remStatus == .fullAccess {
            let lists = EKEventStore().calendars(for: .reminder)
            report["remindersSummary"] = [
                "count": lists.count,
                "lists": lists.map { $0.title }.sorted()
            ]
        }

        // Mail -- we can only check if osascript is available
        // Reason: Mail access is via AppleScript, no programmatic permission check exists.
        let mailCheck = checkMailAccess()
        report["mail"] = mailCheck

        // iWork apps
        let numbersCheck = checkIWorkApp("Numbers")
        let pagesCheck = checkIWorkApp("Pages")
        let keynoteCheck = checkIWorkApp("Keynote")
        report["numbers"] = numbersCheck
        report["pages"] = pagesCheck
        report["keynote"] = keynoteCheck

        // Notes -- AppleScript-based, same shape as Mail
        report["notes"] = checkNotesAccess()

        // Contacts -- native CNContactStore
        var contactsStatus = CNContactStore.authorizationStatus(for: .contacts)
        if contactsStatus == .notDetermined {
            report["contacts"] = permissionReport(service: "Contacts", answer: await ContactsBridge.requestAccessAnswer(), grantedName: "authorized")
            contactsStatus = CNContactStore.authorizationStatus(for: .contacts)
        } else {
            report["contacts"] = ["status": contactsAuthName(contactsStatus), "granted": contactsStatus == .authorized]
        }

        // Guidance
        var actions: [String] = []
        if calStatus != .fullAccess {
            actions.append("Calendar: Grant access in System Settings > Privacy & Security > Calendars")
        }
        if remStatus != .fullAccess {
            actions.append("Reminders: Grant access in System Settings > Privacy & Security > Reminders")
        }
        if !(mailCheck["accessible"] as? Bool ?? false) {
            actions.append("Mail: Run apple-bridge with a mail subcommand to trigger the Automation permission dialog")
        }
        if !(numbersCheck["installed"] as? Bool ?? false) {
            actions.append("Numbers: Install from App Store for spreadsheet tools")
        }
        if !(pagesCheck["installed"] as? Bool ?? false) {
            actions.append("Pages: Install from App Store for document tools")
        }
        if !(keynoteCheck["installed"] as? Bool ?? false) {
            actions.append("Keynote: Install from App Store for presentation tools")
        }
        let notesAccessible = (report["notes"] as? [String: Any])?["accessible"] as? Bool ?? false
        if !notesAccessible {
            actions.append("Notes: Run apple-bridge with a notes subcommand to trigger the Automation permission dialog")
        }
        if contactsStatus != .authorized {
            actions.append("Contacts: Grant access in System Settings > Privacy & Security > Contacts")
        }
        if !actions.isEmpty {
            report["requiredActions"] = actions
        }

        JSONOutput.success(report)
    }

    private static func permissionReport(service: String, answer: Bool?, grantedName: String) -> [String: Any] {
        guard let granted = answer else {
            return ["status": "pending", "granted": false, "note": PermissionGate.pendingMessage(service: service)]
        }
        return [
            "status": granted ? grantedName : "denied",
            "granted": granted,
            "note": "Permission was just requested."
        ]
    }

    private static func authStatusName(_ status: EKAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .fullAccess: return "fullAccess"
        case .writeOnly: return "writeOnly"
        @unknown default: return "unknown"
        }
    }

    private static func checkIWorkApp(_ appName: String) -> [String: Any] {
        let script = "tell application \"\(appName)\" to return name"
        guard let result = OsascriptRunner.runRaw(script: script, timeout: doctorAppleScriptTimeout) else {
            return ["installed": false, "accessible": false, "note": "Could not spawn osascript to check \(appName)."]
        }
        if result.timedOut {
            return ["installed": true, "accessible": false, "note": "\(appName) did not respond within \(Int(doctorAppleScriptTimeout))s."]
        }
        if result.status == 0 {
            return ["installed": true, "accessible": true]
        }
        if result.stderr.contains("-600") || result.stderr.contains("not running") {
            return ["installed": true, "accessible": false, "note": "\(appName) is not running."]
        }
        return ["installed": false, "accessible": false, "note": "\(appName) may not be installed."]
    }

    private static func contactsAuthName(_ status: CNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .limited: return "limited"
        @unknown default: return "unknown"
        }
    }

    private static func checkNotesAccess() -> [String: Any] {
        return checkAppAccess(appName: "Notes")
    }

    private static func checkMailAccess() -> [String: Any] {
        // Reason: Try a minimal AppleScript to see if Mail.app is accessible.
        // This doesn't send the permission prompt -- it just checks if we can talk to Mail.
        return checkAppAccess(appName: "Mail")
    }

    private static func checkAppAccess(appName: String) -> [String: Any] {
        let script = "tell application \"\(appName)\" to count of accounts"
        guard let result = OsascriptRunner.runRaw(script: script, timeout: doctorAppleScriptTimeout) else {
            return [
                "accessible": false,
                "note": "Failed to spawn osascript to probe \(appName)."
            ]
        }
        if result.timedOut {
            return [
                "accessible": false,
                "note": "\(appName).app did not respond within \(Int(doctorAppleScriptTimeout))s. It may be busy or unresponsive; system_doctor refuses to wait longer to avoid orphaning osascript."
            ]
        }
        if result.status == 0 {
            return [
                "accessible": true,
                "accountCount": Int(result.stdout) ?? 0
            ]
        }
        return [
            "accessible": false,
            "note": "\(appName) automation permission not yet granted or \(appName).app not running."
        ]
    }

    /// Hard timeout for any AppleScript invocation issued by the doctor. The
    /// doctor's job is to report state quickly; if Mail.app or Notes.app
    /// cannot answer "count of accounts" in this window they are by definition
    /// not accessible.
    private static let doctorAppleScriptTimeout: TimeInterval = 5
}
