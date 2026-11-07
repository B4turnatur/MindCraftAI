# Bedienungsanleitung

## Einmalige Einrichtung
**Wofür:** Damit Miku denken und sprechen kann.
**Voraussetzungen:** Node.js, Python 3.10, Java 25, ffmpeg/ffplay (`C:\ffmpeg\bin`), Minecraft Java.
**So geht's:**
1. In `mindcraft/keys.json` eintragen:
   - `"OPENROUTER_API_KEY"`: Key von `openrouter.ai/settings/keys` (`sk-or-v1-...`, nutzt `openrouter/deepseek/deepseek-v4.1-flash-1017` für ~$0,006/1M Input)
   - `"GEMINI_API_KEY"`: kostenloser Key aus dem Google AI Studio (`aistudio.google.com`, für echte Embeddings `google/gemini-embedding-001` + Bild-Erkennung `google/gemini-3.1-flash-lite`)
   - `"FISH_API_KEY"`: für die Stimme (Modell `s2.1-pro-free` ist kostenlos) – oder `ELEVENLABS_API_KEY`.
   *(Fallback: Falls `OPENROUTER_API_KEY` oder `GEMINI_API_KEY` noch leer sind, fällt Miku automatisch auf dein Claude-Abo `claude-cli/haiku` bzw. Wort-Matching zurück.)*
2. Stimme in `mindcraft/profiles/miku.json` → `speak_model` eintragen:
   - Fish: `"fish/s2.1-pro-free/<reference_id>"` (ID der Miku-Stimme auf fish.audio; `s2.1-pro-free` = kostenlos, Standard; bezahlt: `s2.1-pro`, `s2-pro`, `s1`)
   - ElevenLabs: `"elevenlabs/eleven_flash_v2_5/<voice_id>"` (flash = schnell, `eleven_multilingual_v2` = schöner, aber langsamer)
3. `companion.json` im Projektordner (Kopie von `companion.example.json`): `player` = dein Minecraft-Name, `profile` = Charakter-Profil, `hotkey` = Sprechtaste (Standard `v`), `mic` = Mikro-Namensteil oder `null`, `misheard_names` = so verhört sich Whisper beim Bot-Namen, `extra_words` = Namen, die Whisper kennen soll. Oben in `voice/ptt.py`: `STT` = `local` (Standard, Whisper auf der Grafikkarte, kostenlos) / `fish` / `elevenlabs`, `WHISPER_MODEL` (Standard `large-v3-turbo`; ohne Nvidia-GPU `small`). Beim ersten Start lädt Whisper das Modell (~1,6 GB) herunter.
   Voraussetzung lokal: `python -m pip install -r voice/requirements.txt` (enthält faster-whisper + CUDA-Bibliotheken).
4. `server/eula.txt` lesen (https://aka.ms/MinecraftEULA) und auf `eula=true` setzen.
5. Minecraft Launcher → Installationen → Neu → Version **26.1.2**.

## Miku starten
**So geht's:**
1. Doppelklick auf `start.bat`. Es öffnen sich 3 Fenster: Server, KI-Gehirn, Push-to-Talk. (Fehlt `server\server.jar` oder `mindcraft\keys.json`, sagt das Skript Bescheid.)
2. Minecraft 26.1.2 → Mehrspieler → Direkt verbinden → `localhost`.
3. Miku kommt in die Welt und begrüßt dich.
**Einzeln starten:**
    server\start-server.bat              # Server (Port 25565, nur lokal)
    cd mindcraft && node main.js         # Miku-Gehirn + Dashboard http://localhost:8080
    py -3.10 voice\ptt.py                # Push-to-Talk (wichtig: py -3.10 statt python, siehe F-007)
**Mit Miku reden:** Taste `v` halten (geht auch beim Sprinten/Schleichen mit Strg/Shift), sprechen, loslassen. Oder im Chat schreiben. Was Whisper verstanden hat, flüstert Miku dir sofort grau im Chat zu („Miku whispers to you: [gehört] …“); außerdem im Push-to-Talk-Fenster. Deutsch **und** Englisch: Whisper erkennt die Sprache (Auswahl in `voice/ptt.py` → `LANGS`; bei kurzen Antworten < 1,5 s bleibt die zuletzt benutzte Sprache), Miku antwortet in der Sprache, in der du zuletzt geredet hast. Es werden 0,4 s vor dem Drücken (`PRE_ROLL_S`) und 0,3 s nach dem Loslassen (`POST_ROLL_S`) mit aufgenommen. Namen für bessere Erkennung: `hotwords` in `transcribe()`.
**Beispiele:** „Miku, komm her“ → `!goToPlayer`; „sammel 10 Holz“ → `!collectBlocks("oak_log",10)`; „beschütz mich“; „crafte eine Spitzhacke“. Häuser bauen: `allow_insecure_coding: true` in `settings.js` ist **AN** (Miku schreibt eigenen Code, `!newAction`; läuft in einer Sandbox, gilt laut Mindcraft trotzdem als Risiko). Aus: auf `false` setzen.
**Typische Fehler:**
- `My brain disconnected` + `OAuth session expired` → `claude auth login` (F-002)
- `API key "X" not found` → Key fehlt in keys.json
- `TTS HTTP 401` → Fish-/ElevenLabs-Key falsch; `TTS HTTP 402` → Guthaben leer
- Push-to-Talk zeigt „GPU geht nicht … nehme CPU“ → CUDA-Pakete fehlen: `python -m pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"`
- Push-to-Talk nimmt nichts auf / „⚠️ Kaum Ton vom Mikro“ → falsches Mikro: in `companion.json` `"mic": "NVIDIA Broadcast"` (oder anderer Namensteil) setzen oder Windows-Standard ändern. Nach jeder Aufnahme zeigt das Fenster Dauer + Pegel.
- „⚠️ Miku ist gerade nicht verbunden“ → Mindcraft startet gerade neu, kurz warten und nochmal sagen
**Im Code:** `mindcraft/src/models/claude_cli.js` → `ClaudeCLI` (2 offene claude-Prozesse `WORKERS`, Neustart je Prozess alle 12 Anfragen; Selbsttest `node src/models/claude_cli.js [haiku|sonnet]` zeigt 3 Antworten mit ms); `voice/ptt.py` → `transcribe()`, `main()`; `mindcraft/src/agent/speak.js` → `fetchRemoteAudio()`, `fetchMp3()`, `playStream()` (Fish/ElevenLabs werden live in ffplay gestreamt, Ton nach ~0,7 s).

## Miku-Persönlichkeit ändern
**Wofür:** Charakter, Sprache, Länge der Antworten, KI-Modell.
**So geht's:** In `mindcraft/profiles/miku.json` → `conversing` (Text) bzw. `model` (`claude-cli/sonnet` = schlau, `claude-cli/haiku` = schneller, `claude-cli/opus` = am schlausten aber langsam; mit API-Key alternativ `claude-sonnet-5-5`). Mit Denk-Stufe als Objekt: `{"api":"claude-cli","model":"sonnet","params":{"effort":"high"}}` (low/medium/high). **Aktuell:** `claude-cli/haiku` (spart Limit). Für eine andere Figur: Datei kopieren, `name` ändern und in `companion.json` → `profile` eintragen (Schritt für Schritt: `AGENT_SETUP.md`).

## Miku-Skin (CustomSkinLoader)
**Wofür:** Damit Miku im Spiel wie Miku aussieht statt wie Steve/Alex (Server ist offline-mode → keine Skins). Nur bei dir sichtbar.
**Voraussetzungen:** Modrinth-Instanz „Fabulously Optimized (6)“ (FO 13.6.0, MC 26.1.2) mit `mods/CustomSkinLoader_Universal-15.1.jar` (von Modrinth, sha512 geprüft).
**So geht's:** Skin liegt in `%APPDATA%\ModrinthApp\profiles\Fabulously Optimized (6)\CustomSkinLoader\MikuSkins\Miku.png` (Kopie im Projekt: `skins/Miku.png`). Dateiname = Spielername des Bots. Slim/Classic wird automatisch erkannt (`model: auto`).
Damit nicht der Skin eines echten Mojang-Accounts „Miku“ geladen wird (Mojang hat sonst Vorrang, Priorität 100 vs. LocalSkin 710), liegt `CustomSkinLoader\ExtraList\MikuSkins.json` bereit: CSL setzt diese Quelle beim ersten Start **an den Anfang** der `loadlist` in `CustomSkinLoader.json` und löscht die ExtraList-Datei danach (normal!).
**Skin wechseln:** neue PNG (64×64) als `MikuSkins\Miku.png` speichern, im Spiel F3+T oder neu joinen.
**Typische Fehler:** Miku hat falschen Skin → in `CustomSkinLoader\CustomSkinLoader.json` prüfen, ob `MikuSkins` ganz oben in `loadlist` steht; Log: `CustomSkinLoader\CustomSkinLoader.log`.
**Im Code:** keine eigene Logik – Konfiguration von CustomSkinLoader (`LegacyLoader`, `Config.loadExtraList()`).

## Mikus „Leben“ (Reaktionen + von selbst reden)
**Wofür:** Miku reagiert wie ein echter Mitspieler: dreht sich beim Zuhören sofort zu dir um, bricht alte Sprachausgabe ab wenn du ihr ins Wort fällst (Barge-In), erwidert den Minecraft-Shift-Gruß (2× kurz ducken, wenn du vor ihr duckst), beschützt dich automatisch wenn Monster dich schlagen, erkennt zugeworfene Items (Geschenke), reagiert auf Schläge (kontert frech oder kämpft mit Waffe zurück), auf Tode anderer, und redet von selbst, wenn es länger still ist.
**So geht's:** läuft automatisch. Einstellen oben in `mindcraft/src/agent/life.js`:
    IDLE_MIN_MS / IDLE_MAX_MS     # Stille, bevor sie von selbst redet (Standard 4–8 min)
    MOB_REACT_COOLDOWN_MS         # Mob-Schaden-Reaktion höchstens alle 120 s
Selbstgespräche: in `mindcraft/src/agent/agent.js` → `handleMessage()` → `NARRATE_GAP_MS` (45 s) = Mindestabstand für Kommentare zu eigenen Befehls-Ergebnissen.
    HIT_WINDOW_MS                 # wie lange sie sich Schläge merkt (5 min)
Ruhe bitte: „Miku, sei still“ → `!stfu`, dann redet sie nicht von selbst, bis du sie wieder ansprichst.
**Achtung:** jede Reaktion ist eine Claude-Anfrage und zählt gegen dein Abo-Limit. Zu viel? `IDLE_MIN_MS`/`IDLE_MAX_MS` hochsetzen.
**Befehl `!punch(name, 1-3)`:** Miku läuft hin und haut 1–3 Mal (nicht bis zum Tod, dafür gibt es `!attackPlayer`).
**Persönlichkeit:** `mindcraft/profiles/miku.json` → `conversing` (dunkler Humor, Teto-Witze, kein „la la la“). Gedächtnis-Prompt `saving_memory` merkt sich auch Gefühle/Groll.
**Testen ohne zweiten Menschen:** `node <scratchpad>/tester.mjs` in `mindcraft/` – Testspieler „Tester“ haut Miku 2×.
**Im Code:** `mindcraft/src/agent/life.js` → `startLife()`; `mindcraft/src/agent/commands/actions.js` → `!punch`; Aufruf in `agent.js` → `startEvents()`.

## Miku komplett zurücksetzen (neues Gedächtnis)
**Wofür:** Wenn sie „verrückt spielt“ oder alte Erinnerungen (Groll, falsche Orte) stören.
**So geht's:** 1. Miku-Gehirn-Fenster schließen. 2. Ordner `mindcraft/bots/Miku` umbenennen (z. B. `Miku-backup-<datum>`), leeren Ordner `Miku` anlegen. 3. Neu starten (`start.bat` oder `cd mindcraft && node main.js`).
**Zurück zum alten Gedächtnis:** Backup-Ordner wieder in `Miku` umbenennen.
**Eigenes Leben:** steht sie 60 s untätig herum, sucht sie sich selbst ein Projekt (`!goal`); Einstellung `FREE_AFTER_MS` / `FREE_COOLDOWN_MS` in `mindcraft/src/agent/life.js`. Stoppen: „Miku, hör auf mit deinem Projekt“ (→ `!endGoal`) oder „sei still“.

## Alles beenden
**So geht's (Start über start.bat):** 1. Minecraft: Verbindung trennen. 2. Fenster „KI-Gehirn“ und „KI-PushToTalk“ schließen (oder Strg+C). 3. Im Fenster „Minecraft-Server“ `stop` tippen + Enter (speichert die Welt). Nicht einfach das Server-Fenster schließen.
**Gut zu wissen:** Der Server (26.x) speichert auch von selbst 60 s nachdem der letzte Spieler weg ist („Server empty for 60 seconds, pausing“).

## Miku-Befehle `!searchForBlock` / `!searchForEntity`
**Wofür:** Miku sucht den nächsten Block/das nächste Wesen eines Typs und läuft hin.
**Voraussetzungen:** Bot läuft.
**Aufruf / Optionen:**
    !searchForBlock("oak_log", 64)     # Radius 32–512, kleinere/größere Werte werden automatisch angepasst
    !searchForEntity("cow", 16)        # → "Search range 16 adjusted to 32." und sucht mit 32
**Typische Fehler:** früher `Param 'search_range' must be an element of [32, 512)` → behoben (F-026).
**Im Code:** `mindcraft/src/agent/commands/actions.js` → `clampRange()`

## Miku-Befehl `!collectBlocks`
**Wofür:** Miku sammelt N Blöcke eines Typs in der Nähe (Radius 64).
**Verhalten (neu):** Unerreichbare Blöcke werden übersprungen (nur Konsole: `Skipping unreachable …`), nach 5 Fehlschlägen: `Gave up on <typ> after 5 unreachable blocks.` Ausgabe am Ende: `Collected X <typ>.` – X zählt nur echt abgebaute Blöcke. `!stop` bricht sofort ab.
**Beispiel:**
    !collectBlocks("acacia_log", 4)
    → Collected 4 acacia_log.
**Typische Fehler:** `MaxListenersExceededWarning … collectBlock_finished` → behoben (F-024); `Took to long to decide path to goal!` → Block wird jetzt übersprungen (F-025).
**Im Code:** `mindcraft/src/agent/library/skills.js` → `collectBlock()`, `interruptible()`

## Miku-Befehl `!craftRecipe`
**Wofür:** Rezept N-mal craften.
**Verhalten (neu):** Nach jedem Craft holt Miku das echte Inventar vom Server (`resyncInventory`). Scheitert ein Craft (`missing ingredient`/Timeout), wird abgeglichen und einmal neu versucht. Erst wenn auch das scheitert: automatischer Neustart (`Inventory out of sync after crafting, reconnecting to resync.`).
**Typische Fehler:** „You do not have the resources“ / `missing ingredient` trotz vorhandener Items → F-005 (gelöst).
**Im Code:** `mindcraft/src/agent/library/skills.js` → `craftRecipe()`, `resyncInventory()`; `mindcraft/src/agent/commands/actions.js` → `!craftRecipe`


## Modes – Fehlerbehandlung (`modes.js`)
- Fehler in Mode-Aktionen erscheinen nicht mehr als `!!Code threw exception!!`, sondern im Log als
  `Mode <name> action stopped: <Fehlername>` und (wenn kein Interrupt) im Behavior-Log als `<name> failed: …`.
- Fehler in der Mode-Prüfung selbst: `Mode <name> update error: …` – Bot läuft weiter.
- **Im Code:** `mindcraft/src/agent/modes.js` → `execute()`, `ModeController.update()`.

## Sprachausgabe (`speak.js`) – Barge-In & Bereinigung
**Wofür:** Liest Mikus Antworten vor (Fish/ElevenLabs gestreamt, sonst System-Stimme) und hört sofort auf, wenn man reinredet.
**Voraussetzungen:** `ffplay` im PATH; `speak: true` in den Einstellungen; `speak_model` im Profil (z. B. `fish/s2.1-pro-free/<voice_id>`).
**So geht's:** läuft automatisch. Redet man (Chat oder Push-to-Talk), ruft `respondFunc` `stopSpeaking()` → laufender Satz und Warteschlange werden sofort verworfen, auch wenn das Audio noch lädt.
**Aufruf / Optionen:**
    speak(text, speak_model)   # Satz in die Warteschlange (max. 4 wartend, ältere fliegen raus: MAX_QUEUE)
    stopSpeaking()             # alles sofort abbrechen (Barge-In)
    cleanForSpeech(text)       # entfernt !befehle(...), Koordinaten, minecraft:-Präfix, _ , *Markdown*, Emojis
**Beispiel:**
    cleanForSpeech('Ich bin bei (79, 82, -25). !goToPlayer("Steve", 3)')
    → 'Ich bin bei.'
**Typische Fehler:** zwei Stimmen gleichzeitig → F-016 (gelöst); System-Stimme bricht bei `"` ab → F-017 (gelöst).
**Im Code:** `mindcraft/src/agent/speak.js` → `speak()`, `stopSpeaking()`, `processQueue()`, `playItem()`, `runPlayer()`, `cleanForSpeech()`

## Lebendigkeit (`life.js`) – Ergänzung
**Neu:** Begrüßung, wenn ein Spieler den Server betritt (`playerJoined`, pro Spieler max. alle 10 min = `JOIN_GREET_COOLDOWN_MS`, nicht in den ersten 15 s nach Mikus Login).
**Neu:** „Von selbst reden“ und „eigenes Projekt suchen“ sind niedrig priorisiert: sie warten, solange `agent.thinking > 0` (Miku antwortet gerade). Schlag-, Tod- und Beschützer-Events kommen sofort.
**Eigene Reaktion einbauen:** `every(ms, fn)` / `later(ms, fn)` statt `setInterval`/`setTimeout` (Fehler werden geloggt, stoppt bei Verbindungsende), `event(text, lowPriority)` statt `agent.handleMessage` direkt.
**Im Code:** `mindcraft/src/agent/life.js` → `startLife()`; `mindcraft/src/agent/agent.js` → `handleMessage()` (Zähler `thinking`)

## Test-Skript `test_agent_life.mjs`
**Wofür:** Prüft ohne Server/Bot `cleanForSpeech`, Barge-In ohne Überlappung (gemocktes `fetch`) und die Nachrichten-Queue des MindServer-Proxys.
**Voraussetzungen:** Node ≥ 18, `mindcraft/node_modules` installiert. Pfad `base` im Skript zeigt auf `mindcraft/src/agent/`.
**Aufruf:**
    cd mindcraft
    node <pfad>/test_agent_life.mjs
**Beispiel:**
    → ✅ cleanForSpeech 9 Fälle
      log: [ 'pull Satz B', 'cancel Satz A' ]
      ✅ Barge-In ohne Überlappung
      ✅ Proxy-Queue
**Hinweis:** Startet kurz `ffplay` mit 1 Byte Müll (stumm, beendet sich sofort).
**Im Code:** liegt aktuell im Scratchpad dieser Session (siehe oben); Koordinator kann es nach `mindcraft/tests/` übernehmen.



## Push-to-Talk (`voice/ptt.py`)
**Wofür:** V halten, sprechen, loslassen → der Satz geht als Chat von Steve an Miku.
**Voraussetzungen:** Python 3.10 mit `voice/requirements.txt`; Nvidia-GPU optional (sonst CPU-Modell `small`). Mindcraft muss NICHT vorher laufen.
**So geht's:**
1. `py -3.10 voice/ptt.py` (macht `start.bat` automatisch).
2. V halten (geht auch mit Strg/Shift), sprechen, loslassen.
3. Während V gehalten: **Esc** drücken → Aufnahme wird verworfen.
**Aufruf / Optionen:**
    py -3.10 voice/ptt.py              # normal starten
    py -3.10 voice/ptt.py --selftest   # nur Text-Filter testen, kein Mikro/Taste/Whisper
Einstellungen oben in der Datei: `HOTKEY`, `CANCEL_KEY`, `MIC` (Namensteil oder None), `WHISPER_MODEL`, `WHISPER_CPU_MODEL`, `MIN_HOLD_S` (Antipp-Grenze), `PENDING_MAX_AGE_S` (wie lange Sätze für eine offline Miku aufgehoben werden), `PRE_ROLL_S`/`POST_ROLL_S`.
**Konsolen-Zeilen:**
    🔌 Mit Mindcraft verbunden / Verbindung weg – verbinde neu …
    ⏳ Mindcraft noch nicht erreichbar – versuche weiter …
    ✅ Miku ist im Spiel
    ⏸  Miku ist gerade nicht da – Satz wird nachgereicht
    ⚠️  Mikro liefert nichts mehr – öffne neu …
    ● zu kurz / ● verworfen / ● Aufnahme 2.1s, Pegel 60%
**Beispiel:**
    py -3.10 voice/ptt.py --selftest
    → ✅ Selbsttest ok
**Typische Fehler:** `No module named 'keyboard'` → mit `py -3.10` starten (F-007); V reagiert nicht mit Strg/Shift (F-004); falsche Sätze bei Stille (F-023); Mikro weg (F-021).
**Im Code:** `voice/ptt.py` → `main()`, `Bot`, `worker()`, `transcribe()`, `is_hallucination()`, `load_whisper()`

## Mikus Denk-Regeln & Gesprächsbeispiele (`miku.json`)
**Wofür:** Steuert, wie schlau Miku handelt (planen, Fehler überwinden, Basis merken, vage Wünsche verstehen) – ohne Code-Änderung.
**Voraussetzungen:** keine; Änderungen wirken nach Neustart von Miku (`start.bat`).
**So geht's:**
1. Regeln ändern: in `mindcraft/profiles/miku.json` → `conversing` den Block „YOU PLAY LIKE A SMART, EXPERIENCED PLAYER“ (Punkte 1–7) anpassen; fürs Code-Schreiben `coding` → „SMART CODING RULES“ A–D.
2. Beispiele ändern/ergänzen: `conversation_examples` ist eine Liste von Gesprächen; jedes Gespräch ist eine Liste aus `{"role":"user","content":"Steve: …"}`, `{"role":"assistant","content":"… !befehl(...)"}`, `{"role":"system","content":"Action output:\n…"}`. Mindcraft sucht pro Anfrage per Google-Embedding die `num_examples` ähnlichsten Beispiele aus (verglichen werden nur User-/System-Zeilen der letzten 3 Nachrichten).
3. Nur echte Befehlsnamen mit richtigen Parametern verwenden (z. B. `!getCraftingPlan("stone_pickaxe", 1)` braucht die Anzahl), keine verschachtelten Anführungszeichen in `!goal("…")`.
4. Danach prüfen: `node -e "JSON.parse(require('fs').readFileSync('profiles/miku.json','utf8'))"` (im Ordner `mindcraft`).
**Aufruf / Optionen (`mindcraft/settings.js`):**
    "num_examples": 3          # wie viele passende Beispiele pro Anfrage in den Prompt kommen (war 2)
    "relevant_docs_count": 8   # wie viele Skill-Funktions-Dokus der Code-Modus bekommt (war 5)
    "max_messages": 25         # Gesprächsverlauf; danach wird ins Gedächtnis zusammengefasst
    "max_commands": -1         # kein Limit für Befehlsketten (nötig für !goal)
**Beispiel:** Spieler sagt „hol mal Holz“, Birken stehen in der Nähe
    → Miku: „Klar, die Birken da drüben müssen dran glauben. !collectBlocks("birch_log", 12)“
**Typische Fehler:** Miku nutzt alte englische Assistenten-Sätze → `conversation_examples` fehlt/kaputt, dann greifen die Standard-Beispiele aus `_default.json`. JSON-Fehler beim Start → JSON prüfen (Befehl oben).
**Im Code:** `mindcraft/profiles/miku.json` → `conversing`, `coding`, `saving_memory`, `conversation_examples`; Auswahl in `mindcraft/src/utils/examples.js` → `getRelevant()`; Laden in `mindcraft/src/models/prompter.js` → `initExamples()`.



## Mikus Gedächtnis (Zusammenfassung, dauerhafte Fakten, gespeicherte Orte)
**Wofür:** Miku merkt sich über Neustarts hinweg, was passiert ist, wichtige Fakten über dich (Name, Vorlieben, Versprechen, Basis) und benannte Orte.
**Voraussetzungen:** `load_memory: true` in `settings.js` (sonst wird `memory.json` beim Start nicht geladen).
**So geht's:**
1. Einfach spielen/reden. Alle 25 Nachrichten (`max_messages`) fasst Miku im Hintergrund die ältesten 5 zusammen und aktualisiert dabei die Fakten-Liste.
2. Orte merken: Miku sagen „Merk dir diesen Ort als Zuhause“ → sie nutzt `!rememberHere("home")`. Hingehen: „Geh nach Hause“ → `!goToRememberedPlace("home")`. Liste: `!savedPlaces`.
3. Alles steht in `mindcraft/bots/Miku/memory.json`:
   - `memory` – rollierende Zusammenfassung (max. 500 Zeichen)
   - `facts` – dauerhafte Fakten (Liste, max. 15) – darf man von Hand bearbeiten (Bot vorher beenden)
   - `places` – `{ "name": [x, y, z] }` – darf man von Hand ergänzen
   - `turns` – letzte Nachrichten
**Aufruf / Optionen:** keine eigenen Befehle; Miku sieht im Prompt unter „Summarized memory“ die Zusammenfassung, `Key facts: …` und `Saved places …` (max. 12 zuletzt gesetzte Orte).
**Beispiel:**
    Du: „Mein Lieblingsblock ist Kirschholz.“ … (später, nach Zusammenfassung)
    → memory.json: "facts": ["Preference: cherry wood (Steve).", …]
**Typische Fehler:** Konsole `Memory update rejected (invalid/in-character output)` → gewollt, Gedächtnis bleibt unverändert (F-006). Orte nach Neustart weg → war vor 2026-11-06 so (nie gespeichert), siehe F-029.
**Im Code:** `mindcraft/src/agent/history.js` → `summarizeMemories()`, `parseMemSaving()`, `getMemoryForPrompt()`, `save()`, `load()`; `mindcraft/src/agent/memory_bank.js`; `mindcraft/src/models/prompter.js` → `promptMemSaving()`, `_factsInstructions()`, `replaceStrings()` (`$MEMORY`).



## Code-Modus: Vorprüfung, Fehler-Feedback, Wiederholungen (`!newAction`)
**Wofür:** Miku schreibt für unbekannte Aufgaben JS-Code; der wird vor dem Ausführen geprüft und bei Fehlern mit klarer Meldung neu versucht.
**Voraussetzungen:** `allow_insecure_coding: true` in `settings.js`.
**So geht's:** automatisch. Ablauf pro Versuch (max. 5): Code ziehen → schon probiert? → Lint (unbekannte Skills mit Vorschlag, fehlendes `await`, `require/import`, Endlosschleife, ESLint) → ausführen → bei Exception: Meldung + Codezeile + Position + Inventar zurück ans Modell. Gleicher Fehler 2× → „anderer Ansatz“, 3× → Abbruch.
**Beispiel (was das Modell bei einem Fehler sieht):**
    CODE EXECUTION THREW ERROR: TypeError: Cannot read properties of null (reading 'position')
    At line 3: await skills.goToPosition(bot, block.position.x, ...);
    Position: x=12.5, y=64.0, z=-3.2
    Inventory: oak_log:4, dirt:12
    Fix the cause and try again.
**Typische Fehler:** `Missing await: skills.X(...) is async` → Modell korrigiert selbst. Fehlalarm bei bewusst parallelem Code → mit `Promise.all(...)` schreiben (dann wird die await-Prüfung übersprungen).
**Im Code:** `mindcraft/src/agent/coder.js` → `generateCode()`, `_lintCode()`, `findStaticProblems()`, `describeError()`, `closestName()`

## Gelernter Code (`bots/Miku/learned_code.json`)
**Wofür:** Code, der für eine Aufgabe geklappt hat, wird bei einer ähnlichen späteren Aufgabe als Vorlage angeboten.
**So geht's:** automatisch. Gespeichert wird nur, wenn keine Exception kam **und** der Output nicht nach Fehlschlag klingt (fail/error/could not/not enough/…). Max. 30 Einträge, Code ≤ 2000 Zeichen.
**Aufruf / Optionen:** Datei kann gelöscht werden (= vergessen) oder von Hand bearbeitet werden: `[{"task": "...", "code": "...", "time": 1794...}]`. Kaputtes JSON → Warnung im Log, Start mit leerer Liste.
**Beispiel:** Aufgabe `collect 3 oak logs` geklappt → später `please collect 3 oak logs now` → Systemnachricht „This code worked before for the similar task …“.
**Im Code:** `coder.js` → `_findLearned()`, `_rememberSuccess()`, Konstante `FAILURE_RE`

## Eigene Ziele (`!goal`): Schritte + Feststeck-Erkennung
**Wofür:** Miku arbeitet ein Ziel in kleinen Schritten ab und merkt, wenn sie festhängt.
**So geht's:** `!goal("1. … 2. …")` wie bisher. Jede Runde bekommt sie das Ziel + die letzten 3 Schritte mit (ok)/(failed). Werte in `self_prompter.js` oben:
    HINT_AFTER = 2      # Fehlschläge/Wiederholungen in Folge -> "STUCK, Strategie wechseln"
    GIVE_UP_AFTER = 5   # Fehlschläge in Folge -> Ziel stoppen + Miku sagt EINMAL Bescheid
Pause zwischen Runden: `cooldown` (2 s) × (1 + Probleme, max. 5) → max. 12 s. Ein gestopptes Ziel bleibt in `self_prompter.prompt`; neuer `!goal` startet frisch.
**Typische Fehler:** Ziel stoppt zu früh, weil Erfolgsmeldungen ein Fehlerwort enthalten → `FAILURE_RE` in `self_prompter.js` anpassen.
**Im Code:** `mindcraft/src/agent/self_prompter.js` → `judgeTurns()`, `_buildPrompt()`, `_record()`, `startLoop()`

## Skill-Doc-Auswahl für den Code-Modus
**Wofür:** Wählt die 5 (`relevant_docs_count`) passendsten Skill-Beschreibungen für den Code-Prompt (`$CODE_DOCS`).
**So geht's:** Score = Embedding-Ähnlichkeit (Google, gecacht) + 0,25 × Stichwort-Treffer im Skill-Namen; deutsche Wörter über `KEYWORDS` (Wortanfänge, längster gewinnt). Ohne Embeddings: Wort-Overlap + Stichworte.
**Aufruf / Optionen:** neue Wörter in `KEYWORDS` ergänzen, z. B. `angel: 'fish'`. Gewicht: `KEYWORD_WEIGHT`.
**Beispiel:**
    node <notes>/smart-coder-tests/t_skills.mjs embed   (aus mindcraft/)
    → OK  schmelze das Eisenerz im Ofen -> skills.smeltItem, skills.clearNearestFurnace, ...
    → embedding+keyword 9/9
**Im Code:** `mindcraft/src/agent/library/skill_library.js` → `_scoreDocs()`, `keywordScore()`, `messageTokens()`

## !farm
**Wofür:** Miku erntet reife Pflanzen, pflanzt nach, besät leeres Ackerland und legt neben Wasser ein neues Feld an.
**Voraussetzungen:** Saatgut im Inventar (wheat_seeds, carrot, potato, beetroot_seeds); für neue Felder Wasser in ≤16 Blöcken und eine Hacke (oder Material + Werkbank zum Craften).
**So geht's:** 1. Miku zum Wasser/Feld bringen. 2. Sagen „mach ein Feld“ / „farm mal“ → sie ruft `!farm("any")`.
**Aufruf / Optionen:**
    !farm("any")            # alle vorhandenen Samen benutzen
    !farm("carrot")         # nur Karotten (auch: wheat_seeds, potato, beetroot_seeds, "wheat", "beetroot")
    skills.farm(bot, seedType=null, radius=16, maxNewPlots=16)   # Code-Modus
**Beispiel:**
    !farm("wheat_seeds")
    → Harvested 4 crops, replanted 4. / Planted 2 of 2 empty farmland. / Tilled and planted 9 new plots near water. / Remembered this farm as "farm".
**Typische Fehler:** „No water nearby to start a new field.“ → zu Wasser gehen / Wassereimer ausleeren · „No hoe and cannot craft one“ → Stöcke + Bretter + Werkbank besorgen · „is not a plantable crop“ → falscher Saatname
**Im Code:** `library/farming.js` → `farm()`, `harvestCrops()`, `plantEmptyFarmland()`; `commands/farming.js` → `!farm`

## !tendFarm
**Wofür:** Zum gemerkten Feld laufen, reife Pflanzen ernten und alles nachpflanzen (kein neues Pflügen).
**Voraussetzungen:** Ort „farm“ gemerkt (passiert automatisch bei erfolgreichem `!farm`, oder `!rememberHere("farm")`).
**So geht's:** „kümmer dich ums Feld“ → `!tendFarm`.
**Aufruf / Optionen:**
    !tendFarm
    skills.tendFarm(bot, x, y, z, radius=12)   # Code-Modus
**Beispiel:**
    !tendFarm
    → Harvested 12 crops, replanted 12.
**Typische Fehler:** „No farm remembered yet.“ → erst `!farm` oder `!rememberHere("farm")` · „No fully grown crops nearby.“ → noch nicht reif
**Im Code:** `library/farming.js` → `tendFarm()`; `commands/farming.js` → `!tendFarm`

## !smeltAll
**Wofür:** Alle rohen Erze und rohes Fleisch/Fisch im Inventar in einem Durchgang schmelzen/braten.
**Voraussetzungen:** Brennstoff (Kohle, Holzkohle, Stämme, Bretter, Lavaeimer); Ofen in ≤16 Blöcken, im Inventar oder 8 Cobblestone + Werkbank.
**So geht's:** „schmelz alles“ / „brat das Fleisch“ → `!smeltAll`. Dauert ~10 s pro Item; mit `!stop` abbrechbar (Ergebnis wird trotzdem eingesammelt).
**Aufruf / Optionen:**
    !smeltAll
    skills.smeltAll(bot)   # Code-Modus
**Beispiel:**
    !smeltAll   (Inventar: 5 raw_iron, 3 beef, 2 coal)
    → Smelting up to 8 of 8 items with 1 coal. / Smelted: 5 iron_ingot, 3 cooked_beef.
**Typische Fehler:** „Nothing to smelt“ → Kartoffeln, Stämme, Sand werden absichtlich NICHT angefasst, dafür `!smeltItem` · „No fuel“ → Kohle/Holz holen · „Furnace stopped making progress“ → Brennstoff leer
**Im Code:** `library/farming.js` → `smeltAll()`, `getOrPlaceFurnace()`, `pickSmeltables()`; `commands/farming.js` → `!smeltAll`

## !breedAnimals
**Wofür:** Zwei (oder mehr) erwachsene Tiere einer Art mit dem richtigen Futter füttern, damit sie ein Baby bekommen.
**Voraussetzungen:** Passendes Futter im Inventar, mind. 2 erwachsene Tiere der Art in ≤24 Blöcken.
**So geht's:** „züchte Kühe“ → `!breedAnimals("cow", 1)`.
**Aufruf / Optionen:**
    !breedAnimals("cow", 1)    # animal_type, pairs (1–5)
    skills.breedAnimals(bot, animalType, pairs=1)   # Code-Modus
  Futter: Kuh/Schaf/Ziege/Mooshroom → wheat · Schwein → carrot/potato/beetroot · Huhn → Samen · Hase → carrot/dandelion · Pferd/Esel → golden_carrot/golden_apple · Lama → hay_block · Fuchs → sweet_berries · Katze → cod/salmon · Wolf → Fleisch (nur gezähmt) · u. a.
**Beispiel:**
    !breedAnimals("sheep", 1)
    → Fed 2 sheep with wheat: 1 pair(s) should breed now.
**Typische Fehler:** „Need wheat to breed cow“ → Futter holen · „Need 2 adult cow nearby that weren't bred in the last 5 min“ → Tiere suchen oder Cooldown abwarten · „Don't know how to breed X“ → Art nicht in Tabelle
**Im Code:** `library/farming.js` → `breedAnimals()`, `BREED_FOOD`, `isBabyEntity()`; `commands/farming.js` → `!breedAnimals`



## !buildTemplate – Bauwerk nach Vorlage
**Wofür:** Miku baut eine fertige Hütte, einen Wachturm, eine Brücke oder eine Mauer/einen Zaun vor dir.
**Voraussetzungen:** Material im Inventar oder in der Nähe (Bäume/Stein) – Miku sammelt/craftet Fehlendes selbst.
**So geht's:** 1. Hinstellen und in die Richtung schauen, wo es hin soll (bei Brücke: auf die Schlucht/das Wasser). 2. Miku sagen „bau eine Hütte aus Cobble“. 3. Sie zählt das Material, holt Fehlendes und baut von unten nach oben. Stoppen mit `!stop`.
**Aufruf / Optionen:**
    !buildTemplate("hut", "oak_planks")       # 5x5-Hütte mit Tür, Dach, Fackel – 3 Blöcke vor dir
    !buildTemplate("tower", "cobblestone")    # 3x3-Wachturm, Leiter innen, Plattform mit Zinnen oben
    !buildTemplate("bridge", "oak_planks")    # 3 breite Brücke über die nächste Lücke in Blickrichtung
    !buildTemplate("wall", "cobblestone")     # Mauerring (Radius 6, 3 hoch) um dich, Durchgang vorne
    !buildTemplate("fence", "spruce_planks")  # Zaunring aus spruce_fence um dich
  Code-Modus: `await skills.buildTemplate(bot, name, material, username, {width, depth, height, length, radius, gather})`
**Beispiel:**
    !buildTemplate("hut", "cobblestone")
    → Building hut from cobblestone at 20, 64, -3 facing north: 73 steps, needs {"cobblestone":71,"oak_door":1,"torch":1}.
    → Finished building hut from cobblestone.
**Typische Fehler:**
- `No gap found ahead (facing east)` → in Richtung der Lücke schauen.
- `Not enough cobblestone to build hut` → Material besorgen, nochmal.
- `Built hut, but N blocks could not be placed` → nochmal ausführen (schon gesetzte Blöcke werden übersprungen).
- Im Cheat-Modus Spam-Befehle `[half=upper]` → F-033.
**Im Code:** `library/building.js` → `buildTemplate()`, `getTemplateBlocks()`; `commands/building.js`

## !storeItems – Inventar in Kisten einräumen
**Wofür:** Miku räumt alles Unwichtige in Kisten in der Nähe, nach Sorte sortiert.
**Voraussetzungen:** Kisten/Fässer im Umkreis von 16 Blöcken.
**So geht's:** „räum dein Zeug ein“. Behalten werden: Werkzeuge, Waffen, Rüstung, Essen, Fackeln, Pfeile, Eimer.
Kategorien: wood, stone, ores, redstone, mobdrops, plants, misc. Jede Sorte kommt in die Kiste, die schon am meisten davon hat, sonst in eine leere, sonst in die mit dem meisten Platz.
**Aufruf:** `!storeItems` · Code: `await skills.storeItems(bot, range=16)`
**Beispiel:** `!storeItems` → `Stored 143 items in 3 chest(s).`
**Typische Fehler:** `No chests within 16 blocks` → `!makeStorage`. `All chests are full` → mehr Kisten.
**Im Code:** `library/building.js` → `storeItems()`, `itemCategory()`, `pickChestForCategory()`

## !sortChests – Kisten aufräumen
**Wofür:** Miku sortiert vorhandene Kisten um, damit jede Kiste nur eine Sorte enthält, und räumt dann ihr eigenes Zeug ein.
**So geht's:** Pro Kiste wird die Hauptsorte bestimmt; alles andere nimmt Miku raus (so viel ins Inventar passt), danach `storeItems`. Bei großem Chaos mehrmals ausführen.
**Aufruf:** `!sortChests` · Code: `await skills.sortChests(bot, range=16)`
**Typische Fehler:** `Need at least 2 chests nearby to sort` → es wird nur eingeräumt.
**Im Code:** `library/building.js` → `sortChests()`

## !fetchFromChests – Item aus Kisten holen
**Wofür:** Miku durchsucht alle Kisten in der Nähe (nächste zuerst) und holt ein Item.
**Aufruf / Optionen:**
    !fetchFromChests("iron_ingot", 10)   # genau dieses Item
    !fetchFromChests("log", 16)          # Teilname: jeder *_log
**Beispiel:** → `Fetched 10 iron_ingot from chests.` bzw. `(only 4 of 10 available)`
**Typische Fehler:** `No iron_ingot found in 3 nearby chest(s).`
**Im Code:** `library/building.js` → `fetchFromChests()`

## !makeStorage – Doppelkiste bauen
**Wofür:** Miku craftet 2 Kisten (16 Bretter, aus Stämmen falls nötig) und stellt sie an der Basis auf.
**So geht's:** Ist ein Ort `"base"` gespeichert (`!rememberHere("base")`) und weiter als 6 Blöcke weg, läuft Miku erst hin; dann nächster freier 2×2-Platz.
**Aufruf:** `!makeStorage` · Code: `await skills.makeStorage(bot, x?, y?, z?)`
**Typische Fehler:** `Need 2 chests (16 planks), have 0` → Holz besorgen. Zwei Einzelkisten statt Doppelkiste → F-035.
**Im Code:** `library/building.js` → `makeStorage()`; `commands/building.js` (Basis-Lauf)



## !fight / Skill `smartCombat` – kluger Kampf
**Wofür:** Miku kämpft gegen alle Monster in der Nähe – mit Köpfchen statt blind draufhauen.
**Voraussetzungen:** Waffe/Schild/Bogen+Pfeile im Inventar sind optional, werden aber genutzt.
**So geht's:** Im Chat sagen „Miku, kämpf gegen die Monster“ → sie ruft `!fight(12)` auf.
**Aufruf / Optionen:**
    !fight(range)                  # range 4–32 Blöcke
    await skills.smartCombat(bot, 12, center=null)   # Code-Modus; center = Mittelpunkt statt Bot
**Verhalten:** beste Waffe (Schwert/Axt/Streitkolben/Dreizack nach Schaden) in die Hand, Schild in die Nebenhand ·
Creeper: bei < 3,5 Blöcken oder zischend zurückweichen (7 Blöcke) mit Schild hoch, sonst Bogen wenn vorhanden ·
Fernkämpfer (Skelett, Pillager, Hexe, Blaze …): Bogen ab > 6 Blöcken, sonst hinlaufen mit Schild hoch ·
Leben ≤ 8: wegrennen (`avoidEnemies`) + bestes Essen, nach 2 Rückzügen gibt sie auf ·
greift **nie** Spieler, Haustiere (Wolf, Katze, Pferd …), Golems, Dorfbewohner oder neutrale Mobs (Enderman, Piglin) an ·
Monster nahe einem Spieler bekommen Vorrang.
**Beispiel:**
    !fight(12)
    → "Fight over."  (oder "No enemies nearby.")
**Typische Fehler:** Weicht Creepern nicht aus, obwohl er zischt → F-036 · Pfeile gehen drüber/drunter → F-038
**Im Code:** `library/companion.js` → `smartCombat()`, `chooseCombatAction()`, `rankThreats()`

## Modus `smart_combat`
**Wofür:** Wie `self_defense`, aber mit dem klugen Kampf oben – automatisch, sobald ein Monster < 10 Blöcke ist.
**So geht's:** `!setMode("smart_combat", true)`. Läuft vor `cowardice`/`self_defense` und ersetzt sie, wenn er greift.
Standard: **AUS** (Vorschlag unten: im Profil einschalten).
**Im Code:** `modes.js` → `modes_list`, Eintrag `smart_combat`

## !escort – Begleiten wie ein Bodyguard
**Wofür:** Miku läuft mit dir mit, hält 2–4 Blöcke Abstand, sprintet hinterher (ab 8 Blöcken), schwimmt im Wasser,
geht zur Seite, wenn sie dir beim Laufen im Weg steht. Kein Teleport.
**So geht's:** „Miku, begleite mich“ → `!escort("Spielername")`. Stoppen mit `!stop`.
**Aufruf:**
    !escort(player_name)
    await skills.escortPlayer(bot, "Steve", 2, 4)
**Verhalten:** ab 24 Blöcken Abstand werden `item_collecting`, `hunting`, `torch_placing` pausiert (schneller aufholen).
Spieler 30 s weg → Abbruch „Lost <name>“. Wird von Modi (Kampf, Items) unterbrochen und danach automatisch fortgesetzt (resume).
**Beispiel:** `!escort("Steve")` → "Escorting Steve (distance 2-4)."
**Im Code:** `library/companion.js` → `escortPlayer()`, `escortDecision()`, `isInPlayerPath()`

## !guard – Wache halten
**Wofür:** Miku bleibt an ihrer Stelle und verteidigt den Bereich (Radius 10) gegen Monster, danach zurück auf den Posten.
**So geht's:** „Miku, bewach das hier 2 Minuten“ → `!guard(120)`. `-1` = für immer, Abbruch mit `!stop`.
**Aufruf:**
    !guard(seconds)
    await skills.guardArea(bot, 120, 10)
**Beispiel:** `!guard(60)` → "Guard duty over (2 fights)."
**Im Code:** `library/companion.js` → `guardArea()`

## Modus `night_routine`
**Wofür:** Alltags-Routine: isst bei Hunger (Hunger ≤ 14), stellt nachts Fackeln an Stellen nahe dem Spieler ohne Fackel
im Umkreis 6, geht schlafen, wenn ein Bett ≤ 16 Blöcke weg ist **und** der Spieler schläft (oder kein Spieler in 32 Blöcken).
**So geht's:** `!setMode("night_routine", true)` / `false`. Standard: **AUS**. Prüft alle 2 s; Fackel max. alle 8 s,
Schlafversuch max. alle 30 s. Darf `followPlayer` und `escort` kurz unterbrechen.
**Typische Fehler:** Geht nicht schlafen, obwohl du im Bett liegst → F-037
**Im Code:** `modes.js` → `night_routine`; `library/companion.js` → `findDarkSpot()`, `placeTorchNear()`, `eatBest()`, `isNightTime()`

## Testskript companion-test.mjs
**Wofür:** Prüft die reine Logik (ohne Server) + Befehlsregistrierung + Modi-Schalter.
**Aufruf:** (Datei liegt außerhalb `mindcraft/`, Pfad zum mindcraft-Ordner als Argument)
    node companion-test.mjs <PROJEKT>/mindcraft
    → ✅ alle companion-Tests grün

## Menschliches Verhalten (Blick, Gesten, Hinsetzen, Körpersprache)
**Wofür:** Miku wirkt wie ein echter Spieler: dreht den Kopf weich, zappelt/bummelt im Leerlauf, setzt sich, wenn du AFK bist, hüpft vor Freude, schaut betroffen weg und kommentiert Wetter/Tageszeit.
**Voraussetzungen:** Modi `idle_staring` und `idle_fidget` an (Standard: an; `idle_fidget` steht nicht in `miku.json` → bleibt an).
**So geht's:** Nichts tun – passiert automatisch, sobald Miku frei ist. Testen:
1. Neben Miku stellen, nicht bewegen und nicht umschauen → nach ~45 s duckt sie sich („sitzt“), bei Bewegung steht sie auf; nach 5 min AFK zieht sie dich auf.
2. Ihr ein Item zuwerfen → 2 Freudenhüpfer + Spruch.
3. Sie einmal schlagen → schaut kurz betroffen zu Boden, dann Konter.
4. Umschauen/irgendwo hinschauen → sie schaut ab und zu mit dahin.
5. Wetter `/weather rain` oder `/time set 12500` → manchmal ein Kommentar (max. 1 Welt-Kommentar alle 4 min).
**Aufruf / Optionen:**
    !setMode idle_fidget false     # Gesten/Bummeln/Hinsetzen aus
    !setMode idle_staring false    # Umschauen aus
    agent.emote('happy'|'nod'|'hurt'|'shake')   # aus Code (z. B. agent.js) Körpersprache auslösen
Stellschrauben oben in `modes.js`: `LOOK_SMOOTH` (0.55; 1 = Kopf schnappt), `GAZE_FOLLOW_CHANCE`, `FIDGET_MIN_MS/MAX_MS` (25–70 s), `WANDER_CHANCE`, `WANDER_MAX_FRIEND_DIST`, `AFK_SIT_MS` (45 s), `AFK_SIT_DIST`.
Oben in `life.js`: `WORLD_REACT_COOLDOWN_MS` (4 min), `WORLD_REACT_CHANCE` (0.6), `FRIEND_LOW_HP` (6), `FRIEND_AFK_COMMENT_MS` (5 min), `EMOTE_COOLDOWN_MS` (4 s).
**Beispiel:**
    Spieler steht 50 s still neben Miku
    → Miku duckt sich und bleibt geduckt; Spieler läuft los → Miku steht sofort auf
**Typische Fehler:** Miku schleicht bei einer Aufgabe → sollte nicht passieren (F-040); sinnlose „du bist fast tot“-Warnung → F-041.
**Im Code:** `modes.js` → `idle_staring`, `idle_fidget`, `smoothLook()`, `stopSitting()`; `life.js` → `emote()`, `worldReact()`


## Stimm-Tags (Fish Audio S2.1)
**Wofür:** Miku kann beim Sprechen lachen, seufzen, flüstern, aufgeregt/sarkastisch klingen.
**Voraussetzungen:** `speak_model` beginnt mit `fish/` (aktuell `fish/s2.1-pro-free/<voice_id>`), `settings.speak: true`.
**So geht's:** Das LLM schreibt (selten) ein Tag in eckigen Klammern direkt vor die betroffenen Worte, z. B. `[laughing] Haha, nein!`. `speak.js` reicht erlaubte Tags an Fish weiter; im Minecraft-Chat und bei anderen TTS-Anbietern werden alle Tags entfernt.
**Erlaubte Tags** (`VOICE_TAGS` in `speak.js`): `laughing chuckling sighing groaning gasping whispering excited sarcastic annoyed surprised sad happy nervous yawning break long-break`. Neue Tags: in `VOICE_TAGS` **und** im `VOICE TAGS`-Absatz von `miku.json` ergänzen (Fish versteht frei formulierte Tags, siehe docs.fish.audio → Emotions). Syntax: S2/S2.1 = `[eckige Klammern]`; die alte S1-Syntax `(runde Klammern)` gilt nicht mehr.
**Aufruf / Optionen:**
    cleanForSpeech(text, keepTags)   # keepTags=true: erlaubte [tags] bleiben, unbekannte raus; false: alle raus
    stripVoiceTags(text)             # alle [tags] raus (für Chat)
**Beispiel:**
    cleanForSpeech('[laughing] Haha! Bei (79, 82, -25) liegt oak_log. [dances] !stop', true)
    → '[laughing] Haha! Bei liegt oak log.'
    stripVoiceTags('[laughing] Haha, du Noob.')  → 'Haha, du Noob.'
**Typische Fehler:** Tag wird vorgelesen („laughing“) → Modell hat runde statt eckige Klammern benutzt oder Fish-Modell gewechselt (F-044). Miku lacht ständig → Häufigkeitsregel im Prompt verschärfen (F-045).
**Im Code:** `mindcraft/src/agent/speak.js` → `VOICE_TAGS`, `stripVoiceTags()`, `cleanForSpeech()`, `speak()`; `mindcraft/src/agent/agent.js` → `openChat()`

## Menschliches Chat-Timing (`humanChat`)
**Wofür:** Chat-Antworten erscheinen wie getippt statt sofort, lange Antworten kommen in 2 Zeilen.
**Voraussetzungen:** keine.
**So geht's:**
- `settings.speak: false` (nur Chat): vor jeder Zeile Reaktions-/Tippzeit `min(2,5 s, 0,35 s + 25 ms × Zeichen)`.
- `settings.speak: true` (aktueller Stand): **keine** Verzögerung der ersten Zeile (Stimme soll schnell sein); die 2. Zeile einer geteilten Antwort kommt `min(2,5 s, 30 ms × Zeichen der 1. Zeile)` später, grob passend zur Stimme.
- Teilen: Antworten > 140 Zeichen mit mehreren Sätzen werden am Satzende nahe der Mitte geteilt (`splitChat`).
- Zeilen laufen in einer Kette (`this._chatChain`) → Reihenfolge bleibt; `!stfu` (`shut_up`) bricht wartende Zeilen ab.
- Befehle/Kampf werden **nie** verzögert: `routeResponse()` wird in `handleMessage()` nicht abgewartet, nur der Chat-Text wartet.
**Aufruf / Optionen:** Werte direkt in `humanChat()` (`350`, `25`, `2500`, `30`) bzw. `splitChat()` (`140`).
**Beispiel:**
    splitChat('Boah, das war knapp mit dem Creeper. Ich dachte echt, das wars. Lass uns heim, ja?')  (>140 Zeichen)
    → ['Boah, … Ich dachte echt, das wars.', 'Lass uns heim, ja?']   (Satzgrenze nahe Mitte)
**Typische Fehler:** Chat-Zeilen erscheinen nach der Stimme zu spät/zu früh → Faktor `30` anpassen (F-046).
**Im Code:** `mindcraft/src/agent/agent.js` → `openChat()`, `humanChat()`, `splitChat()`

## Mikus Innenleben (`bots/Miku/inner_life.json`)
**Wofür:** Miku hat Gefühle, eine Meinung über dich, eigene Wünsche/Projekte und Erinnerungen – alles als Text, ohne Zahlen. Sie entscheidet Konflikte selbst.
**Voraussetzungen:** nichts extra; läuft automatisch mit `start.bat`.
**So geht's:**
1. Erlebnisse (Geschenk, Schläge, Klauen, Block an ihrem Bau abgebaut, Tode, Join, Wetter) schreibt `life.js` neutral auf. „Block abgebaut“ zählt nur, wenn ein Spieler ≤ 6 Blöcke daneben in den letzten 1,5 s zugeschlagen hat (nicht bei ihrem eigenen Abbau, Explosionen oder Sand).
2. In Antworten darf sie einen privaten Gedanken `<thought>…</thought>` voranstellen – wird nie gesagt/gechattet, nur gespeichert (letzte 8, im Prompt die letzten 3).
3. Alle 25 min (nur wenn etwas passiert ist) und kurz nach dem Start (wenn noch Unverarbeitetes da ist) reflektiert sie: schreibt `self`, `about_friend`, `wants`, `project`, neue `milestones` neu, alte Erlebnisse werden zusammengefasst.
4. Steht sie rum, arbeitet sie am eigenen Projekt (`!goal`).
5. Konflikte: kein Zwang mehr – sie kann lachen, kontern, schmollen, verzeihen, `!punch`, `!attackPlayer`, bei „verdient“ auch töten. **Sperre:** Spieler, über die sie nichts erlebt hat, greift sie nicht an.
**Aufruf / Optionen:**
    Datei ansehen:       mindcraft/bots/Miku/inner_life.json
    Innenleben neu:      Datei löschen (Bot vorher beenden) → Startsatz „Ich bin neu hier…“
    Takt ändern:         src/agent/inner_life.js → REFLECT_INTERVAL_MS (Standard 25 min)
    Tests:               cd mindcraft && node --test test/inner_life.test.mjs
**Beispiel:** Du hebst ihren fallen gelassenen Diamanten auf → Erlebnis „Steve hat mein diamond genommen … NICHT gegeben“ → Antwort z. B. `<thought>Drittes Mal heute.</thought> Ey, lass meine Diamanten liegen! !punch("Steve", 2)` → du hörst nur „Ey, lass meine Diamanten liegen!“.
**Typische Fehler:** kaputte Datei → wird zu `inner_life.broken-<zeit>.json` umbenannt, Innenleben startet neu; Gedanken kommen nicht an → F-047; `You don't know X - you never attack strangers…` → gewollt (Fremden-Sperre).
**Im Code:** `src/agent/inner_life.js`, `src/agent/life.js` (`createDropTracker`, `createPlacedTracker`), `src/agent/agent.js` (`splitThought` nach `promptConvo`), `src/agent/commands/actions.js` (`mayAttackPlayer`), Prompts `reflecting`/`conversing` in `profiles/miku.json`.
