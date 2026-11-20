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
| 3 | IDs aus `mail_search`/`mail_unread_summary` funktionieren nicht in `mail_read_message` | ID durchgängig konsistent (Mail.app-`id`) | 2 |
| 4 | Ein Postfach lässt sich nicht ganz auflisten (nur Suche mit Query) | `mail_list_messages` mit Paging + Datumsfilter | 2 |
| 5 | Kalender nur lesend | `calendar_create_event` / `_update_event` / `_delete_event` (EventKit), bei Serien `span: thisEvent` | 3 |
| 6 | Reminders nicht bearbeitbar (Datum, Notiz, Liste); AppleScript läuft bei grossen Listen (~600 Einträge) in Timeouts | `reminders_update_reminder` (EventKit) | 3 |
| 7 | Keine Flags/Gelesen-Status | `mail_set_flag`, `mail_mark_read` | 2 · ✅ 20.11. Branch `feat/mail-flag-read-status` |
| 8 | **Bug:** Kontakte lassen sich nie freigeben, weil `swift/Sources/AppleBridge/Info.plist` `NSContactsUsageDescription` fehlt. macOS lehnt dann ohne Dialog ab. | Key ergänzen, Issue/PR upstream. (Lokal auf dem Mac gepatcht, geht bei `npm update` verloren.) | 1 · ✅ 20.11. Branch `fix/contacts-usage-description` |
| 9 | Berechtigungsdialoge landen unbemerkt im Mitteilungszentrum und gelten dann als abgelehnt | Setup-Hinweis: Dialog sofort bestätigen, sonst `tccutil reset <Dienst> io.l22.apple-bridge` | 4 |
| 10 | **Bug:** `system_doctor` meldet Kalender/Reminders/Kontakte als «denied», obwohl die Tools funktionieren | Doctor wie die übrigen Befehle über `AppleBridge.app` ausführen | 1 · ✅ 20.11. Branch `fix/doctor-via-app-bundle` (auch `orchard-mcp setup`) |
| 11 | **Bug:** `calendar_list_events` liefert bei Tagesfenstern falsche Tage (Abfrage für den 18.11. lieferte Einträge vom 17.11.) | Zeitzonen-/Bereichslogik prüfen, Test mit Tagesfenster in `Europe/Zurich` | 3 |
| 12 | Grosse Antworten (Kalender 3 Wochen ≈ 120 KB) sprengen den Kontext | Kompaktes Ausgabeformat / Feldauswahl | 3 |
| 13 | Jeder Neu-Build signiert `AppleBridge.app` ad hoc neu. macOS fragt dann Kalender/Kontakte erneut ab. Der Doctor wartet bei `notDetermined` ohne Zeitlimit auf den Dialog (gesehen 20.11.: hängt > 2 min, MCP-Aufruf läuft nach 20 s in den Timeout). | Doctor soll nur Status melden und nicht selbst nachfragen (oder mit Zeitlimit). Stabile Signatur prüfen. | 4 |

## Branches (Stand 20.11.2026, alle lokal, nicht gepusht)

| Branch | Inhalt | Upstream-PR |
|---|---|---|
| `fix/doctor-via-app-bundle` | #10 | ja, geeignet |
| `fix/contacts-usage-description` | #8 | ja, geeignet |
| `feat/mail-move-create-mailbox` | #1, #2 | ja, nach Live-Test mit echter Mail |
| `feat/mail-flag-read-status` | #7 | ja, nach Live-Test mit echter Mail |
| `fork/local` | `main` + alle vier zusammen, für den lokalen Build (168/168 Tests grün, 69 Tools) | nein |

Die vier Feature-Branches zweigen von `main` ab. Für Upstream-PRs vorher auf `upstream/main` rebasen und `ROADMAP.md`/`AGENTS.md`-Fork-Zeile weglassen. Alle vier tragen einen eigenen `## [Unreleased]`-Block im `CHANGELOG.md`, beim Zusammenführen gibt es dort einen einfachen Konflikt.

## Phasen

| Phase | Inhalt | Status |
|---|---|---|
| 1 Setup | Fork ✅ 13.11. · Build + Tests auf dem Mac ✅ 20.11. (153/153) · Bugs #8 und #10 ✅ 20.11. (Branches, nicht gepusht) · offen: Claude-Config (Code + Desktop) auf den lokalen Build umstellen (heute: globale npm-Installation) | grösstenteils erledigt 20.11.2026 |
| 2a Mail | #1, #2 | ✅ 20.11.2026 (Branch, live nur ohne echte Verschiebung getestet) |
| 2b Mail | #3, #4, #7 | #7 ✅ 20.11.2026 (Branch) · #3, #4 offen, geplant Di 01.12.2026 |
| 3 Kalender & Reminders | #5, #6, #11, #12 | geplant Di 08.12.2026 |
| 4 Abschluss | Tests, README, #9, Upstream-PRs, Version taggen | geplant Di 15.12.2026 |
| 5 Linux | siehe unten | noch nicht eingeplant, frühestens 2027 |

Hinweis: Phase 1 muss vor den anderen laufen. Fällt sie später, verschieben sich die übrigen.

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
   | `mail_move` (Phase 2) | `move_message` |
   | `mail_set_flag`, `mail_mark_read` (Phase 2) | `set_message_flags` |
   | `mail_create_mailbox` (Phase 2) | fehlt noch, kommt im icloud-mcp-Fork |
   | `mail_create_draft`, `mail_save_attachment` | fehlt bzw. anders (`send_message` sendet direkt, nicht als Entwurf) |

4. **Sicherheit:** Die App-Safety-Grenzen aus `src/safety.ts` (Zeit, Ausgabegrösse, breite Anfragen ablehnen) gelten auch für den Linux-Pfad. icloud-mcp standardmässig nur lesend starten (`ICLOUD_MCP_READ_ONLY=true`). Schreibrechte nur gezielt freigeben.
5. **Paket:** `"os"` um `linux` erweitern. `postinstall.sh` überspringt auf Linux den Swift-Build. README-Abschnitt «Linux» ergänzen.
6. **Tests:** Backend-Client mit einem Fake-MCP-Server testen. Diese Tests laufen ohne macOS und ohne iCloud.

Ob Phase 5 upstream gehen soll, ist offen. Erst fragen, ob l22-io Linux-Support will. Sonst bleibt sie im Fork.
