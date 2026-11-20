import EventKit
import Foundation

enum RemindersBridge {
    private static let store = EKEventStore()
    private static let maxReminderResults = 200

    static func requestAccess() async -> Bool {
        PermissionGate.requireAnswer(service: "Reminders", await requestAccessAnswer())
    }

    /// The permission answer, or nil while the dialog is unanswered.
    static func requestAccessAnswer() async -> Bool? {
        await PermissionGate.request { done in
            store.requestFullAccessToReminders { granted, _ in done(granted) }
        }
    }

    static func authorizationStatus() -> EKAuthorizationStatus {
        return EKEventStore.authorizationStatus(for: .reminder)
    }

    static func listLists() async {
        guard await requestAccess() else {
            JSONOutput.error("Reminders access denied. Grant access in System Settings > Privacy & Security > Reminders.")
            return
        }

        let calendars = store.calendars(for: .reminder)

        // Fetch all reminders to count per list
        let predicate = store.predicateForReminders(in: nil)
        let allReminders = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { result in
                continuation.resume(returning: result ?? [])
            }
        }

        // Count reminders per calendar
        var counts: [String: Int] = [:]
        for rem in allReminders {
            let calId = rem.calendar.calendarIdentifier
            counts[calId, default: 0] += 1
        }

        let result: [[String: Any]] = calendars.map { cal in
            var dict: [String: Any] = [
                "id": cal.calendarIdentifier,
                "title": cal.title,
                "allowsModify": cal.allowsContentModifications,
                "itemCount": counts[cal.calendarIdentifier] ?? 0
            ]
            if let source = cal.source {
                dict["account"] = source.title
            }
            if let color = cal.cgColor {
                let components = color.components ?? []
                if components.count >= 3 {
                    let r = Int(components[0] * 255)
                    let g = Int(components[1] * 255)
                    let b = Int(components[2] * 255)
                    dict["color"] = String(format: "#%02x%02x%02x", r, g, b)
                }
            }
            return dict
        }

        JSONOutput.success(result)
    }

    static func listReminders(listName: String?, filter: String, limit: Int) async {
        guard await requestAccess() else {
            JSONOutput.error("Reminders access denied. Grant access in System Settings > Privacy & Security > Reminders.")
            return
        }

        var calendars: [EKCalendar]? = nil
        if let name = listName {
            let matches = store.calendars(for: .reminder).filter {
                $0.title.localizedCaseInsensitiveCompare(name) == .orderedSame
            }
            if matches.isEmpty {
                JSONOutput.error("Reminder list not found: \(name)")
                return
            }
            calendars = matches
        }

        let predicate = store.predicateForReminders(in: calendars)
        let allReminders = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { result in
                continuation.resume(returning: result ?? [])
            }
        }

        let now = Date()
        let startOfToday = Calendar.current.startOfDay(for: now)
        let endOfToday = Calendar.current.date(byAdding: .day, value: 1, to: startOfToday)!

        let filtered: [EKReminder]
        switch filter {
        case "completed":
            filtered = allReminders.filter { $0.isCompleted }
        case "overdue":
            filtered = allReminders.filter { !$0.isCompleted && $0.dueDateComponents != nil && (Calendar.current.date(from: $0.dueDateComponents!) ?? .distantFuture) < startOfToday }
        case "dueToday":
            filtered = allReminders.filter {
                guard !$0.isCompleted, let dc = $0.dueDateComponents, let due = Calendar.current.date(from: dc) else { return false }
                return due >= startOfToday && due < endOfToday
            }
        case "all":
            filtered = allReminders
        default: // "incomplete"
            filtered = allReminders.filter { !$0.isCompleted }
        }

        let safeLimit = min(max(limit, 1), maxReminderResults)
        let limited = Array(filtered.prefix(safeLimit))
        let result: [[String: Any]] = limited.map { rem in
            formatReminder(rem)
        }

        JSONOutput.success(result)
    }

    static func today() async {
        guard await requestAccess() else {
            JSONOutput.error("Reminders access denied. Grant access in System Settings > Privacy & Security > Reminders.")
            return
        }

        let predicate = store.predicateForReminders(in: nil)
        let allReminders = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { result in
                continuation.resume(returning: result ?? [])
            }
        }

        let now = Date()
        let startOfToday = Calendar.current.startOfDay(for: now)
        let endOfToday = Calendar.current.date(byAdding: .day, value: 1, to: startOfToday)!

        let todayAndOverdue = allReminders.filter { rem in
            guard !rem.isCompleted else { return false }
            guard let dc = rem.dueDateComponents, let due = Calendar.current.date(from: dc) else { return false }
            return due < endOfToday
        }

        let result: [[String: Any]] = todayAndOverdue.prefix(maxReminderResults).map { rem in
            formatReminder(rem)
        }

        JSONOutput.success(result)
    }

    static func createList(name: String) async {
        guard await requestAccess() else {
            JSONOutput.error("Reminders access denied. Grant access in System Settings > Privacy & Security > Reminders.")
            return
        }

        let existing = store.calendars(for: .reminder).filter {
            $0.title.localizedCaseInsensitiveCompare(name) == .orderedSame
        }
        if !existing.isEmpty {
            JSONOutput.error("A reminder list named '\(name)' already exists.")
            return
        }

        let cal = EKCalendar(for: .reminder, eventStore: store)
        cal.title = name

        guard let source = store.defaultCalendarForNewReminders()?.source else {
            JSONOutput.error("No reminder source available.")
            return
        }
        cal.source = source

        do {
            try store.saveCalendar(cal, commit: true)
            let result: [String: Any] = [
                "id": cal.calendarIdentifier,
                "title": cal.title,
                "account": source.title,
                "allowsModify": cal.allowsContentModifications
            ]
            JSONOutput.success(result)
        } catch {
            JSONOutput.error("Failed to create list: \(error.localizedDescription)")
        }
    }

    static func createReminder(listName: String, title: String, dueDate: String?, priority: Int, notes: String?) async {
        guard await requestAccess() else {
            JSONOutput.error("Reminders access denied. Grant access in System Settings > Privacy & Security > Reminders.")
            return
        }

        let matches = store.calendars(for: .reminder).filter {
            $0.title.localizedCaseInsensitiveCompare(listName) == .orderedSame
        }
        guard let calendar = matches.first else {
            JSONOutput.error("Reminder list not found: \(listName)")
            return
        }

        let reminder = EKReminder(eventStore: store)
        reminder.title = title
        reminder.calendar = calendar
        reminder.priority = priority

        if let notes = notes {
            reminder.notes = notes
        }

        if let dueDateStr = dueDate {
            guard let components = dueComponents(dueDateStr) else {
                JSONOutput.error("\(DateParseError(input: dueDateStr))")
                return
            }
            reminder.dueDateComponents = components
        }

        do {
            try store.save(reminder, commit: true)
            JSONOutput.success(formatReminder(reminder))
        } catch {
            JSONOutput.error("Failed to create reminder: \(error.localizedDescription)")
        }
    }

    struct ReminderChanges {
        var title: String?
        var dueDate: String?
        var notes: String?
        var priority: Int?
        var listName: String?
        var completed: Bool?
    }

    /// Change fields of one reminder. Empty dueDate/notes clear the value.
    static func updateReminder(id: String, changes: ReminderChanges) async {
        guard await requestAccess() else {
            JSONOutput.error("Reminders access denied. Grant access in System Settings > Privacy & Security > Reminders.")
            return
        }
        guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
            JSONOutput.error("Reminder not found with id: \(id)")
            return
        }
        if let title = changes.title {
            guard !title.trimmingCharacters(in: .whitespaces).isEmpty else {
                JSONOutput.error("Title must not be empty.")
                return
            }
            reminder.title = title
        }
        if let due = changes.dueDate {
            if due.isEmpty {
                reminder.dueDateComponents = nil
                // Reason: an alarm tied to a removed due date would fire for nothing.
                reminder.alarms = nil
            } else {
                guard let components = dueComponents(due) else {
                    JSONOutput.error("\(DateParseError(input: due))")
                    return
                }
                reminder.dueDateComponents = components
            }
        }
        if let notes = changes.notes { reminder.notes = notes.isEmpty ? nil : notes }
        if let priority = changes.priority {
            guard (0...9).contains(priority) else {
                JSONOutput.error("Priority must be 0 (none) to 9.")
                return
            }
            reminder.priority = priority
        }
        if let listName = changes.listName {
            let matches = store.calendars(for: .reminder).filter {
                $0.title.localizedCaseInsensitiveCompare(listName) == .orderedSame
            }
            guard let list = matches.first else {
                JSONOutput.error("Reminder list not found: \(listName)")
                return
            }
            guard list.allowsContentModifications else {
                JSONOutput.error("Reminder list \"\(list.title)\" is read-only.")
                return
            }
            reminder.calendar = list
        }
        if let completed = changes.completed { reminder.isCompleted = completed }

        do {
            try store.save(reminder, commit: true)
            JSONOutput.success(formatReminder(reminder))
        } catch {
            JSONOutput.error("Failed to update reminder: \(error.localizedDescription)")
        }
    }

    static func completeReminder(id: String) async {
        guard await requestAccess() else {
            JSONOutput.error("Reminders access denied. Grant access in System Settings > Privacy & Security > Reminders.")
            return
        }

        guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
            JSONOutput.error("Reminder not found with id: \(id)")
            return
        }

        if reminder.isCompleted {
            JSONOutput.error("Reminder is already completed.")
            return
        }

        reminder.isCompleted = true

        do {
            try store.save(reminder, commit: true)
            JSONOutput.success(formatReminder(reminder))
        } catch {
            JSONOutput.error("Failed to complete reminder: \(error.localizedDescription)")
        }
    }

    static func deleteReminder(id: String) async {
        guard await requestAccess() else {
            JSONOutput.error("Reminders access denied. Grant access in System Settings > Privacy & Security > Reminders.")
            return
        }

        guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
            JSONOutput.error("Reminder not found with id: \(id)")
            return
        }

        let info = formatReminder(reminder)

        do {
            try store.remove(reminder, commit: true)
            JSONOutput.success(info)
        } catch {
            JSONOutput.error("Failed to delete reminder: \(error.localizedDescription)")
        }
    }

    static func deleteList(id: String, force: Bool) async {
        guard await requestAccess() else {
            JSONOutput.error("Reminders access denied. Grant access in System Settings > Privacy & Security > Reminders.")
            return
        }

        guard let calendar = store.calendar(withIdentifier: id) else {
            JSONOutput.error("Reminder list not found with id: \(id)")
            return
        }

        if !force {
            let predicate = store.predicateForReminders(in: [calendar])
            let reminders = await withCheckedContinuation { continuation in
                store.fetchReminders(matching: predicate) { result in
                    continuation.resume(returning: result ?? [])
                }
            }
            if !reminders.isEmpty {
                JSONOutput.error("List '\(calendar.title)' has \(reminders.count) reminders. Set force=true to delete anyway.")
                return
            }
        }

        let info: [String: Any] = [
            "id": calendar.calendarIdentifier,
            "title": calendar.title
        ]

        do {
            try store.removeCalendar(calendar, commit: true)
            JSONOutput.success(info)
        } catch {
            JSONOutput.error("Failed to delete list: \(error.localizedDescription)")
        }
    }

    // MARK: - Helpers

    /// Due date components: a date alone gives a day without time (as the
    /// Reminders app does), anything else a local date and time.
    private static func dueComponents(_ input: String) -> DateComponents? {
        guard let date = try? DateParsing.parseISO(input) else { return nil }
        let isDateOnly = input.trimmingCharacters(in: .whitespaces).range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
        let units: Set<Calendar.Component> = isDateOnly ? [.year, .month, .day] : [.year, .month, .day, .hour, .minute, .second]
        var components = Calendar.current.dateComponents(units, from: date)
        components.calendar = Calendar.current
        components.timeZone = isDateOnly ? nil : TimeZone.current
        return components
    }

    private static func formatReminder(_ rem: EKReminder) -> [String: Any] {
        var dict: [String: Any] = [
            "id": rem.calendarItemIdentifier,
            "title": rem.title ?? "(no title)",
            "isCompleted": rem.isCompleted,
            "list": rem.calendar.title,
            "priority": rem.priority
        ]
        if let dc = rem.dueDateComponents, let due = Calendar.current.date(from: dc) {
            if dc.hour == nil {
                dict["dueDate"] = isoDay(due)
                dict["dueAllDay"] = true
            } else {
                dict["dueDate"] = iso8601(due)
            }
        }
        if rem.isCompleted, let completed = rem.completionDate {
            dict["completionDate"] = iso8601(completed)
        }
        if let notes = rem.notes, !notes.isEmpty {
            dict["notes"] = notes
        }
        if rem.hasRecurrenceRules {
            dict["hasRecurrence"] = true
        }
        return dict
    }
}
