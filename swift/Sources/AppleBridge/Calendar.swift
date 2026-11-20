import EventKit
import Foundation

// Reason: All calendar access goes through EventKit, which properly handles
// recurring event expansion via predicateForEvents -- something AppleScript cannot do.

enum CalendarBridge {
    private static let store = EKEventStore()
    private static let maxCalendarRangeDays: TimeInterval = 31
    private static let maxCalendarResults = 500

    /// Request full calendar access. Returns true if granted.
    static func requestAccess() async -> Bool {
        do {
            return try await store.requestFullAccessToEvents()
        } catch {
            return false
        }
    }

    /// Check current authorization status without prompting.
    static func authorizationStatus() -> EKAuthorizationStatus {
        return EKEventStore.authorizationStatus(for: .event)
    }

    /// List all calendars with account and metadata.
    static func listCalendars() async {
        guard await requestAccess() else {
            JSONOutput.error("Calendar access denied. Grant access in System Settings > Privacy & Security > Calendars.")
            return
        }

        let calendars = store.calendars(for: .event)
        let result: [[String: Any]] = calendars.map { cal in
            var dict: [String: Any] = [
                "id": cal.calendarIdentifier,
                "title": cal.title,
                "type": calendarTypeName(cal.type),
                "allowsModify": cal.allowsContentModifications
            ]
            if let source = cal.source {
                dict["account"] = source.title
                dict["accountType"] = sourceTypeName(source.sourceType)
            }
            if let color = cal.cgColor {
                // Reason: Convert CGColor to hex for easy display/filtering.
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

    /// Fetch events in a date range, optionally filtered by calendar ID.
    /// Recurring events are properly expanded via predicateForEvents.
    static func listEvents(startISO: String, endISO: String, calendarID: String?) async {
        guard await requestAccess() else {
            JSONOutput.error("Calendar access denied.")
            return
        }

        guard let startDate = try? DateParsing.parseISO(startISO) else {
            JSONOutput.error("\(DateParseError(input: startISO))")
            return
        }
        guard let endDate = try? DateParsing.parseISO(endISO) else {
            JSONOutput.error("\(DateParseError(input: endISO))")
            return
        }
        guard validateRange(start: startDate, end: endDate, tool: "calendar-list-events") else {
            return
        }

        var calendars: [EKCalendar]? = nil
        if let calID = calendarID {
            if let cal = store.calendar(withIdentifier: calID) {
                calendars = [cal]
            } else {
                JSONOutput.error("Calendar not found: \(calID)")
                return
            }
        }

        let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: calendars)
        let events = Array(store.events(matching: predicate).prefix(maxCalendarResults))

        JSONOutput.success(events.map(eventDict))
    }

    /// Search events by title within a date range.
    static func searchEvents(query: String, startISO: String, endISO: String) async {
        guard await requestAccess() else {
            JSONOutput.error("Calendar access denied.")
            return
        }

        guard let startDate = try? DateParsing.parseISO(startISO) else {
            JSONOutput.error("\(DateParseError(input: startISO))")
            return
        }
        guard let endDate = try? DateParsing.parseISO(endISO) else {
            JSONOutput.error("\(DateParseError(input: endISO))")
            return
        }
        guard validateRange(start: startDate, end: endDate, tool: "calendar-search-events") else {
            return
        }

        let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: nil)
        let events = store.events(matching: predicate)

        let lowered = query.lowercased()
        let filtered = events.filter { evt in
            let title = (evt.title ?? "").lowercased()
            let notes = (evt.notes ?? "").lowercased()
            let location = (evt.location ?? "").lowercased()
            return title.contains(lowered) || notes.contains(lowered) || location.contains(lowered)
        }

        let result: [[String: Any]] = filtered.prefix(maxCalendarResults).map { evt in
            [
                "id": evt.eventIdentifier ?? "",
                "title": evt.title ?? "(no title)",
                "start": iso8601(evt.startDate),
                "end": iso8601(evt.endDate),
                "isAllDay": evt.isAllDay,
                "calendar": evt.calendar.title
            ]
        }

        JSONOutput.success(result)
    }

    // MARK: - Write

    enum Span: String {
        case thisEvent, futureEvents
        var ekSpan: EKSpan { self == .thisEvent ? .thisEvent : .futureEvents }
    }

    struct EventFields {
        var title: String?
        var start: String?
        var end: String?
        var allDay: Bool?
        var location: String?
        var notes: String?
        var url: String?
    }

    /// Create an event. For all-day events, start/end are days and end is the
    /// last day (inclusive); end may be omitted for a one-day event.
    static func createEvent(calendarID: String?, fields: EventFields) async {
        guard await requestAccess() else {
            JSONOutput.error("Calendar access denied.")
            return
        }
        guard let title = fields.title, !title.trimmingCharacters(in: .whitespaces).isEmpty else {
            JSONOutput.error("event-create requires a non-empty --title.")
            return
        }
        let calendar: EKCalendar
        if let calID = calendarID {
            guard let cal = store.calendar(withIdentifier: calID) else {
                JSONOutput.error("Calendar not found: \(calID)")
                return
            }
            calendar = cal
        } else {
            guard let cal = store.defaultCalendarForNewEvents else {
                JSONOutput.error("No default calendar for new events. Pass --calendar.")
                return
            }
            calendar = cal
        }
        guard calendar.allowsContentModifications else {
            JSONOutput.error("Calendar \"\(calendar.title)\" is read-only.")
            return
        }
        guard fields.start != nil else {
            JSONOutput.error("event-create requires --start.")
            return
        }
        let event = EKEvent(eventStore: store)
        event.calendar = calendar
        guard apply(fields, to: event, isNew: true) else { return }
        do {
            try store.save(event, span: .thisEvent, commit: true)
        } catch {
            JSONOutput.error("Saving the event failed: \(error.localizedDescription)")
            return
        }
        JSONOutput.success(eventDict(event))
    }

    static func updateEvent(id: String, occurrenceISO: String?, span: Span, fields: EventFields) async {
        guard await requestAccess() else {
            JSONOutput.error("Calendar access denied.")
            return
        }
        guard let event = locateEvent(id: id, occurrenceISO: occurrenceISO, span: span) else { return }
        guard apply(fields, to: event, isNew: false) else { return }
        do {
            try store.save(event, span: span.ekSpan, commit: true)
        } catch {
            JSONOutput.error("Saving the event failed: \(error.localizedDescription)")
            return
        }
        JSONOutput.success(eventDict(event))
    }

    static func deleteEvent(id: String, occurrenceISO: String?, span: Span) async {
        guard await requestAccess() else {
            JSONOutput.error("Calendar access denied.")
            return
        }
        guard let event = locateEvent(id: id, occurrenceISO: occurrenceISO, span: span) else { return }
        let summary = eventDict(event)
        do {
            try store.remove(event, span: span.ekSpan, commit: true)
        } catch {
            JSONOutput.error("Deleting the event failed: \(error.localizedDescription)")
            return
        }
        JSONOutput.success(["deleted": summary, "span": span.rawValue] as [String: Any])
    }

    /// Find an event or one occurrence of a series. Refuses to touch a
    /// series implicitly: a recurring event needs an occurrence start or an
    /// explicit futureEvents span.
    private static func locateEvent(id: String, occurrenceISO: String?, span: Span) -> EKEvent? {
        guard let base = store.event(withIdentifier: id) else {
            JSONOutput.error("Event not found: \(id)")
            return nil
        }
        guard base.calendar.allowsContentModifications else {
            JSONOutput.error("Calendar \"\(base.calendar.title)\" is read-only.")
            return nil
        }
        guard let occurrenceISO = occurrenceISO else {
            if base.hasRecurrenceRules && span == .thisEvent {
                JSONOutput.error("Event \(id) is recurring. Pass --occurrence-start (the start of the occurrence from calendar.list_events) to change one occurrence, or --span futureEvents to change the whole series.")
                return nil
            }
            return base
        }
        guard let occurrence = try? DateParsing.parseISO(occurrenceISO) else {
            JSONOutput.error("\(DateParseError(input: occurrenceISO))")
            return nil
        }
        let predicate = store.predicateForEvents(
            withStart: occurrence.addingTimeInterval(-60),
            end: occurrence.addingTimeInterval(86_400),
            calendars: [base.calendar]
        )
        let match = store.events(matching: predicate).first {
            $0.eventIdentifier == id && abs($0.startDate.timeIntervalSince(occurrence)) < 1
        }
        guard let found = match else {
            JSONOutput.error("No occurrence of event \(id) starts at \(occurrenceISO).")
            return nil
        }
        return found
    }

    /// Copy the given fields onto an event. Reports an error and returns false
    /// on invalid input.
    private static func apply(_ fields: EventFields, to event: EKEvent, isNew: Bool) -> Bool {
        if let title = fields.title {
            guard !title.trimmingCharacters(in: .whitespaces).isEmpty else {
                JSONOutput.error("Title must not be empty.")
                return false
            }
            event.title = title
        }
        if let allDay = fields.allDay { event.isAllDay = allDay }
        let oldStart: Date? = isNew ? nil : event.startDate
        let oldEnd: Date? = isNew ? nil : event.endDate
        let newStart: Date?
        let newEnd: Date?
        do {
            newStart = try fields.start.map(DateParsing.parseISO)
            newEnd = try fields.end.map(DateParsing.parseISO)
        } catch {
            JSONOutput.error("\(error)")
            return false
        }
        guard var startDate = newStart ?? oldStart else {
            JSONOutput.error("Event start is required.")
            return false
        }
        var endDate: Date
        if let given = newEnd {
            endDate = given
        } else if let oldStart = oldStart, let oldEnd = oldEnd {
            // Reason: moving an event without a new end keeps its duration.
            endDate = startDate.addingTimeInterval(oldEnd.timeIntervalSince(oldStart))
        } else {
            endDate = event.isAllDay ? startDate : startDate.addingTimeInterval(3_600)
        }
        if event.isAllDay {
            // Reason: callers name the last day (inclusive); EventKit stores the
            // end of that day. Subtracting a second keeps an end stored as the
            // next midnight on the right day.
            let cal = Calendar.current
            startDate = cal.startOfDay(for: startDate)
            let lastDay = newEnd != nil ? cal.startOfDay(for: endDate) : cal.startOfDay(for: max(startDate, endDate.addingTimeInterval(-1)))
            endDate = cal.date(byAdding: .second, value: 86_399, to: lastDay)!
        }
        guard endDate >= startDate else {
            JSONOutput.error("Event end must be on or after its start.")
            return false
        }
        event.startDate = startDate
        event.endDate = endDate
        if let location = fields.location { event.location = location.isEmpty ? nil : location }
        if let notes = fields.notes { event.notes = notes.isEmpty ? nil : notes }
        if let url = fields.url {
            if url.isEmpty {
                event.url = nil
            } else {
                guard let parsed = URL(string: url), parsed.scheme != nil else {
                    JSONOutput.error("Invalid URL: \(url)")
                    return false
                }
                event.url = parsed
            }
        }
        return true
    }

    // MARK: - Helpers

    private static func eventDict(_ evt: EKEvent) -> [String: Any] {
        var dict: [String: Any] = [
            "id": evt.eventIdentifier ?? "",
            "title": evt.title ?? "(no title)",
            "start": iso8601(evt.startDate),
            "end": iso8601(evt.endDate),
            "isAllDay": evt.isAllDay,
            "calendar": evt.calendar.title,
            "calendarId": evt.calendar.calendarIdentifier
        ]
        if let location = evt.location, !location.isEmpty {
            dict["location"] = location
        }
        if let notes = evt.notes, !notes.isEmpty {
            dict["notes"] = notes
        }
        if let url = evt.url {
            dict["url"] = url.absoluteString
        }
        if evt.hasRecurrenceRules {
            dict["isRecurring"] = true
        }
        if let attendees = evt.attendees, !attendees.isEmpty {
            dict["attendees"] = attendees.map { a in
                var info: [String: Any] = [
                    "name": a.name ?? a.url.absoluteString,
                    "status": participantStatusName(a.participantStatus)
                ]
                if a.isCurrentUser {
                    info["isMe"] = true
                }
                return info
            }
        }
        return dict
    }

    private static func validateRange(start: Date, end: Date, tool: String) -> Bool {
        guard end >= start else {
            JSONOutput.error("\(tool) requires end date to be on or after start date.")
            return false
        }

        let days = end.timeIntervalSince(start) / 86_400
        guard days <= maxCalendarRangeDays else {
            JSONOutput.error("\(tool) refuses date ranges over \(Int(maxCalendarRangeDays)) days.")
            return false
        }

        return true
    }

    private static func calendarTypeName(_ type: EKCalendarType) -> String {
        switch type {
        case .local: return "local"
        case .calDAV: return "caldav"
        case .exchange: return "exchange"
        case .subscription: return "subscription"
        case .birthday: return "birthday"
        @unknown default: return "unknown"
        }
    }

    private static func sourceTypeName(_ type: EKSourceType) -> String {
        switch type {
        case .local: return "local"
        case .exchange: return "exchange"
        case .calDAV: return "caldav"
        case .mobileMe: return "mobileme"
        case .subscribed: return "subscribed"
        case .birthdays: return "birthdays"
        @unknown default: return "unknown"
        }
    }

    private static func participantStatusName(_ status: EKParticipantStatus) -> String {
        switch status {
        case .unknown: return "unknown"
        case .pending: return "pending"
        case .accepted: return "accepted"
        case .declined: return "declined"
        case .tentative: return "tentative"
        case .delegated: return "delegated"
        case .completed: return "completed"
        case .inProcess: return "in_process"
        @unknown default: return "unknown"
        }
    }
}
