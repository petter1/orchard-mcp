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
| 18.11.2026 | Die Linux-Lösung kommt in diesen Fork, nicht in ein eigenes Repo. |
| 18.11.2026 | **icloud-mcp wird auf Linux als Backend eingebunden.** Orchard reicht dort Kalender-, Kontakt- und Mail-Aufrufe an einen icloud-mcp-Prozess weiter. icloud-mcp bleibt ein eigenes Projekt (Go) und bleibt nah am Upstream. Verworfen: den Go-Code nach TypeScript übernehmen, denn dann fielen die Upstream-Updates und Sicherheitsfixes weg. |

## Arbeitsregeln für Sessions

- Swift-Bridge bauen und testen geht nur auf macOS (`npm run build`, `npm test`). Auf Linux oder in einer Cloud-Session nur TypeScript bearbeiten, `npm run build:ts`, `npm run lint` und die TS-Tests, die ohne Bridge laufen.
- Eine Änderung pro Branch. PRs für upstream auf Englisch und vom aktuellen `upstream/main` abzweigen. Diese `ROADMAP.md` nicht in Upstream-PRs mitnehmen.
- Nach jedem erledigten Schritt hier den Status nachführen (✅ + Datum).

## Lücken (gefunden im Alltag, 11.–18.11.2026)

| # | Problem | Verbesserung | Phase |
|---|---|---|---|
| 1 | Mails lassen sich nicht verschieben (nur per AppleScript) | `mail_move` (einzeln + Batch, Zielordner pro Konto), gibt neue ID/Message-ID zurück (#14) | 2 · ✅ 20.11. Branch `feat/mail-move-create-mailbox` (Message-ID bleibt gleich, Rückgabe mit neuem Konto/Ordner) |
| 2 | Mail-Ordner lassen sich nicht anlegen | `mail_create_mailbox` | 2 · ✅ 20.11. Branch `feat/mail-move-create-mailbox` |
| 3 | IDs aus `mail_search`/`mail_unread_summary` funktionieren nicht in `mail_read_message` | ID durchgängig konsistent (Mail.app-`id`) | 2 · ✅ 20.11. Branch `fix/mail-search-locator`. Ursache: Suche ohne Konto lieferte kein Konto und fest `INBOX`. IDs sind überall die RFC-Message-ID. |
| 4 | Ein Postfach lässt sich nicht ganz auflisten (nur Suche mit Query) | `mail_list_messages` mit Paging + Datumsfilter | 2 · ✅ 20.11. Branch `feat/mail-list-messages` (baut auf `fix/local-time-dates`) |
| 5 | Kalender nur lesend | `calendar_create_event` / `_update_event` / `_delete_event` (EventKit), bei Serien `span: thisEvent` | 3 · ✅ 20.11. Branch `feat/calendar-write` (Serien nur mit `occurrenceStart` oder `span: futureEvents`). **Noch nicht live getestet** (Kalenderzugriff wartete auf Dialog). |
| 6 | Reminders nicht bearbeitbar (Datum, Notiz, Liste); AppleScript läuft bei grossen Listen (~600 Einträge) in Timeouts | `reminders_update_reminder` (EventKit) | 3 · ✅ 20.11. Branch `feat/reminders-update`. **Noch nicht live getestet.** |
| 7 | Keine Flags/Gelesen-Status | `mail_set_flag`, `mail_mark_read` | 2 · ✅ 20.11. Branch `feat/mail-flag-read-status` |
| 8 | **Bug:** Kontakte lassen sich nie freigeben, weil `swift/Sources/AppleBridge/Info.plist` `NSContactsUsageDescription` fehlt. macOS lehnt dann ohne Dialog ab. | Key ergänzen, Issue/PR upstream. (Lokal auf dem Mac gepatcht, geht bei `npm update` verloren.) | 1 · ✅ 20.11. Branch `fix/contacts-usage-description` |
| 9 | Berechtigungsdialoge landen unbemerkt im Mitteilungszentrum und gelten dann als abgelehnt | Setup-Hinweis: Dialog sofort bestätigen, sonst `tccutil reset <Dienst> io.l22.apple-bridge` | 4 · ✅ 20.11. README-Abschnitt «Permission dialogs» + Fehlermeldung mit `tccutil`-Befehl (Branch `fix/permission-prompt-timeout`) |
| 10 | **Bug:** `system_doctor` meldet Kalender/Reminders/Kontakte als «denied», obwohl die Tools funktionieren | Doctor wie die übrigen Befehle über `AppleBridge.app` ausführen | 1 · ✅ 20.11. Branch `fix/doctor-via-app-bundle` (auch `orchard-mcp setup`) |
| 11 | **Bug:** `calendar_list_events` liefert bei Tagesfenstern falsche Tage (Abfrage für den 18.11. lieferte Einträge vom 17.11.) | Zeitzonen-/Bereichslogik prüfen, Test mit Tagesfenster in `Europe/Zurich` | 3 · ✅ 20.11. Branch `fix/local-time-dates`. Ursache: `ISO8601DateFormatter` rechnet in GMT, Ganztagestermin vom 18.11. kam als `…17T23:00:00Z`. Swift-Regressionstest. |
| 12 | Grosse Antworten (Kalender 3 Wochen ≈ 120 KB) sprengen den Kontext | Kompaktes Ausgabeformat / Feldauswahl | 3 · ✅ 20.11. Branch `feat/calendar-compact-output` (`detail: "compact"`) |
| 13 | Jeder Neu-Build signiert `AppleBridge.app` ad hoc neu. macOS fragt dann Kalender/Kontakte erneut ab. Der Doctor wartet bei `notDetermined` ohne Zeitlimit auf den Dialog (gesehen 20.11.: hängt > 2 min, MCP-Aufruf läuft nach 20 s in den Timeout). | Doctor soll nur Status melden und nicht selbst nachfragen (oder mit Zeitlimit). Stabile Signatur prüfen. | 4 · ✅ 20.11. Branch `fix/permission-prompt-timeout`: Zeitlimit 8 s für alle Berechtigungsanfragen, Doctor meldet `pending`. Offen: stabile Signatur. |

## Branches (Stand 20.11.2026, alle lokal, nicht gepusht)

| Branch | Basis | Inhalt | Upstream-PR |
|---|---|---|---|
| `fix/doctor-via-app-bundle` | `main` | #10 | ja |
| `fix/contacts-usage-description` | `main` | #8 | ja |
| `fix/mail-search-locator` | `main` | #3 | ja |
| `fix/local-time-dates` | `main` | #11 | ja |
| `fix/permission-prompt-timeout` | `main` | #13, #9 | ja |
| `feat/mail-move-create-mailbox` | `main` | #1, #2 | ja, nach Live-Test |
| `feat/mail-flag-read-status` | `main` | #7 | ja, nach Live-Test |
| `feat/mail-list-messages` | `fix/local-time-dates` | #4 | ja, nach #11 |
| `feat/calendar-write` | `fix/local-time-dates` | #5 | ja, nach #11 und Live-Test |
| `feat/reminders-update` | `fix/local-time-dates` | #6 | ja, nach #11 und Live-Test |
| `feat/calendar-compact-output` | `main` | #12 | ja |
| `fork/local` | `main` | alles zusammen, für den lokalen Build: 74 Tools, 183/183 Tests | nein |

Upstream-Varianten ✅ 20.11.: Jeder Branch liegt zusätzlich als `pr/<branch>` direkt auf `upstream/main` (eigene Commits per Cherry-Pick, ohne `ROADMAP.md` und Fork-Zeile in `AGENTS.md`). Alle `pr/*` ohne Konflikte, Typecheck sauber, Tests grün (153 + neue Tests). `pr/feat/mail-list-messages`, `pr/feat/calendar-write` und `pr/feat/reminders-update` bauen auf `pr/fix/local-time-dates`. Nicht gepusht. Jeder Branch hat einen eigenen `## [Unreleased]`-Block im `CHANGELOG.md` und eigene Tool-Zahlen in README/AGENTS/CONTRIBUTING. Beim Zusammenführen gibt es dort einfache Konflikte.

**Achtung Berechtigungen:** Jeder Neu-Build signiert `AppleBridge.app` ad hoc neu. macOS fragt dann Kalender, Reminders und Kontakte erneut ab, auch für die global installierte Version (gleiche Bundle-ID). Dialog bestätigen, sonst melden die Tools «permission dialog is waiting».

## Phasen

| Phase | Inhalt | Status |
|---|---|---|
| 1 Setup | Fork ✅ 13.11. · Build + Tests auf dem Mac ✅ 20.11. (153/153) · Bugs #8 und #10 ✅ 20.11. (Branches, nicht gepusht) · offen: Claude-Config (Code + Desktop) auf den lokalen Build umstellen (heute: globale npm-Installation) | grösstenteils erledigt 20.11.2026 |
| 2a Mail | #1, #2 | ✅ 20.11.2026 (Branch, live nur ohne echte Verschiebung getestet) |
| 2b Mail | #3, #4, #7 | ✅ 20.11.2026 (Branches) |
| 3 Kalender & Reminders | #5, #6, #11, #12 | ✅ 20.11.2026 (Branches). #5 und #6 noch live testen, sobald der Kalender-/Reminders-Dialog bestätigt ist. |
| 4 Abschluss | Tests, README, #9, Upstream-PRs, Version taggen | #9 ✅ 20.11. · PR-Branches `pr/*` vorbereitet ✅ 20.11. · offen: Live-Tests (Mail verschieben/markieren, Kalender, Reminders), Push + Upstream-PRs, Version taggen · geplant Di 15.12.2026 |
| 5 Linux | siehe unten | noch nicht eingeplant, frühestens 2027 |

Hinweis: Phase 1 muss vor den anderen laufen. Fällt sie später, verschieben sich die übrigen.

## Phase 5: Linux mit icloud-mcp als Backend

Voraussetzung: icloud-mcp Phase 1 (eigener Build aus dem Fork, Lesen gegen iCloud getestet).

Heute ist Orchard nur für macOS gebaut: `package.json` hat `"os": ["darwin"]`, `scripts/postinstall.sh` baut die Swift-Bridge, und `src/server.ts` registriert alle Tool-Module.

Plan:
1. **Plattformweiche** in `src/server.ts`: Auf `darwin` bleibt alles wie heute. Auf `linux` werden nur Kalender, Kontakte und Mail registriert. Notes, Reminders, Files, Numbers, Pages und Keynote gibt es auf Linux nicht.
2. **Backend-Client:** Orchard startet icloud-mcp als Kindprozess (stdio) und ruft es als MCP-Client auf (`@modelcontextprotocol/sdk` Client + `StdioClientTransport`). Pfad zum Binary per Umgebungsvariable (z. B. `ICLOUD_MCP_BIN`). Zugangsdaten bleiben in der Konfiguration von icloud-mcp (`~/.config/icloud-mcp/`, Dateien mit Rechten 600). Orchard liest sie nie.
3. **Tool-Abbildung:** Die Orchard-Namen bleiben, damit Clients auf Mac und Linux dieselben Tools sehen. Zuordnung, geprüft gegen icloud-mcp v1.2.0 am 20.11.2026:

   | Orchard | icloud-mcp |
   |---|---|
   | `calendar_list_calendars` | `list_calendars` |
   | `calendar_list_events`, `calendar_today` | `search_events` (Zeitfenster) |
   | `calendar_search` | `search_events` |
   | `calendar_create_event` / `_update_event` / `_delete_event` | `create_event` / `update_event` / `delete_event` (Serien-Semantik abgleichen: Orchard `occurrenceStart` + `span`) |
   | `contacts_search` | `search_contacts` |
   | `contacts_read_contact` | `get_contact` |
   | `contacts_list_groups` | `list_address_books` (nur annähernd) |
   | `mail_list_accounts` | `icloud_capabilities` / Konfiguration (nur iCloud-Konto) |
   | `mail_search`, `mail_unread_summary`, `mail_flagged` | `search_messages` (mit Filtern) |
   | `mail_read_message` | `get_message` |
   | `mail_list_messages` | `search_messages` ohne Text, mit Zeitfenster (prüfen) bzw. `list_mailboxes` für die Ordner |
   | `mail_move` | `move_message` (nur einzeln, Batch in Orchard als Schleife bis icloud-mcp #4) |
   | `mail_set_flag`, `mail_mark_read` | `set_message_flags` |
   | `mail_create_mailbox` | fehlt auch in v1.2.0, kommt im icloud-mcp-Fork (#2) |
   | `mail_create_draft`, `mail_save_attachment` | fehlt bzw. anders (`send_message` sendet direkt, nicht als Entwurf) |

4. **Sicherheit:** Die App-Safety-Grenzen aus `src/safety.ts` (Zeit, Ausgabegrösse, breite Anfragen ablehnen) gelten auch für den Linux-Pfad. icloud-mcp standardmässig nur lesend starten (`ICLOUD_MCP_READ_ONLY=true`). Schreibrechte nur gezielt freigeben.
5. **Paket:** `"os"` um `linux` erweitern. `postinstall.sh` überspringt auf Linux den Swift-Build. README-Abschnitt «Linux» ergänzen.
6. **Tests:** Backend-Client mit einem Fake-MCP-Server testen. Diese Tests laufen ohne macOS und ohne iCloud.

Ob Phase 5 upstream gehen soll, ist offen. Erst fragen, ob l22-io Linux-Support will. Sonst bleibt sie im Fork.
