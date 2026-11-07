# Minecraft KI-Begleiter 🎮🗣️

Ein KI-Charakter, der mit dir **Minecraft Java** spielt – wie ein echter Freund im Voice-Chat.
Du redest per **Push-to-Talk** (Taste `V` halten) oder Chat mit ihm, er antwortet mit **eigener Stimme**
und handelt selbstständig im Spiel: laufen, abbauen, craften, kämpfen, farmen, Hütten und Brücken bauen, Kisten sortieren …

Mitgeliefert ist **Miku** als Beispiel-Charakter. Du kannst aber **jeden Wunsch-Charakter** einbauen
(Name, Persönlichkeit, Stimme) – das dauert mit einem KI-Agenten ca. 10 Minuten.

> 🤖 **Am einfachsten:** Öffne den Ordner in deinem KI-Agenten (Claude Code, Codex, Cursor …) und schreib:
> **„Lies AGENT_SETUP.md und richte das Projekt für mich ein.“**
> Der Agent prüft die Voraussetzungen, installiert alles, fragt dich nach deinem Wunsch-Charakter und baut das Profil.

---

## Was der Begleiter kann

- **Reden & Zuhören:** Push-to-Talk mit lokaler Spracherkennung (Whisper, Deutsch + Englisch), Antwort per TTS-Stimme
  (Fish Audio oder ElevenLabs, gestreamt, Ton nach ~0,7 s). Man kann ihm ins Wort fallen.
- **Selbstständig spielen:** Holz/Steine sammeln, craften, schmelzen, Farmen anlegen, Tiere züchten,
  Häuser/Brücken/Türme nach Vorlage bauen, Kistenlager anlegen und sortieren, dich begleiten und beschützen.
  Kann für Spezialaufgaben eigenen JavaScript-Code schreiben.
- **Wirkt menschlich:** Blickkontakt, Gesten, erwidert den Shift-Gruß, reagiert auf Geschenke, Schläge, Wetter,
  Tageszeit, deine Gesundheit, redet von selbst, wenn es still ist.
- **Innenleben & Gedächtnis:** merkt sich Erlebnisse, Orte und Fakten über dich (auch nach Neustart),
  hat eigene Gedanken, Launen und Projekte, entscheidet selbst, wie er auf Streiche reagiert.

## Voraussetzungen

| Was | Version | Wofür |
|---|---|---|
| Windows 10/11 | – | Startskripte sind `.bat` |
| Minecraft Java Edition | **26.1.2** | das Spiel (im Launcher als Installation anlegen) |
| Node.js | 20+ (getestet 24) | das „Gehirn“ (Mindcraft) |
| Python | **3.10** (über den `py`-Launcher) | Push-to-Talk + Spracherkennung |
| Java | 25 | Minecraft-Server |
| ffmpeg (`ffplay` im PATH) | beliebig | Stimme abspielen |
| Nvidia-Grafikkarte | empfohlen | Whisper schnell auf der GPU (ohne geht's auf der CPU, langsamer) |
| Mikrofon | – | zum Reden |

### API-Keys (in `mindcraft/keys.json`)

| Key | Woher | Kosten | Wofür |
|---|---|---|---|
| `OPENROUTER_API_KEY` | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) | ein paar Cent pro Spielabend | das Sprachmodell (Standard: DeepSeek V4.1 Flash) |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) | kostenlos | Embeddings (Beispiele finden) + Bilderkennung |
| `FISH_API_KEY` | [fish.audio](https://fish.audio) → API | kostenloses Modell `s2.1-pro-free` | die Stimme |
| `ELEVENLABS_API_KEY` | [elevenlabs.io](https://elevenlabs.io) | kostenpflichtig | Alternative Stimme |

Fehlt der OpenRouter-Key, nutzt der Begleiter automatisch die **Claude Code CLI** (`claude`) mit deinem Claude-Abo.

## Einrichtung von Hand

> Kurzfassung – jeder Schritt ist in [`AGENT_SETUP.md`](AGENT_SETUP.md) ausführlich mit Prüfbefehlen beschrieben.

1. **Abhängigkeiten installieren**
   ```bash
   cd mindcraft && npm install
   ```
   ```bash
   py -3.10 -m pip install -r voice/requirements.txt
   ```
2. **Minecraft-Server:** `server.jar` für **26.1.2** von [minecraft.net/download/server](https://www.minecraft.net/en-us/download/server)
   laden und als `server/server.jar` speichern. Die [Minecraft-EULA](https://aka.ms/MinecraftEULA) lesen und
   die Datei `server/eula.txt` mit dem Inhalt `eula=true` anlegen.
3. **Keys:** `mindcraft/keys.example.json` nach `mindcraft/keys.json` kopieren und Keys eintragen.
4. **Dein Name & Charakter:** `companion.example.json` nach `companion.json` kopieren, `player` = dein Minecraft-Name.
5. **Starten:** Doppelklick auf `start.bat` → Minecraft 26.1.2 → Mehrspieler → Direkt verbinden → `localhost`.
6. **Reden:** `V` halten, sprechen, loslassen. Oder in den Chat schreiben.

## Eigenen Charakter einbauen

Ein Charakter = eine Profil-Datei in `mindcraft/profiles/`. Kurz:

1. `mindcraft/profiles/miku.json` kopieren, z. B. nach `mindcraft/profiles/luna.json`.
2. `"name"` ändern – **das ist der Minecraft-Name des Bots** (3–16 Zeichen, nur `A-Z a-z 0-9 _`).
3. In `"conversing"` die Absätze über die Persönlichkeit umschreiben (erster Satz, `PERSONALITY:`, `LORE …`).
   Die Spielregeln danach bleiben einfach stehen – die machen ihn schlau.
4. `"speak_model"` auf eine passende Stimme setzen, z. B. `"fish/s2.1-pro-free/<voice-id>"`
   (Stimme auf fish.audio suchen, die ID steht in der URL).
5. In `companion.json`: `"profile": "profiles/luna.json"`, bei `misheard_names` typische Verhörer des Namens,
   bei `extra_words` Namen aus der Lore.

Die genaue Anleitung (welcher Absatz was macht, Sprache auf Englisch umstellen, Skin) steht in
[`AGENT_SETUP.md`](AGENT_SETUP.md#5-charakter-bauen).

## Ordner

| Pfad | Inhalt |
|---|---|
| `start.bat` | startet Server + Gehirn + Push-to-Talk in 3 Fenstern |
| `companion.json` | **deine** Einstellungen: Spielername, Charakter-Profil, Sprechtaste, Mikro (nicht im Git) |
| `mindcraft/` | das Gehirn – Fork von [mindcraft-bots/mindcraft](https://github.com/mindcraft-bots/mindcraft) mit vielen Erweiterungen |
| `mindcraft/profiles/miku.json` | Beispiel-Charakter (Persönlichkeit, Modelle, Stimme, Beispiel-Gespräche) |
| `mindcraft/keys.json` | deine API-Keys (nicht im Git) |
| `mindcraft/bots/<Name>/` | Gedächtnis, Innenleben, Verlauf des Bots (nicht im Git) |
| `voice/ptt.py` | Push-to-Talk + Spracherkennung |
| `server/` | lokaler Minecraft-Server (nur `localhost`, offline-mode) |
| `docs/ANLEITUNG.md` | ausführliche Bedienungsanleitung jeder Funktion |
| `docs/FEHLER.md` | bekannte Fehler mit Ursache und Lösung |
| `docs/ENTSCHEIDUNGEN.md` | warum welche Modelle/Ansätze gewählt wurden |

## Tests

```bash
py -3.10 voice/ptt.py --selftest
```
```bash
cd mindcraft && node --test test/inner_life.test.mjs
```

## Hinweise

- **Code-Ausführung:** `allow_insecure_coding` ist in `mindcraft/settings.js` an – der Bot darf eigenen
  JavaScript-Code schreiben und ausführen (in einer Sandbox, laut Mindcraft trotzdem ein Risiko).
  Zum Abschalten auf `false` setzen; dann baut er nur noch per fertiger Befehle.
- **Server nur lokal:** `server-ip=127.0.0.1`, `online-mode=false`. Für Mitspieler aus dem Netz muss man das
  bewusst ändern (dann aber Whitelist an!).
- **Kosten:** Mit OpenRouter + DeepSeek Flash + kostenlosem Fish-Modell + Google AI Studio kostet ein
  Spielabend typischerweise nur Cent-Beträge.
- **Fehler?** Erst in [`docs/FEHLER.md`](docs/FEHLER.md) suchen – die meisten Probleme sind dort mit Lösung beschrieben.

## Lizenz & Credits

- Basis: [Mindcraft](https://github.com/mindcraft-bots/mindcraft) (MIT, siehe `mindcraft/LICENSE`), Stand Commit `e1c1fc3`.
- Minecraft ist eine Marke von Mojang/Microsoft; `server.jar` wird nicht mitgeliefert.
- Hatsune Miku © Crypton Future Media – das Beispielprofil ist ein nicht-kommerzielles Fan-Projekt.
