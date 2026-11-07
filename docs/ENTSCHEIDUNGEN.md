# Entscheidungen

## 2026-11-06 – Architektur: Mindcraft-Bot (Option A)
**Gewählt:** Körper = Mineflayer-Bot über Mindcraft (MIT, `mindcraft-bots/mindcraft`), Gehirn = Claude, Stimme = Fish Audio / ElevenLabs, Eingabe = Push-to-Talk-Skript (Python) → MindServer-socket.io `send-message`.
– weil Mindcraft schon Pathfinding, Abbau, Craften, Kampf, Bauen, Gedächtnis und Selbst-Ziele mitbringt.
**Alternativen:** Fabric-NPC mit eigenem Modell (schöner, aber KI-Steuerung selbst bauen); Hybrid mit Simple Voice Chat für 3D-Stimme (Ausbaustufe 2).

## 2026-11-06 – Minecraft-Version 26.1.2
**Gewählt:** 26.1.2, weil es die neueste Version ist, die mineflayer 4.39 kann (Protokoll 775).
**Alternativen:** 26.3 über ViaProxy (Mindcraft hat `services/viaproxy`), evtl. später; Risiko falscher Block-Zuordnungen.

## 2026-11-06 – Eigener lokaler Server statt „Im LAN öffnen“
**Gewählt:** offizieller Dedicated Server mit `online-mode=false`, nur 127.0.0.1, weil der Bot ohne Microsoft-Konto joinen muss und der Port fest bleibt.
**Achtung:** nicht ins Internet freigeben (offline-mode = jeder kann sich als jeder einloggen).

## 2026-11-06 – STT lokal mit faster-whisper (GPU)
**Gewählt:** faster-whisper `large-v3-turbo` float16 auf der RTX 5070 Ti – kostenlos, kein Key, ~0,2 s pro Satz, versteht Deutsch sehr gut. CPU-Fallback `small`.
**VERWORFEN:** Fish-ASR / ElevenLabs Scribe als Standard – kosten Geld (bleiben per `STT = "fish"/"elevenlabs"` wählbar).

## 2026-11-06 – Claude-Abo über CLI statt API-Key
**Gewählt:** eigener Mindcraft-Provider `claude-cli` (`src/models/claude_cli.js`) mit **Dauer-Prozess** (`claude -p` im stream-json-Modus, keine Tools/Settings/Hooks/MCP, leerer Arbeitsordner, Neustart alle 12 Anfragen mit Vorwärmen) – weil der Nutzer keinen API-Key will und der Neustart pro Antwort Zeit kostet.
**VERWORFEN:** ein `claude -p`-Aufruf pro Antwort – ~1–3 s Startzeit jedes Mal.
**Nachteile:** Verlauf wächst im Prozess (darum Neustart), Verbrauch zählt gegen die Abo-Limits, keine Bilder/Embeddings (Fallback Wort-Überlappung). Nur für private Nutzung gedacht.
**Alternativen:** API-Key (`"model": "claude-sonnet-5-5"`, schneller) – vom Nutzer abgelehnt.

## 2026-11-06 – Proximity Chat (GEPLANT, aufgeschoben bis Basis getestet ist)
**Stand jetzt:** Mikus Stimme kommt per `ffplay` aus den PC-Lautsprechern (nicht positionsabhängig), Eingabe über `voice/ptt.py`.
**Plan:** 1. Server auf Fabric umstellen + Simple Voice Chat (Server + Client beim Nutzer). 2. Eigener kleiner Fabric-Server-Mod: nimmt Mikus TTS-Audio (z. B. über lokalen HTTP/Socket von Mindcraft) und spielt es per SVC-API als `EntityAudioChannel` an Mikus Position ab (3D, leiser mit Entfernung). 3. Optional: Spieler-Mikro serverseitig über SVC abgreifen → STT → Miku; dann entfällt `ptt.py`.
**Geprüft 2026-11-06 (Modrinth):** Simple Voice Chat `fabric-2.6.27+26.1.2` (2026-10-28) und Fabric API `0.155.3+26.1.2` existieren für 26.1.2.

## 2026-11-06 – Fish Audio kostenlos: Modell s2.1-pro-free
**Gewählt:** `speak_model` = `fish/s2.1-pro-free/<voice_id>` – laut Fish-Blog (Juni 2026) kostenlos mit „unlimited usage“ unter Fair-Use; nur Header `model` anders. Bezahlt wäre `s2.1-pro`.
**Gelöst:** Spracherkennung läuft lokal (faster-whisper), also alles kostenlos.

## 2026-11-06 – Persönlichkeit & Lebendigkeit
**Gewählt:** Prompt-basiert (miku.json) + kleines Event-Modul `life.js`, das Ereignisse als `[EVENT]`-Nachricht an Mikus normalen Gesprächsweg gibt – keine eigene Stimmungs-Datenbank; Stimmung lebt im Gesprächsverlauf + Gedächtnis-Zusammenfassung.
**VERWORFEN:** `narrate_behavior` (Mindcraft-Standardsätze „Hunting cow!“) – klingt nach Roboter, englisch → aus. „la la la“-Anweisung – vom Nutzer abgelehnt.
**Alternativen:** feste Stimmungswerte (z. B. Wut 0–10) im Code – erst wenn der Prompt allein nicht reicht.


## 2026-11-06 – OpenRouter (`deepseek-v4.1-flash-1017`) + Google AI Studio (`gemini-embedding-001` & `gemini-3.1-flash-lite`)
**Gewählt:** `"model": "openrouter/deepseek/deepseek-v4.1-flash-1017"`, `"embedding": "google/gemini-embedding-001"`, `"vision_model": "google/gemini-3.1-flash-lite"` in `profiles/miku.json` (`allow_vision: true` in `settings.js`) – weil DeepSeek V4.1 Flash über OpenRouter extrem günstig bei uncached System-Prompts ist (~$0,006/1M Input, ~100 tok/s) und tollen Charakter/Bau-Code liefert, während Google AI Studio kostenlos echte Vektor-Embeddings (mit lokalem Disk-Cache) und schnelle 3D-Screenshot-Erkennung (~1,1 s) liefert.
**Fallback:** Solange `OPENROUTER_API_KEY` oder `GEMINI_API_KEY` in `mindcraft/keys.json` leer sind, fällt `prompter.js` automatisch auf `claude-cli/haiku` bzw. das verbesserte DE/EN-Wort-Matching zurück.

## 2026-11-06 – Inventar-Abgleich statt Neustart bei Craft-Desync (F-005)
**Gewählt:** `bot._syncWindow(bot.inventory)` nach jedem Craft + ein Neuversuch – weil das die eigentliche Lücke in mineflayer schließt (2x2-Crafting wird nie abgeglichen) und kein Neuverbinden braucht.
**Alternativen:** Nur Neustart (`cleanKill`) – bleibt als letzte Rettung, kostet aber ~10 s und Gesprächskontext. mineflayer in `node_modules` patchen – wird bei `npm install` überschrieben.
**VERWORFEN:** `thinkTimeout` global hochsetzen gegen Pfad-Timeouts – macht unerreichbare Blöcke nur langsamer; stattdessen überspringen.

## 2026-11-06 – Vorzeitige Sprach-Nachrichten puffern statt verwerfen
**Gewählt:** Puffer (max. 5) im MindServer-Proxy, Zustellung direkt nach Registrierung von `respondFunc` – weil PTT beim Start sonst kommentarlos verloren geht.
**Alternativen:** Nachricht ignorieren (einfacher, aber Spieler wundert sich); `respondFunc` schon vor dem Spawn setzen (geht nicht – braucht `bot`).

## 2026-11-06 – Niedrig priorisierte life-Events warten auf laufende Antwort
**Gewählt:** Zähler `agent.thinking` (Wrapper um `handleMessage`); „von selbst reden“/„eigenes Projekt“ überspringen, solange > 0 – weil sonst zwei LLM-Runden parallel laufen und Miku doppelt redet.
**Alternativen:** globale Sperre für alle Events (würde Schlag-/Tod-Reaktionen verzögern → nein).



## 2026-11-06 – Halluzinationen per Muster filtern statt nur per Schwellwert
**Gewählt:** Muster-Liste (stark/schwach) + `no_speech_prob` – weil echte kurze Sätze („Danke“) sonst mitgefiltert würden.
**Alternativen:** `no_speech_threshold`/`log_prob_threshold` strenger → schneidet auch echte leise Sätze ab.
**VERWORFEN:** „Vielen Dank“ immer verwerfen – Nutzer sagt das auch wirklich zu Miku.

## 2026-11-06 – Sätze für offline Miku puffern (60 s)
**Gewählt:** Warteschlange in `ptt.py`, gesteuert über `agents-status` vom MindServer – keine Änderung an Mindcraft-JS nötig.
**Alternativen:** Puffern im MindServer (`mindserver.js`) – andere Session-Zuständigkeit, nicht angefasst.

## 2026-11-06 – Eigene Miku-Gesprächsbeispiele statt Mindcraft-Standardbeispiele
**Gewählt:** 20 eigene `conversation_examples` in `miku.json` (Miku-Ton, DE/EN, nur existierende Befehle, zeigen Planen/Fehler-Erholung/Basis-Merken) – weil die Standard-Beispiele englischer Assistenten-Ton sind und teils nicht existierende Befehle (`!collectBlock`, `!craftItem`) vormachen, die das Modell nachahmt.
**Alternativen:** Standard-Beispiele behalten und nur ergänzen (geht nicht: ein Profilfeld ersetzt das Default-Feld komplett, man müsste alle 29 kopieren und die kaputten reparieren). `coding_examples` wurden NICHT ersetzt – die Standard-Codebeispiele sind korrekt.
**Gewählt:** `num_examples` 3 (statt 2) und `relevant_docs_count` 8 (statt 5) – mehr passende Vorbilder bzw. Funktions-Dokus kosten bei deepseek-flash nur ~300–600 Tokens, Latenz unverändert ~1–1,5 s.
**VERWORFEN:** `max_messages` erhöhen – längerer Verlauf macht jede Anfrage teurer und verschiebt nur das Zusammenfassen; Orte/Projekte überleben jetzt über die verbesserte `saving_memory`-Regel + `!rememberHere`. `max_commands` begrenzen – würde `!goal`-Ketten abwürgen.



## 2026-11-06 – Dauerhafte Fakten als eigene Liste im selben Zusammenfassungs-Aufruf
**Gewählt:** Ein LLM-Aufruf liefert `FACTS:` + `SUMMARY:`; Fakten in `memory.json` → `facts`, Orte → `places`. Format-Anweisung wird in `prompter.js` angehängt – weil kein zusätzlicher API-Aufruf, keine neue Datei, abwärtskompatibel (altes Klartext-Format = nur Zusammenfassung).
**Alternativen:** Zweiter LLM-Aufruf nur für Fakten (doppelte Kosten/Latenz); Embedding-Suche über alte Histories (viel Code, mehr Latenz); eigene `facts.json` (mehr Dateien, ohne Nutzen).
**VERWORFEN:** Fakten in die 500-Zeichen-Zusammenfassung pressen – genau das verliert sie beim Komprimieren.

## 2026-11-06 – Gedächtnis-Zusammenfassung läuft im Hintergrund
**Gewählt:** `history.add()` startet die Zusammenfassung über eine Promise-Kette (`_memQueue`) statt sie zu `await`-en – weil ein Aufruf ~56 s dauern kann und so Mikus Antwort blockierte.
**Alternativen:** schnelleres Modell nur für Zusammenfassungen (wäre Profil-Änderung, nicht meine Datei – evtl. später).



## 2026-11-06 – Gelernten Code per Wort-Overlap statt Embeddings finden
**Gewählt:** `wordOverlapScore` (≥ 0,5) aus `text.js` – weil ≤ 30 Einträge, keine API-Kosten/Latenz, DE→EN-Map schon drin.
**Alternativen:** Embeddings (genauer bei Umschreibungen, aber extra Aufruf + Cache-Pflege) – erst wenn Treffer zu oft danebenliegen.
**VERWORFEN:** gelernten Code automatisch ohne LLM ausführen – zu riskant (andere Umgebung, andere Koordinaten); er wird nur als Vorlage angeboten und läuft durch die normale Prüfung.

## 2026-11-06 – Feststecken bei `!goal`: Hinweis → Stopp statt endlos weiter
**Gewählt:** 2 Fehlschläge → Strategie-Hinweis, 5 → Ziel stoppen und Miku sagt es einmal selbst (eigene Sprache, über `handleMessage`, ohne Befehl). Wartezeit wächst bei Problemen.
**VERWORFEN:** feste englische Systemmeldung per `openChat` – wird vorgelesen und klingt nach Spam. Ziel komplett löschen – Ziel bleibt gespeichert.

## 2026-11-06 – Skill-Auswahl: Embedding + Stichwort-Bonus
**Gewählt:** Cosinus + 0,25 × Anteil getroffener Skill-Namensteile (inkl. DE-Tabelle). Behebt nebenbei F-027.
**Alternativen:** reine Embeddings (schwankt bei kurzen deutschen Befehlen), Übersetzen der Anfrage per LLM (teurer, langsamer).

## 2026-11-06 – Farming-Fähigkeiten als eigene Skills + Befehle
**Gewählt:** Neue Funktionen in `library/farming.js`, die vorhandene Helfer (`tillAndSow`, `goToPosition`, `craftRecipe`, `placeBlock`, `collectBlock`, `pickupNearbyItems`, `getNearestBlocksWhere`) wiederverwenden – weil weniger Code und gleiches Verhalten wie bestehende Befehle.
**Gewählt:** Reife über Block-State `age` (max 7 bzw. 3 für Rüben) statt „alles abbauen“ – sonst zerstört Miku unreife Felder.
**Gewählt:** `smeltAll` öffnet den Ofen **einmal** und schmilzt alles nacheinander statt `smeltItem` pro Item aufzurufen – spart Hin-/Herlaufen, Brennstoff wird für die Gesamtmenge berechnet.
**Gewählt:** `smeltAll` lässt Kartoffeln, Stämme, Sand, Cobblestone aus – Kartoffeln sind Saatgut, der Rest Baumaterial; dafür bleibt `!smeltItem`.
**Gewählt:** Gefütterte Tiere merkt sich ein In-Memory-Map 5 min (Vanilla-Cooldown) – Server gibt den Liebes-Cooldown nicht zuverlässig per Metadaten raus. Geht beim Neustart verloren, unkritisch.
**Gewählt:** Feld-Ort im memory_bank als `"farm"` (gleicher Speicher wie `!rememberHere`) statt eigener Datei – Miku kennt den Ort damit auch über `!savedPlaces` / `!goToRememberedPlace("farm")`.
**Alternativen:** Mehrere Öfen parallel befüllen (schneller, aber deutlich mehr Code) – erst wenn große Mengen üblich werden.



## 2026-11-06 – Bauvorlagen als Code statt Schematic-Dateien
**Gewählt:** Parametrische Vorlagen in `getTemplateBlocks()` (lokale Koordinaten + Drehung nach Blickrichtung) – weil klein, ohne neue Abhängigkeit, und Größen per `opts` änderbar.
**Alternativen:** `.schem`/NBT-Dateien mit prismarine-schematic (mehr Bauwerke möglich, aber neue Abhängigkeit + Dateiverwaltung); LLM baut per `!newAction` (unzuverlässig, teuer).
**VERWORFEN:** –

## 2026-11-06 – Bauen über vorhandenes `skills.placeBlock` statt eigener Platzier-Logik
**Gewählt:** `placeBlock`/`breakBlockAt` wiederverwenden (räumt Hindernisse, Cheat-/Creative-Modus, Pathfinder-Gerüst) + eigene Bauordnung und zweiter Durchgang für Blöcke ohne Halt.
**Alternativen:** eigene Gerüst-Logik (mehr Code, doppelt).

## 2026-11-06 – Lager-Kategorien per Namensmuster
**Gewählt:** Regex auf Item-Namen (`itemCategory`), Essen über `bot.registry.foodsByName`. Einfach, deckt Vanilla gut ab; Unbekanntes → `misc`.
**Alternativen:** minecraft-data-Tags/Kreativ-Tabs (nicht in minecraft-data enthalten).



## 2026-11-06 – Companion-Kampf als eigener Modus statt self_defense umbauen
**Gewählt:** neuer Modus `smart_combat` vor `cowardice`, Standard AUS – weil `self_defense` unverändert als Fallback bleibt und
man per `!setMode` zurückschalten kann.
**Alternativen:** `skills.defendSelf` umschreiben (fremde Datei, andere Sessions/Code-Modus verlassen sich drauf).
**VERWORFEN:** `equipHighestAttack` aus `skills.js` exportieren – Datei war gesperrt; eigene `equipCombatGear` (kann zusätzlich Schild).

## 2026-11-06 – Licht-Erkennung für Fackeln über Fackel-Abstand
**Gewählt:** „dunkel“ = keine Fackel im Umkreis 6 (wie `world.shouldPlaceTorch`) – weil `block.light` laut Code-Kommentar kaputt ist.
**Alternativen:** echte Lichtwerte – erst wenn mineflayer sie für 26.1.2 zuverlässig liefert.

## 2026-11-06 – Escort ohne Teleport, eigener Befehl statt followPlayer ändern
**Gewählt:** `!escort` mit Abstand 2–4, Sprint, Schwimmen, Ausweichen; `!followPlayer` bleibt unverändert.
**VERWORFEN:** Teleport-Aufholen (`/tp`) – Auftrag sagt „teleport-free“, und ohne Cheat-Modus geht es eh nicht.

## 2026-11-06 – Menschliches Verhalten: Reflexe ohne LLM, Sprechen nur über life.js-Bremsen
**Gewählt:** Bewegung/Blick/Gesten als Modi bzw. Timer **ohne LLM** (sofort, kostenlos); nur Kommentare (Wetter, Tageszeit, Freund fast tot, AFK) gehen als `[EVENT]` über `event(…, true)` mit gemeinsamer 4-min-Bremse und 60-%-Zufall – damit sie nicht nach Skript klingen und das Gespräch nicht zuspammen.
**Gewählt:** Weicher Blick per eigener Glättung (`bot.look` in Teilschritten pro 300-ms-Tick) – mineflayer selbst dreht instant.
**Gewählt:** „Sitzen“ = Sneak halten (Minecraft hat kein Sitzen für Spieler); Aufstehen zentral in `ModeController.update()`, sobald eine Aktion läuft.
**Alternativen:** Zögern vor jeder Aktion (menschlicher, aber in `action_manager.js`/`agent.js`, nicht diese Session; Risiko, Befehle spürbar zu verlangsamen). Höhlen-/Diamant-Kommentare (bräuchten Events während Aufgaben → würden laufende Aktionen stören).
**VERWORFEN:** Welt-Ereignisse nachholen, wenn gebremst – ein Regen-Kommentar 4 min später wirkt falsch; Ereignis verfällt stattdessen. `shake`-Emote wird nicht automatisch genutzt (nur über `agent.emote`).


## 2026-11-06 – Menschlichere Sprache: Prompt + Fish-Stimm-Tags + Chat-Timing
**Gewählt:** Persönlichkeit nur über den `SPEECH`-Absatz + Beispiele (keine Code-Logik für Stil); feste kleine Tag-Liste (`VOICE_TAGS`) statt freier Tags – weil frei formulierte Tags vom LLM schnell zu Regieanweisungen („[dances wildly]“) werden und so Ton/Länge unberechenbar würden. Tags nur an Fish, sonst entfernt. Tipp-Verzögerung nur ohne Stimme.
**Alternativen:** freie Fish-Tags (mächtiger, aber unkontrolliert); `[break]` automatisch für „…“ einsetzen (Fish macht bei „...“ schon selbst eine Pause → unnötig); Verzögerung auch mit Stimme (würde die mühsam auf ~0,7 s gedrückte Latenz wieder kaputt machen).
**VERWORFEN:** S1-Syntax `(laughing)` in runden Klammern – gilt laut Fish-Doku nur für das veraltete S1, S2/S2.1 nutzt `[eckige Klammern]`. Häufigkeit „jede 3.–4. Antwort“ als Prompt-Regel – Modell hat trotzdem fast immer `[laughing]` benutzt; jetzt „3 von 4 Antworten OHNE Tag, nie zwei, kein Lachen bei Begrüßungen“.

## 2026-11-07 – Innenleben: Erlebnisse → Gedanken → Reflexion (ohne Zahlen)
**Gewählt:** Generative-Agents-Muster: Code notiert neutrale Erlebnisse, Miku denkt per `<think>…</think>` in normalen Antworten (0 Extra-Aufrufe), Reflexion alle ~25 min schreibt Selbstbild/Meinung/Wünsche/Projekt in Worten. Konflikt: kein Zwang mehr zum Zurückschlagen; sie entscheidet selbst, darf bei „verdient“ auch töten; harte Sicherung nur gegen grundlose Angriffe auf Fremde. Nur online (kein Offline-Weiterspielen). Spec: `docs/superpowers/specs/2026-11-07-innenleben-design.md`.
**Alternativen:** B) nur Reflexion ohne Gedanken (billiger, reagiert aber träge); Offline-Weiterspielen (Strom/Kosten/Risiko) bzw. Mischmodus.
**VERWORFEN:** Stimmungs-/Wut-/Nähe-Zahlen mit Schwellenwerten (z. B. „ab Wut 60 darf sie kämpfen“) – vom Nutzer als zu robotisch abgelehnt; auch versteckte Zahlen im Hintergrund verworfen. Schimpfwortliste zur Beleidigungs-Erkennung – unnötig, das Modell liest den Satz ohnehin.
