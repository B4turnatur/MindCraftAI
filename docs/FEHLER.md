# Fehler-Datenbank

## F-001 – patch-package: mineflayer-Patch passt nicht mehr
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/patches/` · Windows 11 · mineflayer 4.39.0
**Fehlermeldung:**
    **ERROR** Failed to apply patch for package mineflayer at path
      node_modules/mineflayer
    Patch file: patches/mineflayer+4.33.0.patch
    Patch was made for version: 4.33.0
    Installed version: 4.39.0
**Nachstellen:** `npm install` in mindcraft/ (package.json hat `^4.33.0` → 4.39.0)
**Ursache:** Mindcraft-Patch für alte Version; 4.39 hat 2 von 3 Änderungen schon selbst (Wasser beim Abbauen, use_item-Rotation), place_block wurde umgebaut.
**Versuche:**
1. `git apply --check` → ❌ alle 3 Hunks passen nicht
2. Nur fehlenden Fix (`incorrect_for_wooden_tool` → `mineable/pickaxe` in `digging.js`) von Hand, `npx patch-package mineflayer` → ✅
**Lösung:** neuer Patch `patches/mineflayer+4.39.0.patch`, alter gelöscht.
**Vorbeugen:** Nach jedem mineflayer-Update die `npm install`-Ausgabe auf „Failed to apply patch“ prüfen.

## F-002 – claude-cli: „OAuth session expired“
**Status:** 🟢 gelöst (2026-11-06, Nutzer hat sich eingeloggt: authMethod claude.ai, Pro)
**Wann/Wo:** 2026-11-06 · `mindcraft/src/models/claude_cli.js` · Claude Code 2.1.296 · Windows 11
**Fehlermeldung:**
    [claude-cli] exit 1: Failed to authenticate: OAuth session expired and could not be refreshed
**Nachstellen:** `node src/models/claude_cli.js` in mindcraft/ (oder `claude auth status` → `"loggedIn": false`)
**Ursache:** Der eigenständige CLI-Login (außerhalb der Desktop-App) ist abgelaufen. Die Desktop-App nutzt einen eigenen Login, den Miku absichtlich NICHT mitbenutzt (Env-Variablen CLAUDE_CODE_*/ANTHROPIC_BASE_URL werden entfernt).
**Lösung:** In einem normalen Terminal `claude auth login` (oder `claude` → `/login`) mit dem Abo-Konto, danach `node src/models/claude_cli.js` → muss eine Antwort zeigen.
**Vorbeugen:** Bei „My brain disconnected“ zuerst `claude auth status` prüfen.

## F-003 – miku.json kaputt nach Eintragen der Voice-ID
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/profiles/miku.json`
**Fehlermeldung:**
    json.decoder.JSONDecodeError: Invalid control character at: line 6 column 72 (char 129)
**Nachstellen:** Voice-ID eingefügt und dabei das schließende `",` am Zeilenende mit gelöscht.
**Ursache:** Zeile `"speak_model": "fish/s2.1-pro-free/<id>` ohne `",` → Mindcraft könnte das Profil nicht laden.
**Lösung:** `",` ergänzt, mit `json.load` geprüft.
**Vorbeugen:** Nach Änderungen prüfen: `python -c "import json;json.load(open('mindcraft/profiles/miku.json',encoding='utf8'))"`

## F-004 – Push-to-Talk: V wird manchmal nicht erkannt
**Status:** 🟡 behoben, Nutzer-Test offen
**Wann/Wo:** 2026-11-06 · `voice/ptt.py` → `main()` · Windows 11 · keyboard-Lib
**Fehlermeldung:** keine – Aufnahme startet einfach nicht (keine „● Aufnahme“-Zeile im Log)
**Nachstellen:** In Minecraft Strg (Sprinten) oder Shift (Schleichen) halten und V drücken; oder V drücken, während der vorige Satz noch erkannt wird.
**Ursache:** `keyboard.wait("v")` = Hotkey, verlangt exakt keine Modifier; Whisper lief im selben Thread wie die Tastenschleife.
**Lösung:** `keyboard.on_press_key` + Event, Whisper in Worker-Thread mit Queue.
**Vorbeugen:** Für Push-to-Talk nie Hotkey-Funktionen (`wait`, `add_hotkey`) nutzen, sondern Tasten-Events.

## F-005 – Crafting-Timeout → Inventar nicht synchron, Craft-Endlosschleife
**Status:** 🟢 gelöst (Code), im Spiel noch zu bestätigen
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/library/skills.js` → `craftRecipe()` / mineflayer `bot.craft` · MC 26.1.2, mineflayer 4.39.0
**Fehlermeldung:**
    Code execution triggered catch: Error: Error: Event updateSlot:0 did not fire within timeout of 20000ms
    You do not have the resources to craft a stick. It requires: oak_planks: 2.
    Error: missing ingredient   (2. Variante, Log 2026-11-06)
**Nachstellen:** sporadisch beim Craften (hier Sticks im 2x2-Feld, während parallel Nachrichten/Events kamen).
**Ursache:** mineflayer 4.39 `lib/plugins/craft.js` → `grabResult()` setzt das Crafting-Ergebnis nur lokal (`window.updateSlot(0, item)`) und gleicht nur beim Werktisch-Fenster per `bot._syncWindow()` mit dem Server ab. Beim 2x2-Craften im Spielerinventar gibt es keinen Abgleich → lokales Inventar weicht ab (z. B. Sticks gezählt, die es nicht gibt, oder Reste in Craftingfeld-Slots 1–4, die `findInventoryItem` nicht sieht) → `Error: missing ingredient` bzw. `Event updateSlot:0 did not fire within timeout`.
**Versuche:**
1. Rezeptdaten 1.21.11 vs 26.1.2 verglichen → ✅ identisch, nicht die Ursache.
2. Test-Bot craftet Planken+Sticks → ✅ klappt, Fehler nicht reproduzierbar.
3. Workaround: Neustart (`cleanKill`) bei Timeout → 🟡 hilft, aber `missing ingredient` war nicht abgedeckt (Log: „torch craft keeps failing even though my stick count says 3“).
4. mineflayer-Code gelesen, Ursache gefunden, Inventar-Resync eingebaut → ✅ (Mock/Code-Review).
**Lösung:** `skills.js` → `resyncInventory()` (Server schickt per `_syncWindow` das echte Inventar, Craftingfeld-Reste werden weggeräumt) nach **jedem** Craft; bei Craft-Fehler Resync + ein Neuversuch. `actions.js` → `!craftRecipe` startet nur noch neu (`cleanKill`), wenn auch das scheitert.
**Vorbeugen:** Im Log nach `resyncing inventory and retrying once` bzw. `Inventory resync failed` suchen. Tritt der Neustart (`Inventory out of sync after crafting, reconnecting`) trotzdem auf → Resync klappt auf diesem Server nicht, dann hier weiter untersuchen.

## F-006 – Miku überschreibt ihr Gedächtnis im Streit mit einer Rollenspiel-Antwort
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/models/claude_cli.js` → `sendRequest()` / `mindcraft/src/agent/history.js` → `summarizeMemories()` · Haiku
**Fehlermeldung:**
    Memory updated to:  Still no real sorry, Steve, so I'm staying in this hole and not talking about memory stuff with you.
    Memory updated to:  Not doing memory stuff, Steve. Go apologize first.
**Nachstellen:** Langer Streit mit Miku im laufenden CLI-Prozess; sobald `turns.length >= max_messages` (25) erreicht wird, ruft Mindcraft `promptMemSaving` (`sendRequest([], prompt)`) auf.
**Ursache:** `ClaudeCLI.sendRequest()` hängte an jede Anfrage `"Write ONLY your next reply as the assistant."` an und schickte sie in denselben CLI-Dauerprozess, in dem zuvor 10 Runden lang gestritten wurde. Bei leerem `<conversation>` hielt Haiku die Speicher-Anweisung für einen Trick des Spielers und antwortete in-character – wodurch `memory.json` komplett überschrieben wurde.
**Lösung:** 1. In `claude_cli.js` werden Aufrufe mit `turns.length === 0` explizit als `SYSTEM META-TASK — DO NOT ROLEPLAY` ohne Assistant-Reply-Aufforderung formatiert. 2. In `miku.json` speichert `saving_memory` keine Groll-/Streit-Notizen mehr. 3. In `history.js` verwirft `summarizeMemories()` Antworten, die leer sind oder Verweigerungs-Muster (`not doing memory`, `apologize first`) enthalten.
**Vorbeugen:** Meta-Aufgaben (Zusammenfassungen, Klassifikationen) nie mit Rollenspiel-Suffix an denselben Konversations-Kontext hängen.

## F-007 – `start-miku.bat` startet falsches Python (`ModuleNotFoundError: No module named 'keyboard'`)
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `start-miku.bat` · Windows 11
**Fehlermeldung:**
    Traceback (most recent call last):
      File "<PROJEKT>\voice\ptt.py", line 8, in <module>
        import keyboard, numpy as np, requests, socketio, sounddevice as sd
    ModuleNotFoundError: No module named 'keyboard'
**Nachstellen:** `python voice\ptt.py` in normaler `cmd.exe` aufrufen.
**Ursache:** In `PATH` steht `C:\ProgramData\miniconda3\python.exe` vor `Python310`. Alle Pakete (`keyboard`, `faster-whisper`, CUDA-DLLs) sind aber in Python 3.10 installiert.
**Lösung:** `start-miku.bat` und Anleitung nutzen jetzt explizit `py -3.10 voice\ptt.py`.
**Vorbeugen:** Auf Systemen mit mehreren Python-Installationen immer den `py -3.10`-Launcher angeben.


## F-008 – `Gemini.embed()` gibt Objekt-Array statt Zahlen-Vektor zurück (`cosineSimilarity` = `NaN`)
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/models/gemini.js` → `embed()` · `@google/genai`
**Fehlermeldung:** keine direkte Fehlermeldung – `cosineSimilarity(a, b)` in `math.js` rechnet `a[i] * b[i]` auf `[{ values: [...] }]` und liefert `NaN`, wodurch die Beispiel- und Skill-Sortierung komplett unbrauchbar wird.
**Ursache:** Im neuen `@google/genai`-SDK liefert `embedContent()` das Feld `result.embeddings` als Array von Objekten `[{ values: [0.01, ...] }]` statt als flaches Zahlen-Array.
**Lösung:** `gemini.js` → `embed()` gibt jetzt `result.embeddings?.[0]?.values` zurück, prüft auf echtes Zahlen-Array und speichert berechnete Embeddings zusätzlich im lokalen Cache `mindcraft/bots/gemini_embeddings_cache.json` (spart ~65 API-Aufrufe bei jedem Neustart und verhindert 429 Rate-Limits im Google AI Studio Free-Tier).
**Vorbeugen:** Rückgabewerte von `embed()` immer auf `Array.isArray(vec) && typeof vec[0] === 'number'` prüfen.


## F-009 – `OpenRouter.sendRequest()` schneidet Antworten/JS-Code beim ersten `*` ab (`stop_seq='*'`)
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/models/openrouter.js` → `sendRequest()`
**Fehlermeldung:** keine – Antwort bricht mitten im Satz oder mitten im `!newAction`-Codeblock ab, sobald ein `*` (Multiplikation `2 * 3`, Kommentar `/*` oder `*seufz*`) vorkommt.
**Ursache:** In Mindcrafts `openrouter.js` stand als Standardparameter `stop_seq='*'` (ein einzelner Stern statt `'***'` wie in `deepseek.js`).
**Lösung:** `stop_seq='***'` gesetzt und `params`-Weitergabe im Konstruktor ergänzt.
**Vorbeugen:** Nie einzelne Sonderzeichen (`*`), die in Code oder Markdown vorkommen, als `stop`-Sequenz an LLM-APIs übergeben.


## F-010 – 3D-Vision-Kamera (`Camera` / `Gemini.sendVisionRequest`) scheitert an MC 26.1.2 & `gemini-2.5-flash` 404
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/vision/camera.js` & `mindcraft/src/models/gemini.js` & `mindcraft/settings.js`
**Fehlermeldung:**
    1. ReferenceError: window is not defined (in prismarine-viewer viewer.setVersion('26.1.2'))
    2. ApiError 404: This model models/gemini-2.5-flash is no longer available to new users.
**Ursache:**
1. `settings.js` hatte `"allow_vision": false`.
2. `prismarine-viewer` kennt nur Texturen/BlockStates bis `1.21.4`; bei `bot.version === '26.1.2'` gibt `getVersion()` `null` zurück und ruft `window.alert()` auf (existiert in Node.js nicht).
3. Für neue Google-AI-Studio-Keys ist `gemini-2.5-flash` abgeschaltet (404), und `Gemini.sendVisionRequest()` übergab `systemInstruction` auf Top-Level statt in `config`.
**Lösung:**
1. `mindcraft/settings.js`: `"allow_vision": true` aktiviert.
2. `mindcraft/src/agent/vision/camera.js`: `this.viewer.setVersion(this.bot.version)` fällt automatisch auf `'1.21.4'` zurück (Chunk-JSON von 26.1.2 ist kompatibel).
3. `mindcraft/src/models/gemini.js` & `mindcraft/profiles/miku.json`: `sendVisionRequest()` repariert und `"vision_model": "google/gemini-3.1-flash-lite"` gesetzt (~1,1 s Antwortzeit für Bilder).
**Vorbeugen:** Bei neuen Minecraft-Versionen in `prismarine-viewer` immer einen Fallback auf die höchste unterstützte Viewer-Version (`1.21.4`) vorsehen.

## F-024 – `MaxListenersExceededWarning` beim Stoppen von `!collectBlocks`
**Status:** 🟢 gelöst (Code), im Spiel noch zu bestätigen
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/library/skills.js` → `collectBlock()` / `agent.js` → `requestInterrupt()` · Windows 11 · mineflayer-collectblock
**Fehlermeldung:**
    (node:46460) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 error listeners added to [EventEmitter]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit
    (node:46460) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 collectBlock_finished listeners added to [EventEmitter]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit
**Nachstellen:** 1. `!collectBlocks("acacia_log", 4)` an schwer erreichbaren Bäumen. 2. Während der Pfadsuche neuen Befehl geben (Log zeigt viele `waiting for code to finish executing...`).
**Ursache:** `ActionManager.stop()` ruft alle 300 ms `agent.requestInterrupt()` → `bot.collectBlock.cancelTask()`. Solange `collect()` noch läuft (Pfadsuche bis 5 s), hängt jeder Aufruf `events.once(bot, 'collectBlock_finished')` an = je 1 `collectBlock_finished`- + 1 `error`-Listener. Nach ~11 Durchläufen Warnung.
**Versuche:** 1. `collect()` in `skills.js` mit `interruptible()` umhüllt → ✅ Aktion endet ≤100 ms nach Interrupt, Stop-Schleife läuft nur noch 1–2 Mal.
**Lösung:** `skills.js` → `interruptible()` + `collectBlock()` bricht bei `bot.interrupt_code` sofort ab.
**Vorbeugen:** Lange laufende Bibliotheks-Promises in Skills immer mit `interruptible()` umhüllen.

## F-025 – `!collectBlocks` scheitert/hängt an unerreichbaren Blöcken („Took to long to decide path to goal!“)
**Status:** 🟢 gelöst (Code), im Spiel noch zu bestätigen
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/library/skills.js` → `collectBlock()` · mineflayer-pathfinder `goto.js` (thinkTimeout 5000 ms)
**Fehlermeldung:**
    Failed to collect acacia_log: Timeout: Took to long to decide path to goal!.
    PathStopped: Path was stopped before it could be completed! Thus, the desired goal was not reached.
**Nachstellen:** Bäume hinter Wasser/Klippen sammeln lassen.
**Ursache:** Nach einem Fehler machte die Schleife `continue`, suchte aber wieder den **nächsten** Block = denselben unerreichbaren → jeder Versuch verbrauchte einen von `num` Durchläufen, ohne etwas zu sammeln. Außerdem verschluckt mineflayer-collectblock `PathStopped` → wurde fälschlich als „gesammelt“ gezählt.
**Versuche:** 1. Ausschlussliste + Erfolgsprüfung (`bot.blockAt(pos).name !== block.name`) → ✅ Mock-Test.
**Lösung:** Fehlgeschlagene Positionen ausschließen, nächster Block wird versucht, max. 5 Fehlschläge, nur echte Erfolge zählen. thinkTimeout bleibt beim Standard 5 s (ein unerreichbarer Block kostet so max. 5 s).
**Vorbeugen:** Bei „Gave up on X after 5 unreachable blocks“ steht Miku ungünstig → woanders hinschicken.

## F-026 – `!searchForEntity` bricht ab: `Param 'search_range' must be an element of [32, 512)`
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/commands/actions.js` → `!searchForEntity` / `!searchForBlock`
**Fehlermeldung:**
    Agent executed: !searchForEntity and got: Error: Param 'search_range' must be an element of [32, 512).
**Nachstellen:** Modell schickt z. B. `!searchForEntity("cow", 16)`.
**Ursache:** Strenge `domain` wird in `commands/index.js` vor `perform` geprüft → Fehler statt Korrektur.
**Lösung:** Domain auf `[0, Infinity]`, `clampRange()` begrenzt auf 32–512 und meldet die Anpassung.
**Vorbeugen:** Bei Zahlen-Parametern, die das Modell oft falsch schätzt, lieber clampen statt `domain` streng setzen.



## F-011 – Mode-Aktionen enden mit „!!Code threw exception!!“ (PathStopped)
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/modes.js` → `execute()` · Windows 11 · MC 26.1.2
**Fehlermeldung:**
    Code execution triggered catch: PathStopped: Path was stopped before it could be completed! Thus, the desired goal was not reached.
        at error (...\node_modules\mineflayer-pathfinder\lib\goto.js:2:15)
        at EventEmitter.pathStopped (...\node_modules\mineflayer-pathfinder\lib\goto.js:39:15)
        at stop (...\node_modules\mineflayer-pathfinder\index.js:409:9)
        at resetPath (...\index.js:144:29)   bzw.   at EventEmitter.monitorMovement (...\index.js:603:9)
    … (gekürzt)
    Mode self_preservation finished executing, code_return: !!Code threw exception!!
    Mode item_collecting finished executing, code_return: !!Code threw exception!!
**Nachstellen:** 1. Bot läuft per Mode weg (self_preservation/item_collecting). 2. Spieler gibt Befehl (craften, schlagen)
oder Pfad wird zurückgesetzt. 3. `pathfinder.stop()` → `goto()` wirft PathStopped.
**Ursache:** Mode-Aktionen fingen Pathfinder-Fehler nicht ab; Fehler landete im catch von `action_manager`, der
zusätzlich `cancelResume()` aufruft (kann das Resume der neuen Aktion löschen).
**Versuche:**
1. try/catch um die Mode-Funktion in `execute()` → ✅
**Lösung:** `modes.js` → `execute()`: Fehler abfangen, bei echtem Fehler (kein Interrupt) ins Behavior-Log.
**Vorbeugen:** Jede Pathfinder-Bewegung kann bei Interrupt werfen – in Reflex-/Hintergrundcode immer abfangen.

## F-012 – `unstuck` killt Bot-Prozess 10 s nach unterbrochenem Befreiungsversuch
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `modes.js` → Mode `unstuck`
**Fehlermeldung:** (Code-Review, nicht im Log gesehen) `Got stuck and couldn't get unstuck` → `cleanKill`
**Nachstellen:** 1. Bot steht 20 s fest → „I'm stuck!“. 2. `moveAway` wird unterbrochen/wirft. 3. Timer läuft weiter → Prozessende.
**Ursache:** `clearTimeout(crashTimeout)` stand nach dem `await`, wurde bei Exception übersprungen.
**Lösung:** `try { await moveAway } finally { clearTimeout }`.
**Vorbeugen:** Timer immer in `finally` aufräumen.

## F-013 – `unstuck` meldet fälschlich „I'm stuck!“ nach anderen Mode-Aktionen
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `modes.js` → Mode `unstuck`
**Ursache:** `stuck_time += now - last_time`; wenn der Mode übersprungen wurde (anderer Mode aktiv, pausiert), ist
`last_time` alt → ein riesiges Delta auf einmal.
**Lösung:** Delta auf max. 2 s gedeckelt.

## F-014 – Exception in einem `mode.update()` stoppt die komplette Mode-Schleife
**Status:** 🟢 gelöst (vorbeugend, nicht im Log gesehen)
**Wann/Wo:** 2026-11-06 · `modes.js` → `ModeController.update()` / `agent.js` Update-Loop
**Ursache:** `agent.js` ruft `await this.update()` in `while(true)` ohne catch; ein Wurf beendet die Schleife dauerhaft
(z. B. `entity.metadata[16]` bei undefined metadata in `idle_staring`, `block.position` undefined in `self_preservation`).
**Lösung:** try/catch pro Mode in `ModeController.update()` + Null-Checks in `idle_staring`/`self_preservation`.
**Vorbeugen:** Fehler in der Update-Schleife erscheinen jetzt als `Mode <name> update error: …` im Log.



## F-015 – `TypeError: this.agent.respondFunc is not a function` beim Start
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/mindserver_proxy.js` → `send-message`-Handler (Zeile 69) · Windows 11 · Node 24.14
**Fehlermeldung:**
    Error:  {"stack":"TypeError: this.agent.respondFunc is not a function\n    at Socket.<anonymous> (file:///<PROJEKT>/mindcraft/src/agent/mindserver_proxy.js:69:28)\n    at Emitter.emit (…component-emitter\\lib\\cjs\\index.js:143:20)\n … (gekürzt)","message":"this.agent.respondFunc is not a function"}
**Nachstellen:** 1. `start-miku.bat` starten. 2. Push-to-Talk drücken, während im Log noch „Miku logging into minecraft...“ steht (vor „Miku spawned.“).
**Ursache:** `agent.respondFunc` wird erst in `_setupEventHandlers()` gesetzt, das nach dem `spawn` läuft. Der MindServer-Proxy nimmt aber schon vorher `send-message` (PTT/Web-UI) an. Der Fehler wurde zwar gefangen, die Nachricht ging aber verloren.
**Versuche:**
1. Nachrichten im Proxy puffern, nach Spawn nachholen → ✅
**Lösung:** `pendingMessages` (max. 5) im Proxy; `agent.js` ruft `serverProxy.flushPendingMessages()` direkt nach dem Registrieren von `respondFunc`. Zusätzlich `restart-agent` abgesichert, falls noch kein Agent/Bot da ist.
**Vorbeugen:** Socket-Handler nie direkt auf Agent-Felder zugreifen lassen, die erst nach dem Spawn existieren – immer `typeof … === 'function'` prüfen bzw. puffern.

## F-016 – Abgebrochener Satz wird nach Barge-In trotzdem (überlappend) gesprochen
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/speak.js` → `processQueue()` / `stopSpeaking()` · Windows 11
**Fehlermeldung:** keine – man hört zwei Stimmen gleichzeitig bzw. einen alten Satz nach dem Reinreden.
**Nachstellen:** 1. Miku antwortet, Fish-Audio lädt noch (erste ~0,7 s). 2. Spieler redet rein (`stopSpeaking()`). 3. Neue Antwort kommt.
**Ursache:** `stopSpeaking()` setzte `isSpeaking = false`, aber die alte `processQueue()`-Runde wartete noch auf `await item.ready` (Download). Danach spielte sie den alten Satz ab, und `speak()` hatte inzwischen eine zweite Runde gestartet → zwei ffplay parallel. Der Download des verworfenen Satzes blieb offen.
**Versuche:**
1. Generationszähler: `stopSpeaking()` erhöht `generation`, alte Schleife bricht nach jedem `await` ab, wenn die Generation nicht mehr stimmt; verworfene Items rufen `stream.cancel()` → ✅ (Test mit gemocktem `fetch`)
**Lösung:** `processQueue()` neu als Schleife pro Generation, `discard()`, `runPlayer()`, `playItem()`.
**Vorbeugen:** Bei async-Warteschlangen mit „Abbrechen“ immer nach jedem `await` prüfen, ob man noch gültig ist (Generation/Token), statt nur ein Boolean zurückzusetzen.

## F-017 – System-TTS: Anführungszeichen im Text zerbrechen den PowerShell-Befehl
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/speak.js` → `processQueue()` (Zweig `model === 'system'`) · Windows
**Fehlermeldung:** (theoretisch) `TTS error` / PowerShell-Syntaxfehler; nur relevant, wenn `speak_model` leer/`system` ist.
**Nachstellen:** `speak_model` auf `system` stellen, Miku sagt etwas mit `"` im Text.
**Ursache:** Text wurde per `exec` in `powershell -Command "…$s.Speak('TEXT')…"` eingesetzt; nur `'` wurde escaped, `"` beendete den Befehl (Injection-Gefahr durch LLM-Text). Außerdem wurde der Prozess bei Barge-In nicht gestoppt.
**Versuche:**
1. `spawn` + Text über Umgebungsvariable `MIKU_TTS_TEXT` → ✅
**Lösung:** `playItem()` startet PowerShell mit `$s.Speak($env:MIKU_TTS_TEXT)`; macOS/Linux `say`/`espeak` mit Text als Argument; alle Player laufen über `runPlayer()` → `stopSpeaking()` stoppt sie.
**Vorbeugen:** Nie fremden/LLM-Text in Shell-Befehlsstrings einbauen – Argumente oder Umgebungsvariablen nutzen.

## F-018 – life.js: mögliche Abstürze/Fehler in Timern (Geschenk, Intervalle, unbehandelte Promises)
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/life.js` · Windows 11
**Fehlermeldung:** keine beobachtet (Code-Review).
**Nachstellen:** Verbindung bricht ab, während ein Geschenk-/Schlag-Timer läuft; oder `handleMessage` wirft in einem Event.
**Ursache:** `world.getInventoryCounts()` im Geschenk-Timer ohne try/catch (Ausnahme im Timer = `uncaughtException`); `agent.handleMessage(...)` / `runAction(...)` ohne `.catch`; Intervalle liefen nach `end` weiter; 10-s-Intervall überschrieb die Inventar-Vergleichsbasis während der Geschenk-Auswertung (Geschenk wurde nicht erkannt).
**Versuche:**
1. `every()`/`later()` mit try/catch + `ended`-Flag, `.catch` an alle Promises, Snapshot-Sperre während `giftTimer` → ✅ (`node --check`)
**Lösung:** siehe LOG-Eintrag 2026-11-06 „respondFunc-Absturz, überlappende Sprache, life.js gehärtet“.
**Vorbeugen:** Neue life-Reaktionen immer über `every()`/`later()`/`event()` einbauen, nie rohes `setInterval` + `handleMessage` ohne `.catch`.



## F-019 – Antippen von V wird nie als „zu kurz“ erkannt
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `voice/ptt.py` → `main()` · Windows 11
**Fehlermeldung:**
    ● Aufnahme 0.4s, Pegel 1%
    ⚠️  Kaum Ton vom Mikro 'Mikrofon (Voicemod Virtual Audi' – richtiges Mikro?
**Nachstellen:** V kurz antippen (z. B. im Chat tippen).
**Ursache:** Dauer wurde erst NACH dem 0,3-s-Nachlauf gemessen → jede Aufnahme ≥ 0,3 s, Grenze 0,15 s nie erreicht. Folge: falsche Mikro-Warnungen oder Whisper bekam fast leere Aufnahmen (Halluzinationsgefahr).
**Lösung:** Haltedauer `held` vor dem Nachlauf messen, Grenze `MIN_HOLD_S = 0.25`.
**Vorbeugen:** Zeiten immer direkt am Ereignis messen, nicht nach Wartezeiten.

## F-020 – Race Condition Audio-Thread ↔ Tasten-Schleife (`deque mutated during iteration`)
**Status:** 🟢 gelöst (vorbeugend, nicht im Log gesehen)
**Wann/Wo:** 2026-11-06 · `voice/ptt.py` → `main()` / `on_audio()`
**Fehlermeldung (möglich):**
    RuntimeError: deque mutated during iteration
**Nachstellen:** selten; V genau dann drücken, wenn der Audio-Callback einen Block in den Vorlauf-Puffer schreibt.
**Ursache:** `chunks.extend(pre)` im Haupt-Thread, gleichzeitig `pre.append()` im PortAudio-Thread; außerdem konnte ein Block zwischen `extend` und `recording.set()` verloren gehen. Absturz hätte die ganze Tasten-Schleife beendet.
**Lösung:** Gemeinsames `threading.Lock` um Umschalten + Anhängen; Aufnahme wird unter Lock kopiert.
**Vorbeugen:** Daten, die Callback-Threads schreiben, nur unter Lock lesen/umschalten.

## F-021 – Mikro abgesteckt / Standardgerät gewechselt → PTT tot ohne Meldung
**Status:** 🟢 gelöst (Nutzer-Test offen)
**Wann/Wo:** 2026-11-06 · `voice/ptt.py` → `main()`
**Fehlermeldung:** keine – Audio-Callback kommt einfach nicht mehr, Aufnahmen leer bzw. `ValueError: need at least one array to concatenate` / `max() arg is an empty sequence`.
**Nachstellen:** PTT läuft, USB-Headset abziehen (oder Voicemod beenden).
**Ursache:** Stream wurde nur einmal geöffnet; PortAudio liest die Geräteliste nur beim Start.
**Lösung:** Watchdog (> 2 s kein Audio oder `stream.active == False`) → Stream schließen, `sd._terminate(); sd._initialize()`, alle 3 s neu öffnen. Leere Aufnahme wird abgefangen.
**Vorbeugen:** Bei „⚠️ Mikro liefert nichts mehr“ in der Konsole: Gerät prüfen; PTT muss nicht neu gestartet werden.

## F-022 – PTT stürzt ab, wenn Mindcraft noch nicht läuft; Sätze gehen verloren, wenn Miku nicht im Spiel ist
**Status:** 🟢 gelöst (Nutzer-Test offen)
**Wann/Wo:** 2026-11-06 · `voice/ptt.py` → `main()` · python-socketio 5.x
**Fehlermeldung:**
    socketio.exceptions.ConnectionError: Cannot connect to host localhost:8080
**Nachstellen:** `py -3.10 voice/ptt.py` starten, bevor Mindcraft läuft. Bzw. sprechen, während Miku neu joint → MindServer loggt `Agent Miku not in game, cannot send message via MindServer.` und wirft den Satz weg.
**Ursache:** `reconnection=True` greift nur nach einem erfolgreichen ersten `connect()`. Und der Client prüfte nur `sio.connected`, nicht ob der Agent im Spiel ist.
**Lösung:** Klasse `Bot`: erster Verbindungsversuch in Schleife (Hintergrund-Thread), Status über MindServer-Event `agents-status` (`in_game`), Warteschlange für bis zu 60 s alte Sätze, wird beim Wieder-Eintritt nachgereicht. Sende-Fehler werden abgefangen (vorher konnte ein Fehler den Whisper-Thread beenden → danach wurde nie wieder etwas erkannt).
**Vorbeugen:** Bei „⏸ Miku ist gerade nicht da“ einfach warten – Satz kommt nach.

## F-023 – Whisper-Halluzinationen („Untertitel im Auftrag des ZDF“, „Vielen Dank.“)
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `voice/ptt.py` → `transcribe()` / `clean_transcript()`
**Fehlermeldung:** keine – Bot bekommt erfundene Sätze bei Stille/Rauschen.
**Ursache:** Whisper wurde mit YouTube-Untertiteln trainiert und gibt bei leisen Aufnahmen deren Abspann aus.
**Lösung:** `is_hallucination()`: starke Muster (Untertitel, ZDF/SWR/ARD, Amara, „fürs Zuschauen“, „thanks for watching“, URLs, ©) immer verwerfen; schwache („Vielen Dank.“, „Danke.“, „Thank you.“, „you“) nur als einziges Segment mit `no_speech_prob > 0.3`.
**Vorbeugen:** Neue Halluzinationen → in `HALLU_STRONG`/`HALLU_WEAK` ergänzen und in `selftest()` ein Assert dazuschreiben.

## F-029 – Mit `!rememberHere` gespeicherte Orte sind nach Neustart weg
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/memory_bank.js` / `history.js` → `save()`/`load()`
**Fehlermeldung:** keine – nach Neustart: `No location named "home" saved.` / `!savedPlaces` leer.
**Nachstellen:** 1. `!rememberHere("home")` 2. Bot neu starten 3. `!goToRememberedPlace("home")`.
**Ursache:** `MemoryBank` wurde in Mindcraft nirgends gespeichert oder geladen (`getJson()`/`loadJson()` ungenutzt).
**Lösung:** `history.save()` schreibt `places`, `history.load()` ruft `memory_bank.loadJson()` (MemoryBank wird in `agent.js` vor `history.load()` erzeugt).
**Vorbeugen:** Neue Agent-Zustände immer in `history.save()/load()` aufnehmen.

## F-030 – Gedächtnis-Zusammenfassung blockiert Mikus Antwort bis zu ~1 Minute
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/history.js` → `add()` · deepseek-v4.1-flash über OpenRouter
**Fehlermeldung:** keine – Konsole zeigt `Storing memories...`, danach kommt Mikus Antwort erst nach dem LLM-Aufruf (gemessen 56 s).
**Ursache:** `add()` hat `await this.summarizeMemories(chunk)` aufgerufen; `agent.js` `await`-et `add()` vor dem Antworten.
**Lösung:** Zusammenfassung + `appendFullHistory()` laufen als Hintergrund-Kette `this._memQueue`.
**Vorbeugen:** Langsame Meta-LLM-Aufrufe nie im Antwort-Pfad `await`-en.



## F-027 – Code-Modus ohne Embedding-Modell bekommt keine relevanten Skill-Docs
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `mindcraft/src/agent/library/skill_library.js` → `getRelevantSkillDocs()`
**Fehlermeldung:** keine – im Log steht nur `Selected skill docs: [ 'skills.placeBlock', 'skills.wait', 'skills.breakBlockAt' ]`, egal was die Aufgabe ist.
**Nachstellen:** 1. `GEMINI_API_KEY` leer lassen oder Embedding-Fehler beim Start. 2. `!newAction("sammle holz")`.
**Ursache:** Der Wort-Overlap-Zweig und `select_num === -1` iterierten über `Object.keys(this.skill_docs_embeddings)` – das Objekt ist ohne Embeddings leer.
**Lösung:** Iteration über `this.skill_docs`; Wort-Overlap auf Name+Beschreibung; zusätzlich Stichwort-Score.
**Vorbeugen:** Fallback-Pfade immer mit abgeschaltetem Embedding-Modell testen (`t_skills.mjs` ohne `embed`).

## F-028 – Statische Code-Prüfung meldete bei jedem Code „Do not use require/import“ (nur im Test, nie ausgeliefert)
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-06 · `coder.js` → `_lintCode()`
**Fehlermeldung:**
    #### CODE ERROR INFO ###
    Do not use require/import. Only bot, skills, world, Vec3 and log are available.
**Ursache:** `_lintCode()` prüft `src_lint_copy` = `bots/lintTemplate.js` mit eigenen `import`-Zeilen.
**Lösung:** `codeNoComments.replace(/^import .*$/gm, '')` vor `findStaticProblems()` (Template-Zeilen stehen in Spalte 0, generierter Code ist eingerückt).
**Vorbeugen:** Prüfungen auf Code immer gegen den Template-umhüllten Text testen.

## F-031 – Farming-Befehle gelten für `isAction()` nicht als Aktion
**Status:** 🟢 gelöst (Koordinator, 2026-11-06)
**Wann/Wo:** 2026-11-06 · `src/agent/commands/index.js` → `isAction()` · Windows 11
**Fehlermeldung:** keine – stilles Fehlverhalten
**Nachstellen:** 1. `!goal` aktiv, Nutzer ruft `!farm` auf. 2. `agent.js:367` → `self_prompter.handleUserPromptedCmd(…, isAction('!farm'))` bekommt `false`.
**Ursache:** `isAction()` sucht nur in `actionsList`, nicht in `farmingActions`/`buildingActions`/`companionActions`.
**Lösung:** umgesetzt in `commands/index.js` → `isAction()` (gilt jetzt auch für Bau- und Begleiter-Befehle): `return actionsList.concat(farmingActions, buildingActions, companionActions).some(a => a.name === name);`
**Vorbeugen:** Neue Befehls-Arrays überall dort ergänzen, wo `actionsList` direkt benutzt wird.

## F-032 – (Platzhalter) Ingame-Probleme beim ersten Test von !farm / !smeltAll / !breedAnimals
**Status:** 🔴 offen bis Ingame-Test
**Worauf achten:** Pflanzen per `activateBlock(farmland, Vec3(0,1,0))` – falls Samen nicht gesetzt werden, Abstand/Blickrichtung prüfen; `bot.activateEntity` beim Füttern – falls Tiere nicht in Love-Mode gehen, Futter in Hand prüfen (`skills.equip` vor dem Klick); `smeltAll` – Fuel-Slot mit fremdem Brennstoff wird vorher geleert.



## F-033 – Cheat-Modus: `placeBlock` setzt bei JEDEM Block zusätzlich `[half=upper]` und `[part=head]`
**Status:** 🟢 gelöst (Koordinator, 2026-11-06)
**Wann/Wo:** 2026-11-06 · `src/agent/library/skills.js` → `placeBlock()` Zeile ~741–746 · gefunden im Mock-Test
**Fehlermeldung:** keine – im Mock kamen pro Block **3** `/setblock`-Befehle (Brücke: 40 Blöcke → 120 Chat-Befehle).
**Nachstellen:** Cheat-Modus an, beliebigen Nicht-Tür-Block mit `skills.placeBlock` setzen → Chat zeigt zusätzlich `/setblock x y+1 z <block>[half=upper]` und `/setblock x y z-1 <block>[part=head]`.
**Ursache:** `if (blockType.includes('door'))` / `if (...'bed')` ohne `{}` – nur das `if (useDelay)` hängt am if, das `bot.chat(...)` läuft **immer**. Auf dem echten Server meist nur Fehler-Spam (ungültige Property, z. B. `cobblestone[half=upper]`), bei Blöcken mit passender Property aber falscher Nachbarblock. Im Mock (der States ignoriert) überschrieb es Nachbarzellen.
**Lösung:** umgesetzt in `skills.js` → `placeBlock()`: geschweifte Klammern um beide if-Blöcke:
    if (blockType.includes('door')) { if (useDelay) {...} bot.chat(...'[half=upper]'); }
    if (blockType.includes('bed'))  { if (useDelay) {...} bot.chat(...'[part=head]'); }
**Vorbeugen:** Keine einzeiligen if ohne Klammern.

## F-034 – (Platzhalter) Bau bleibt hängen / Blöcke ohne Halt
**Status:** 🟡 Workaround eingebaut
**Wann/Wo:** `library/building.js` → `buildTemplate()`
**Ursache (erwartet):** Block schwebt (z. B. Brückengeländer über Lücke, Dachmitte), Pathfinder kommt nicht hin.
**Lösung:** Bauordnung (Halt zuerst) + zweiter Durchgang; Rest wird gemeldet. Ingame noch prüfen.

## F-035 – (Platzhalter) `!makeStorage` macht zwei Einzelkisten statt Doppelkiste
**Status:** 🔴 offen/ungetestet
**Ursache (vermutet):** Kisten-Ausrichtung kommt von der Blickrichtung des Bots beim Setzen; zwei Kisten verbinden sich nur bei gleicher Ausrichtung und seitlich nebeneinander.
**Lösung:** Ingame testen; ggf. vor dem Setzen beider Kisten von derselben Stelle aus setzen (Bot-Position festhalten).



## F-036 – Creeper-Zischen wird evtl. nicht erkannt
**Status:** 🔴 offen (Verdacht, ungetestet)
**Wann/Wo:** 2026-11-06 · `library/companion.js` → `isCreeperFusing()` · MC 26.1.2
**Ursache (Vermutung):** Metadaten-Index 16/18 aus 1.21; kann in 26.1.2 verschoben sein. Fallback: Abstand < 3,5 löst trotzdem Ausweichen aus.
**Lösung:** im Spiel `bot.entities[id].metadata` eines zischenden Creepers loggen, Index anpassen.

## F-037 – Schlafender Spieler wird evtl. nicht erkannt
**Status:** 🔴 offen (Verdacht, ungetestet)
**Wann/Wo:** `modes.js` → `night_routine` (`player.metadata[6] === 2`, Pose SLEEPING)
**Lösung:** Metadaten des schlafenden Spielers loggen, Index/Wert anpassen.

## F-038 – Bogen trifft nicht
**Status:** 🔴 offen (ungetestet)
**Wann/Wo:** `library/companion.js` → `shootBow()` – Zielhöhe grob geschätzt (`+ Abstand*0,04`), kein Vorhalten bei Bewegung.
**Lösung:** Faktor anpassen oder Plugin `mineflayer-hawkeye` (nicht installiert) nutzen.

## F-039 – Schild blockt nicht
**Status:** 🔴 offen (ungetestet)
**Wann/Wo:** `library/companion.js` → `smartCombat()` – `bot.activateItem(true)` (Nebenhand) während `bot.pvp.attack` läuft.

## F-040 – Sneak bleibt nach dem „Sitzen“ hängen
**Status:** 🔴 offen (Verdacht, live unbestätigt)
**Wann/Wo:** 2026-11-06 · `modes.js` → `idle_fidget`, `stopSitting()`
**Nachstellen:** 1. 45 s still neben Miku stehen 2. ihr einen Befehl geben → läuft sie langsam/geduckt?
**Ursache:** Vermutung: Aktion startet und endet zwischen zwei Mode-Ticks oder `agent.js` `idle`-Handler-`clearControlStates()` überschneidet sich.
**Vorbeugen:** `stopSitting()` läuft bei jedem nicht-idle Tick; im Mock geprüft.

## F-041 – Freund-Leben aus `metadata[9]` evtl. falsch auf MC 26.1.2
**Status:** 🔴 offen (Verdacht)
**Wann/Wo:** 2026-11-06 · `life.js` → Welt-Reaktionen (`friend.health ?? friend.metadata?.[9]`)
**Nachstellen:** Freund mit voller Gesundheit → kommt trotzdem „du bist fast tot“?
**Ursache:** Metadaten-Index für LivingEntity-Health kann sich je Version verschieben; manche Server schicken Spieler-Health nicht an andere.
**Vorbeugen:** Falls falsch: Index in `life.js` anpassen oder `FRIEND_LOW_HP = 0` (aus).

## F-042 – Bummel-Ziel unerreichbar (Wasser/Klippe)
**Status:** 🔴 offen (Verdacht)
**Wann/Wo:** 2026-11-06 · `modes.js` → `idle_fidget` (`skills.goToPosition`, Range 1)
**Nachstellen:** Freund steht am Wasser/Abgrund, Miku frei → läuft sie in Wasser oder hängt?
**Ursache:** Zufallsziel auf Freund-Höhe; Pfadfinder bricht ab oder findet Umweg. Fehler werden in `execute` abgefangen (PathStopped/NoPath), daher kein Absturz.
**Vorbeugen:** Falls nervig: `WANDER_CHANCE = 0`.

## F-043 – Blick-Glättung ruckelt / kämpft mit anderen lookAt
**Status:** 🔴 offen (Verdacht)
**Wann/Wo:** 2026-11-06 · `modes.js` → `smoothLook()`; `life.js` Shift-Gruß benutzt noch direktes `lookAt`
**Nachstellen:** Miku im Leerlauf beobachten – Kopf zittert zwischen zwei Zielen?
**Vorbeugen:** `LOOK_SMOOTH` erhöhen (1 = altes Verhalten).

## Wünsche an die parallele Session (speak.js / agent.js / miku.json) – NICHT von mir geändert
- Optional in `agent.js`: wenn Miku einem Befehl zustimmt (z. B. vor Ausführung eines `!`-Befehls aus Spielernachricht), `this.emote?.('nod')` aufrufen; bei Ablehnung `this.emote?.('shake')`. `emote` macht nichts, wenn sie beschäftigt ist.
- Optional in `miku.json` `"modes"`: `"idle_fidget": true` explizit eintragen (fehlt der Eintrag, ist er trotzdem an).
- „Kurzes menschliches Zögern vor Aktionen“ ginge nur in `agent.js`/`action_manager.js` – bewusst nicht gemacht.

## F-044 – (Platzhalter) Stimm-Tag wird wörtlich vorgelesen
**Status:** 🔴 offen (nur Verdacht)
**Wann/Wo:** 2026-11-06 · `speak.js` → `cleanForSpeech()` · Fish `s2.1-pro-free`
**Fehlermeldung:** –
**Nachstellen:** Miku antwortet mit Tag, man hört „laughing“ statt Lachen.
**Ursache:** Vermutung: Modell nutzt runde Klammern / Tag nicht in `VOICE_TAGS` (wird dann eigentlich entfernt) oder Fish-Modellwechsel.
**Versuche:** 1. API-Probe mit `[laughing]`/`[whispering]` → ✅ nicht vorgelesen (Whisper-Transkript).
**Lösung:** –
**Vorbeugen:** Konsole `full response` prüfen, welche Klammern das Modell schreibt.

## F-045 – (Platzhalter) Miku benutzt zu oft Tags / lacht ständig
**Status:** 🔴 offen (nur Verdacht)
**Wann/Wo:** 2026-11-06 · `miku.json` → `conversing` „VOICE TAGS“
**Nachstellen:** Mehrere Antworten hintereinander mit `[laughing]`.
**Ursache:** deepseek liebt Tags, wenn sie im Prompt stehen.
**Versuche:** 1. „jede 3.–4. Antwort“ → ❌ 4/5 Antworten mit `[laughing]`. 2. „3 von 4 OHNE Tag, nie zwei, kein Lachen bei Begrüßung“ → ✅ in 5 Proben ok.
**Lösung:** –
**Vorbeugen:** Falls es live nervt: Tags in `cleanForSpeech` z. B. nur jede 3. Antwort durchlassen.

## F-046 – (Platzhalter) 2. Chat-Zeile kommt nicht passend zur Stimme
**Status:** 🔴 offen (nur Verdacht)
**Wann/Wo:** 2026-11-06 · `agent.js` → `humanChat()`
**Nachstellen:** lange Antwort (>140 Zeichen) mit Stimme an.
**Ursache:** feste Schätzung 30 ms/Zeichen statt echter Audio-Länge.
**Versuche:** –
**Lösung:** –
**Vorbeugen:** Faktor anpassen.

## F-047 – Private Gedanken (`<think>`) kamen nie beim Innenleben an
**Status:** 🟢 gelöst
**Wann/Wo:** 2026-11-07 · `mindcraft/src/models/prompter.js` → `promptConvo()` · Windows 11 · OpenRouter `deepseek-v4.1-flash-1017`
**Fehlermeldung:** keine – in der Probe immer `THINK: null`
**Nachstellen:** 1. Prompt verlangt `<think>…</think>` vor der Antwort. 2. `promptConvo` → `generation.split('</think>')[1]` wirft den Gedanken weg, bevor `agent.js` → `splitThought` ihn sieht. 3. Zusätzlich schrieb DeepSeek gar kein `<think>` (Reasoning-Tag des Modells).
**Ursache:** Altes Mindcraft-Verhalten für Reasoning-Modelle + Tag-Kollision.
**Versuche:**
1. Prompt-Regel verstärkt („whenever an [EVENT] … stir a feeling“) → ❌ weiterhin kein Gedanke
2. Tag `<thought>`, Abschneiden in `promptConvo` entfernt, 3 Beispiele mit `<thought>` → ✅ Gedanken kommen
**Lösung:** `inner_life.js` → `splitThought()` versteht `<thought>` und `<think>`; `prompter.js` → Abschneiden entfernt; `miku.json` Regel + Beispiele auf `<thought>`.
**Vorbeugen:** Test „promptConvo schneidet Gedanken nicht mehr ab“ in `test/inner_life.test.mjs`.

## F-048 – Miku beschuldigt den Freund, wenn sie ihre eigenen Blöcke abbaut
**Status:** 🟢 gelöst (Abschluss-Review, 2026-11-07)
**Wann/Wo:** `mindcraft/src/agent/life.js` → `blockUpdate`-Handler · mineflayer 4.39
**Fehlermeldung:** keine – falsches Erlebnis „Steve hat einen Block abgebaut…“
**Nachstellen:** Miku setzt Werkbank/Gerüstblock, baut ihn selbst ab, Freund steht ≤ 6 Blöcke daneben (ebenso Creeper-Explosion, fallender Sand).
**Ursache:** `finishDigging()` setzt `bot.targetDigBlock = null` **vor** dem `blockUpdate` → Selbst-Abbau-Prüfung griff nie; „nächster Spieler“ wurde blind beschuldigt.
**Lösung:** `bot.dig` umhüllt (eigene Abbau-Position + Zeit), `entitySwingArm` merkt Schläge; neue Funktion `findBreaker()` beschuldigt nur Spieler ≤ 6 Blöcke, die in den letzten 1,5 s geschlagen haben, nie bei eigenem Abbau (3 s).
**Vorbeugen:** Test „Fix 1: findBreaker…“ in `test/inner_life.test.mjs`.

## F-049 – Doppelte AFK/Welt-Erlebnisse verdrängen wichtige Erinnerungen
**Status:** 🟢 gelöst
**Wann/Wo:** `life.js` → `worldReact()` · `inner_life.js` → `addExperience()`
**Ursache:** `worldReact` läuft alle 5 s erneut, solange es nicht reden darf → dasselbe Erlebnis ~300× pro 25 min, Klau/Geschenk fallen aus dem 40er-Puffer; außerdem wurden Modell-Anweisungen („Tease them…“) als Fakt gespeichert.
**Lösung:** `addExperience` ignoriert ein Erlebnis, das gleich dem letzten ist; Welt-Erlebnisse speichern nur den ersten Satz (Fakt).
**Vorbeugen:** Test „Fix 2…“.

## F-050 – Verwaistes `</think>` (ohne Anfang) würde Begründung des Modells laut sagen
**Status:** 🟢 gelöst
**Wann/Wo:** `inner_life.js` → `splitThought()` (Folge von F-047, Abschneiden in `promptConvo` entfernt)
**Ursache:** Manche Anbieter liefern `Begründung…</think> Antwort` ohne öffnendes Tag.
**Lösung:** Steht ein Schluss-Tag vor jedem Anfangs-Tag, ist alles davor Gedanke.
**Vorbeugen:** Test „Fix 3…“.

## F-051 – Fremden-Sperre wirkungslos (Join macht jeden „bekannt“, „Ste“ passt auf „Steve“)
**Status:** 🟢 gelöst
**Wann/Wo:** `inner_life.js` → `knows()`, `life.js` Join-Gruß
**Ursache:** „X ist auf den Server gekommen“ zählte als Erlebnis mit X; Teilwort-Suche.
**Lösung:** Erlebnisse bekommen `kind` (`join`/`world` zählen für `knows()` nicht); Suche nur nach ganzen Wörtern.
**Vorbeugen:** Test „Fix 4…“.
