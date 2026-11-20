import Foundation

// Reason: Centralised JSON envelope so every subcommand returns a consistent
// {"status": "ok"|"error", "data": ..., "error": ...} structure.

enum JSONOutput {
    /// When set, output is written to this file path instead of stdout.
    /// Used by .app bundle mode where stdout is not capturable.
    static var outputPath: String?

    static func success(_ data: Any) {
        let envelope: [String: Any] = [
            "status": "ok",
            "data": data
        ]
        printJSON(envelope)
    }

    static func error(_ message: String) {
        let envelope: [String: Any] = [
            "status": "error",
            "error": message
        ]
        printJSON(envelope)
    }

    private static func printJSON(_ dict: [String: Any]) {
        do {
            let data = try JSONSerialization.data(
                withJSONObject: dict,
                options: [.prettyPrinted, .sortedKeys]
            )
            if let str = String(data: data, encoding: .utf8) {
                if let path = outputPath {
                    try str.write(toFile: path, atomically: true, encoding: .utf8)
                } else {
                    print(str)
                }
            }
        } catch {
            // Reason: Last-resort fallback if JSONSerialization itself fails.
            let fallback = "{\"status\":\"error\",\"error\":\"JSON serialization failed: \(error.localizedDescription)\"}"
            if let path = outputPath {
                try? fallback.write(toFile: path, atomically: true, encoding: .utf8)
            } else {
                print(fallback)
            }
        }
    }
}

/// Convert a Date to an ISO 8601 string in the local time zone, with offset
/// (e.g. 2026-11-18T00:00:00+01:00). Reason: ISO8601DateFormatter defaults to
/// GMT, which printed a local all-day event on the 18th as "...17T23:00:00Z".
func iso8601(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = TimeZone.current
    return formatter.string(from: date)
}

/// Calendar day of a Date in the local time zone, e.g. 2026-11-18.
func isoDay(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone.current
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}

struct DateParseError: Error, CustomStringConvertible {
    let input: String
    var description: String {
        "Invalid date: \(input). Use ISO 8601, e.g. 2026-11-18, 2026-11-18T09:00:00 (local time) or 2026-11-18T08:00:00Z."
    }
}

/// Parse the ISO 8601 forms tool callers send. Strings without an offset are
/// local time; a date alone means local midnight of that day.
enum DateParsing {
    static func parseISO(_ input: String) throws -> Date {
        let str = input.trimmingCharacters(in: .whitespaces)
        for options: ISO8601DateFormatter.Options in [[.withInternetDateTime, .withFractionalSeconds], [.withInternetDateTime]] {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = options
            if let date = formatter.date(from: str) { return date }
        }
        let local = DateFormatter()
        local.locale = Locale(identifier: "en_US_POSIX")
        local.calendar = Calendar(identifier: .gregorian)
        local.timeZone = TimeZone.current
        for format in ["yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd"] {
            local.dateFormat = format
            if let date = local.date(from: str) { return date }
        }
        throw DateParseError(input: input)
    }
}
