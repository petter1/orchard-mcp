// Compiled together with swift/Sources/AppleBridge/JSON.swift by
// tests/swift-dates.test.ts under TZ=Europe/Zurich.
import Foundation

func check(_ ok: Bool, _ msg: String) {
    print(ok ? "ok  " : "FAIL", msg)
    if !ok { exit(1) }
}

var cal = Calendar(identifier: .gregorian)
cal.timeZone = .current
let allDay = cal.date(from: DateComponents(year: 2026, month: 11, day: 18))!

check(iso8601(allDay) == "2026-11-18T00:00:00+01:00", "all-day start prints local: \(iso8601(allDay))")
check(iso8601(cal.date(from: DateComponents(year: 2026, month: 7, day: 1, hour: 9))!) == "2026-07-01T09:00:00+02:00", "summer offset")
check(try! DateParsing.parseISO("2026-11-18") == allDay, "date-only = local midnight")
check(try! DateParsing.parseISO("2026-11-18T00:00:00") == allDay, "no offset = local time")
check(try! DateParsing.parseISO("2026-11-17T23:00:00Z") == allDay, "Z accepted")
check(try! DateParsing.parseISO("2026-11-18T00:00:00.000+01:00") == allDay, "fractional + offset")
check(try! DateParsing.parseISO("2026-11-18T09:30") == cal.date(from: DateComponents(year: 2026, month: 11, day: 18, hour: 9, minute: 30))!, "minutes only")
check((try? DateParsing.parseISO("18.11.2026")) == nil, "rejects other formats")
check(isoDay(allDay) == "2026-11-18", "isoDay")
