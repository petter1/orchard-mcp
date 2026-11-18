# Roadmap des Forks petter1/orchard-mcp

Diese Datei gilt nur für den Fork. Sie soll reichen, damit eine Session ohne Vorwissen weiterarbeiten kann. Technische Repo-Regeln stehen in [AGENTS.md](AGENTS.md).

- Fork: https://github.com/petter1/orchard-mcp (`origin`)
- Upstream: https://github.com/l22-io/orchard-mcp (`upstream`), MIT, TypeScript + Swift-Bridge
- Stand 18.11.2026: Fork identisch mit `upstream/main` (Version 0.6.5), abgesehen von dieser Roadmap
- Schwesterprojekt: https://github.com/petter1/icloud-mcp (Go, iCloud über CalDAV/CardDAV/IMAP/SMTP, siehe dort `ROADMAP.md`)

## Ziel

Orchard im Fork verbessern, lokal nutzen und gute Änderungen als PR an `upstream` anbieten. Später läuft Orchard auch auf Linux, mit icloud-mcp als Backend.

## Entscheide

| Datum | Entscheid |
|---|---|
| 13.11.2026 | Fork unter `petter1`. Gute Änderungen gehen als PR upstream. |
| 18.11.2026 | Upstream-PRs und Diskussionen im Upstream-Repo macht nur Yanik, nie Claude (kein Overhead in upstream). |
| 18.11.2026 | Die Linux-Lösung kommt in diesen Fork, nicht in ein eigenes Repo. |
| 18.11.2026 | **icloud-mcp wird auf Linux als Backend eingebunden.** Orchard reicht dort Kalender-, Kontakt- und Mail-Aufrufe an einen icloud-mcp-Prozess weiter. icloud-mcp bleibt ein eigenes Projekt (Go) und bleibt nah am Upstream. Verworfen: den Go-Code nach TypeScript übernehmen, denn dann fielen die Upstream-Updates und Sicherheitsfixes weg. |

## Arbeitsregeln für Sessions

- Swift-Bridge bauen und testen geht nur auf macOS (`npm run build`, `npm test`). Auf Linux oder in einer Cloud-Session nur TypeScript bearbeiten, `npm run build:ts`, `npm run lint` und die TS-Tests, die ohne Bridge laufen.
- **Keine Interaktion mit upstream (Entscheid Yanik 18.11.2026):** Claude öffnet keine PRs, Issues oder Kommentare im Upstream-Repo und beteiligt sich nicht an Diskussionen dort. Upstream-PRs macht Yanik selbst. Claude bereitet höchstens Branches im Fork vor (von `upstream/main` abgezweigt, ohne ROADMAP).
- Eine Änderung pro Branch. PRs für upstream auf Englisch und vom aktuellen `upstream/main` abzweigen. Diese `ROADMAP.md` nicht in Upstream-PRs mitnehmen.
- Nach jedem erledigten Schritt hier den Status nachführen (✅ + Datum).

## Lücken (gefunden im Alltag, 11.–18.11.2026)

| # | Problem | Verbesserung | Phase |
|---|---|---|---|
| 1 | Mails lassen sich nicht verschieben (nur per AppleScript) | `mail_move` (einzeln + Batch, Zielordner pro Konto), gibt neue ID/Message-ID zurück (#14) | 2 |
| 2 | Mail-Ordner lassen sich nicht anlegen | `mail_create_mailbox` | 2 |
| 3 | IDs aus `mail_search`/`mail_unread_summary` funktionieren nicht in `mail_read_message` | ID durchgängig konsistent (Mail.app-`id`) | 2 |
| 4 | Ein Postfach lässt sich nicht ganz auflisten (nur Suche mit Query) | `mail_list_messages` mit Paging + Datumsfilter | 2 |
| 5 | Kalender nur lesend | `calendar_create_event` / `_update_event` / `_delete_event` (EventKit), bei Serien `span: thisEvent` | 3 |
| 6 | Reminders nicht bearbeitbar (Datum, Notiz, Liste); AppleScript läuft bei grossen Listen (~600 Einträge) in Timeouts | `reminders_update_reminder` (EventKit) | 3 |
| 7 | Keine Flags/Gelesen-Status | `mail_set_flag`, `mail_mark_read` | 2 |
| 8 | **Bug:** Kontakte lassen sich nie freigeben, weil `swift/Sources/AppleBridge/Info.plist` `NSContactsUsageDescription` fehlt. macOS lehnt dann ohne Dialog ab. | Key ergänzt ✅ 18.11. (Branch `fix/contacts-usage-description`, von `upstream/main`). Offen: auf dem Mac bauen und testen. PR upstream macht Yanik selbst. | 1 |
| 9 | Berechtigungsdialoge landen unbemerkt im Mitteilungszentrum und gelten dann als abgelehnt | Setup-Hinweis: Dialog sofort bestätigen, sonst `tccutil reset <Dienst> io.l22.apple-bridge` | 4 |
| 10 | **Bug:** `system_doctor` meldet Kalender/Reminders/Kontakte als «denied», obwohl die Tools funktionieren | Doctor wie die übrigen Befehle über `AppleBridge.app` ausführen | 1 |
| 11 | **Bug:** `calendar_list_events` liefert bei Tagesfenstern falsche Tage (Abfrage für den 18.11. lieferte Einträge vom 17.11.) | Zeitzonen-/Bereichslogik prüfen, Test mit Tagesfenster in `Europe/Zurich` | 3 |
| 12 | Grosse Antworten (Kalender 3 Wochen ≈ 120 KB) sprengen den Kontext | Kompaktes Ausgabeformat / Feldauswahl | 3 |

## Phasen

| Phase | Inhalt | Status |
|---|---|---|
| 1 Setup | Fork ✅ 13.11. · auf dem Mac klonen, `npm install && npm run build && npm test`, Claude-Config (Code + Desktop) auf den lokalen Build umstellen · Bugs #8 und #10 | geplant So 29.11.2026 |
| 2a Mail | #1, #2 | geplant Di 24.11.2026 |
| 2b Mail | #3, #4, #7 | geplant Di 01.12.2026 |
| 3 Kalender & Reminders | #5, #6, #11, #12 | geplant Di 08.12.2026 |
| 4 Abschluss | Tests, README, #9, Upstream-PRs, Version taggen | geplant Di 15.12.2026 |
| 5 Linux | siehe unten | noch nicht eingeplant, frühestens 2027 |

Hinweis: Phase 1 muss vor den anderen laufen. Fällt sie später, verschieben sich die übrigen.

Stand 18.11.2026 (Cloud-Session): #8 im Code behoben, noch nicht auf dem Mac getestet. Prüfen am Mac (So 29.11.): `npm run build`, dann `contacts_search` aufrufen; erscheint kein Dialog, `tccutil reset AddressBook io.l22.apple-bridge` und erneut versuchen. Ebenfalls prüfen: Ab macOS 14 erwartet `requestFullAccessToEvents`/`…Reminders` laut Apple die Keys `NSCalendarsFullAccessUsageDescription` und `NSRemindersFullAccessUsageDescription`. Die plist hat nur die alten Keys. Kalender und Reminders laufen bei Yanik trotzdem, also nur beobachten und bei Bedarf ergänzen.

Auf Seiten icloud-mcp gibt es seit 18.11. die Gegenstücke für Phase 2a/5: `create_mailbox` und `move_messages` (Batch mit neuen UIDs). Die Tabelle in Phase 5 entsprechend lesen: `mail_create_mailbox` → `create_mailbox`, `mail_move` (Batch) → `move_messages`.

## Phase 5: Linux mit icloud-mcp als Backend

Voraussetzung: icloud-mcp Phase 1 (eigener Build aus dem Fork, Lesen gegen iCloud getestet).

Heute ist Orchard nur für macOS gebaut: `package.json` hat `"os": ["darwin"]`, `scripts/postinstall.sh` baut die Swift-Bridge, und `src/server.ts` registriert alle Tool-Module.

Plan:
1. **Plattformweiche** in `src/server.ts`: Auf `darwin` bleibt alles wie heute. Auf `linux` werden nur Kalender, Kontakte und Mail registriert. Notes, Reminders, Files, Numbers, Pages und Keynote gibt es auf Linux nicht.
2. **Backend-Client:** Orchard startet icloud-mcp als Kindprozess (stdio) und ruft es als MCP-Client auf (`@modelcontextprotocol/sdk` Client + `StdioClientTransport`). Pfad zum Binary per Umgebungsvariable (z. B. `ICLOUD_MCP_BIN`). Zugangsdaten bleiben in der Konfiguration von icloud-mcp (`~/.config/icloud-mcp/`, Dateien mit Rechten 600). Orchard liest sie nie.
3. **Tool-Abbildung:** Die Orchard-Namen bleiben, damit Clients auf Mac und Linux dieselben Tools sehen. Erste Zuordnung (gegen den aktuellen icloud-mcp-Stand prüfen):

   | Orchard | icloud-mcp |
   |---|---|
   | `calendar_list_calendars` | `list_calendars` |
   | `calendar_list_events`, `calendar_today` | `search_events` (Zeitfenster) |
   | `calendar_search` | `search_events` |
   | `calendar_create_event` / `_update_event` / `_delete_event` (Phase 3) | `create_event` / `update_event` / `delete_event` |
   | `contacts_search` | `search_contacts` |
   | `contacts_read_contact` | `get_contact` |
   | `contacts_list_groups` | `list_address_books` (nur annähernd) |
   | `mail_list_accounts` | `icloud_capabilities` / Konfiguration (nur iCloud-Konto) |
   | `mail_search`, `mail_unread_summary`, `mail_flagged` | `search_messages` (mit Filtern) |
   | `mail_read_message` | `get_message` |
   | `mail_move` (Phase 2) | `move_message` (einzeln), `move_messages` (Batch, seit 18.11. im Fork) |
   | `mail_set_flag`, `mail_mark_read` (Phase 2) | `set_message_flags` |
   | `mail_create_mailbox` (Phase 2) | `create_mailbox` (seit 18.11. im icloud-mcp-Fork) |
   | `mail_create_draft`, `mail_save_attachment` | fehlt bzw. anders (`send_message` sendet direkt, nicht als Entwurf) |

4. **Sicherheit:** Die App-Safety-Grenzen aus `src/safety.ts` (Zeit, Ausgabegrösse, breite Anfragen ablehnen) gelten auch für den Linux-Pfad. icloud-mcp standardmässig nur lesend starten (`ICLOUD_MCP_READ_ONLY=true`). Schreibrechte nur gezielt freigeben.
5. **Paket:** `"os"` um `linux` erweitern. `postinstall.sh` überspringt auf Linux den Swift-Build. README-Abschnitt «Linux» ergänzen.
6. **Tests:** Backend-Client mit einem Fake-MCP-Server testen. Diese Tests laufen ohne macOS und ohne iCloud.

Ob Phase 5 upstream gehen soll, ist offen. Erst fragen, ob l22-io Linux-Support will. Sonst bleibt sie im Fork.
