# Pi Pocket Multi-Terminal

Owner-only Linux-Terminals mit mehreren Tabs und einer mobilen Sondertastenleiste für Pi Pocket 0.27.0 oder neuer.

## Installation und Update

```bash
bash install.sh
```

Voraussetzungen: Linux, Node.js ≥22.19, npm sowie `python3`, `make` und `g++` für node-pty. In Pi Pocket unter **Menü → Extensions** die Extension `terminal` aktivieren.

Das Skript installiert die bestehenden Abhängigkeiten und bündelt die Browserdateien lokal. Die geprüften Versionen sind **xterm.js 6.0.0** und **FitAddon 0.11.0**. Es werden weder ein CDN noch ein zusätzlicher Terminalserver benötigt. `PI_POCKET_DIR` kann den Installationsordner ändern.

**Vor einem Update laufende Arbeiten in den Terminals sichern.** Das Ersetzen von `terminal.ts` kann die Extension neu laden. Neuladen/Deaktivieren der Extension oder ein Pi-Pocket-Serverneustart beendet wie bisher ihre PTYs. Ein Browser-Neuladen oder Tab-Wechsel beendet sie dagegen nicht. Für diese Entwicklung wurde die laufende Installation nicht ersetzt.

## Bedienung

- Bis zu acht unabhängige PTYs; Sitzungen bleiben beim Schließen des Browsers erhalten.
- Die Sondertasten steuern ausschließlich den ausgewählten Terminal-Tab.
- **Tastatur** fokussiert das Eingabeelement der aktiven Sitzung. Ein Browser kann das Öffnen der Bildschirmtastatur trotzdem einschränken.
- Standardleiste: **Esc · Tab · Ctrl · Alt · ↑ · ↓ · ← · → · Enter**.
- Die Leiste ist horizontal scrollbar. Auf schmalen Displays liegen **Enter** und **Mehr** gegebenenfalls rechts außerhalb des sichtbaren Ausschnitts.
- **Mehr** öffnet eine zweite scrollbare Reihe: **Shift, Home, End, PgUp, PgDn, Insert, Delete, Backspace, F1–F12** sowie `/ - | ~ \ [ ] { }`.
- Delete sendet eine andere Sequenz als Backspace. Die zusätzlichen Tasten besitzen mindestens 44 × 44 CSS-Pixel große Touch-Flächen.

### Modifier

1. **Ctrl**, **Alt** oder **Shift** einmal antippen: für die nächste geeignete Eingabe aktivieren (`•`).
2. Anschließend eine Sondertaste oder einen einzelnen ASCII-Buchstaben auf der Bildschirmtastatur eingeben. Beispiel: **Ctrl → c** sendet ausschließlich `\x03`.
3. Nach Annahme durch den lokalen Eingabekanal werden einmalige Modifier zurückgesetzt. Ein erneutes Antippen deaktiviert sie ebenfalls.

Modifier sind unabhängig kombinierbar. Ist die Option zum Einrasten eingeschaltet, aktiviert Doppeltippen innerhalb von 350 ms einen dauerhaften Zustand (`▣`). Ein weiteres einzelnes Antippen deaktiviert ihn. Ein aktiver Shift-Modifier bleibt auch nach Einklappen der erweiterten Reihe sichtbar.

Tab-Wechsel, Verbindungsverlust und Ausblenden der Leiste setzen Modifier zurück. Es gibt keine automatische Tastenwiederholung durch die Leiste. Die normale physische Tastatur bleibt ohne aktive virtuelle Modifier im xterm-Eingabepfad; es werden keine globalen Tastatur-Handler installiert.

## Einstellungen

Unter **Menü → Extensions → terminal** speichert Pi Pocket die Einstellungen über seine dokumentierte Extension-API. Die Werte gelten für die Extension und werden an verbundene Browser verteilt; sie sind keine gerätespezifischen Browserpräferenzen.

| Einstellung | Standard | Verhalten |
| --- | --- | --- |
| Sondertastenleiste anzeigen | Automatisch | `any-pointer: coarse`, beispielsweise Smartphone, Tablet oder Touch-Hybridgerät |
| Sichtbarkeit: Immer / Nie | – | Manuell unabhängig von der Geräteerkennung ein-/ausblenden |
| Erweiterte Tasten beim Öffnen anzeigen | Aus | Vorgabe beim Öffnen; **Mehr/Weniger** ändert die aktuelle Ansicht |
| Aktive Modifier hervorheben | Ein | Zusätzlicher Rahmen; Zustandszeichen und `aria-pressed` bleiben auch ohne Hervorhebung verfügbar |
| Haptisches Feedback | Aus | Kurze Vibration, sofern der Browser `navigator.vibrate()` unterstützt |
| Modifier per Doppeltippen einrasten | Aus | Aktiviert die optionale dauerhafte Sperre |

Die Schaltfläche **Einstellungen** unter dem Terminal zeigt den Weg zu dieser Konfiguration. Die Extension benötigt dafür weder eigene Konfigurationsendpunkte noch `localStorage`. Schlägt das Laden fehl, zeigt sie eine Meldung und verwendet Standardwerte.

## Eingabepfad und Sicherheit

```text
Touch-Taste / geeignete Tastatureingabe
  → Modifier + modusabhängiger Encoder
  → xterm.input()
  → bestehendes onData
  → sitzungsgebundene, serielle Eingabewarteschlange
  → pocket.api('sessions/:id/input')
  → bestehende Owner-Prüfung und node-pty
```

- Alle bestehenden Terminalrouten bleiben Owner-only und verwenden Pi-Pocket-Authentifizierung und `X-Pocket`-Schutz.
- Keine neuen produktiven Endpunkte, Ports, Terminalprozesse oder Backend-Abhängigkeiten für die Tastenleiste.
- Shells laufen weiterhin als der Betriebssystembenutzer von Pi Pocket, mit dessen Dateizugriffen und Zugangsdaten. Nicht auf einer nicht vertrauenswürdigen Instanz aktivieren.
- Geschlossene oder getrennte Sitzungen erhalten keine neuen lokalen Eingaben. Veraltete Controller werden beim Tab-Wechsel sofort deaktiviert und anschließend entsorgt.
- Eingabeanfragen werden geordnet gesendet, in Blöcken bis 4096 UTF-16-Codeeinheiten, ohne Surrogatpaare aufzuteilen. Die lokale Warteschlange ist auf 64 KiB-Codeeinheiten begrenzt.
- **Fehlgeschlagene Eingaben werden nie automatisch wiederholt.** Bereits begonnene Anfragen können die PTY schon erreicht haben, auch wenn ihre Antwort fehlt. Ausstehende lokale Daten werden verworfen. Nach einem Eingabefehler muss **Neu verbinden** explizit betätigt werden.
- Ausgabeabfragen dürfen sich nach Verbindungsfehlern erneut verbinden; das wiederholt keine Benutzereingaben. **Neu verbinden** aktualisiert auch die Sitzungsliste und startet keine neue Shell.
- Terminalantworten und Paste werden nicht pauschal als Tastendrücke umcodiert.

Pi Pocket bietet hier keinen dokumentierten rohen WebSocket-Upgrade. Der vorhandene Long-Polling-Kanal bleibt bestehen. Der Server hält weiterhin bis zu 256 KiB-Codeeinheiten Ausgabe pro Sitzung für das Wiederverbinden vor.

## Technische Grenzen

- Der Encoder verwendet öffentliche xterm-APIs (`input`, `modes`, `textarea`, `focus`, `attachCustomKeyEventHandler`), keine privaten `_core`-Felder. Application-Cursor-Modus wird berücksichtigt; modifizierte Navigation verwendet traditionelle xterm-CSI-Parameter.
- Shift für virtuelle ASCII-Zeichen verwendet das **US-ASCII-Layout**. Bereits verschobene Zeichen wie `{` bleiben erhalten. Die physische Tastatur ohne virtuelle Modifier verwendet unverändert ihr eigenes Layout.
- Ctrl unterstützt A–Z, Space/@/2, [/3, Backslash/4, ]/5, ^/6, _/7/Slash und ?/8. Ctrl+Backspace sendet `\x08`, normales Backspace `\x7f`. Nicht definierte Ctrl-Kombinationen werden nicht erfunden; die normale Eingabe bleibt erhalten und der Modifier wartet weiter.
- Shift+Tab verwendet `CSI Z`; Ctrl+Tab ist nicht von Tab unterscheidbar. CSI-u, Kitty-Keyboard-Protokoll und eine zusätzliche Shift-Byte-Codierung werden nicht implementiert.
- **IME-Kompositionen, Dead Keys, mehrteilige Unicode-Zeichen, Paste und Mehrzeichen-Eingaben werden nicht in Ctrl/Alt/Shift-Kombinationen umgewandelt.** Modifier bleiben dafür aktiv. Während einer laufenden Komposition sendet die Leiste keine Sondertasten: Komposition zuerst bestätigen oder über die native Tastatur abbrechen. Einfache, nicht komponierende ASCII-Eingaben werden auch über mobile Keycode-229- und reine Input-Event-Pfade verarbeitet.
- Bei Keycode 229 verhindert der Controller für übernommene Nicht-IME-Eingaben xterms verzögerten Textarea-Differenzpfad. Ein Capture-Listener am übergeordneten Element verarbeitet den Input vor xterms eigenem Textarea-Listener. Die Extension löscht oder verändert den Textarea-Inhalt nicht selbst.
- Die Leiste passt ausschließlich ihr eigenes Layout an `visualViewport` und `ResizeObserver` an. Native Bildschirmtastaturen, Pinch-Zoom, Browserleisten und Fokusregeln bleiben plattformabhängig. **Android Chrome und iOS Safari müssen noch auf echten Geräten geprüft werden.** Chromium-Viewporttests sind kein Ersatz dafür.
- Safari/iOS unterstützt die Vibrations-API üblicherweise nicht. Haptik ist eine optionale Fähigkeit, keine Funktionsvoraussetzung.

## Tests ausführen

### Automatisierte Node-Tests

Ohne Installation zusätzlicher Testabhängigkeiten:

```bash
npm test
bash -n install.sh
node --check terminal/index.js
```

Getestet werden Encoder, sämtliche Modifier-Kombinationen, Zustandswechsel, mobile Input-Transaktionen, Unicode-/IME-Schutz, Tab-/Disconnect-Warteschlangen und die unveränderte Registrierung der Owner-Routen.

### Isolierte Browser-Fixture

Die Fixture verwendet das echte xterm und Preact, aber **simulierte Terminaldaten ohne Shell und ohne Live-Pi-Pocket-Daten**. Ihr rein statischer Entwicklungsserver bindet ausschließlich an Loopback und einen zufälligen Port:

```bash
POCKET_PACKAGE_DIR="$(npm root -g)/pi-pocket" npm run test:browser
```

Bei einer anderen Pi-Pocket-Installation `POCKET_PACKAGE_DIR` auf ihren Paketordner setzen. Die Terminal-Abhängigkeiten werden standardmäßig aus `~/.pi-pocket/terminal-deps` gelesen; `PI_POCKET_TERMINAL_DEPS` kann diesen Pfad ändern.

Die ausgegebene lokale URL in Chromium öffnen. In der Browserkonsole:

```javascript
await (await import('/checks.mjs')).runBrowserChecks()
```

Vor jedem weiteren Lauf die Fixture neu laden. Der Bericht enthält jeden geprüften Fall. Es werden unter anderem initiale Terminalantworten, virtuelle Modifier, Keycode 229, Capture-Reihenfolge, Paste, Kompositionen, Moduswechsel, überlappende Resizes, Tab-Wechsel und unsichere Eingabefehler geprüft. Die synthetischen Events bestätigen keine native Touch-/IME-Implementierung des Betriebssystems. `Ctrl+C` im Serverterminal beendet die Fixture.

### Echte, kurzlebige Linux-PTYs

```bash
npm run test:pty
```

Das Skript verwendet das bereits installierte node-pty, temporäre Dateien, isolierte Konfiguration und gegebenenfalls einen privaten tmux-Socket. Es verändert keine Pi-Pocket-Sitzungen und installiert keine Programme. Fehlende Programme werden als **SKIP**, nicht als bestanden gemeldet.

## Teststand dieser Änderung

| Prüfung | Ergebnis |
| --- | --- |
| Node-Tests | 42 bestanden, 0 fehlgeschlagen |
| Chromium-Fixture, Desktop 1280×800 | 16 bestanden, 0 fehlgeschlagen |
| Chromium-Fixture, Hochformat 390×844 | 16 bestanden, 0 fehlgeschlagen |
| Chromium-Fixture, Querformat 844×390 | 16 bestanden, 0 fehlgeschlagen |
| Kleiner Viewport 390×240 | Kein horizontaler Seitenüberlauf; Terminal, beide Tastenreihen und Fußleiste sichtbar |
| Chromium, echte Browser-Tastaturereignisse | Normales `a`, physisches Ctrl+C und virtuelles Ctrl → c korrekt; Terminalfokus erhalten |
| Linux-PTY-Suite | 7 bestanden, 0 fehlgeschlagen, 3 übersprungen |
| Bash | Tab-Vervollständigung, Ctrl+C, Ctrl+D, Ctrl+Z, Pfeile, Home/End geprüft |
| Rohdaten in echter PTY | Delete/Backspace, F1–F12 und ausgewählte Modifier geprüft |
| tmux | Isolierter Shell-/Eingabe-/Detach-Smoke-Test bestanden; keine vollständige Anwendungstestmatrix |
| Vim, Nano, htop | Übersprungen: Programme auf diesem Rechner nicht installiert |
| Native Android-/iOS-Tastatur, reale Touch-Gesten | Nicht getestet |
| Vollständige Pi-Pocket-UI-/Authentifizierungsintegration | Nicht neu end-to-end getestet; vorhandene Routen und Berechtigungen unverändert |

Offene Geräteabnahme: Android Chrome und iOS Safari jeweils mit Bildschirmtastatur, Ctrl → c, Escape, horizontalem Scrollen, Hoch-/Querformat und Wiederverbinden prüfen. Vim, Nano und htop nach Verfügbarkeit mit den tatsächlich verwendeten Konfigurationen prüfen.

## Codeaufteilung

- `terminal.ts`: bestehende PTY-/Owner-Routen; zusätzlich die fünf Einstellungsfelder.
- `terminal/index.js`: UI, aktiver Sitzungscontroller, Fokus, Status und Größenanpassung.
- `terminal/input-encoder.mjs`: reine Zeichen- und Steuersequenzcodierung.
- `terminal/modifiers.mjs`: reine, unveränderliche Modifier-Zustände.
- `terminal/input-controller.mjs`: Zusammenführung virtueller Tasten, Keyboard-/Input-Events und Kompositionsschutz.
- `terminal/input-queue.mjs`: geordnete, begrenzte Übertragung ohne Wiederholungen.
- `terminal/preferences.mjs`: Vorgaben und Validierung der clientseitig gelesenen Einstellungen.
- `terminal/terminal.css`: responsive, themefähige Touch-Leiste.
- `install.sh`: Installation aller Clientmodule und Fixierung der geprüften xterm-Versionen.
- `package.json`, `test/`: Testbefehle, Unit-Tests, Browser-Fixture und PTY-Smoke-Tests.
