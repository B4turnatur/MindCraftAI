# Einrichtung durch einen KI-Agenten

> **An den KI-Agenten (Claude Code, Codex, Cursor …):** Diese Datei ist deine Arbeitsanweisung.
> Arbeite die Schritte der Reihe nach ab. Prüfe jeden Schritt mit dem angegebenen Befehl, bevor du weitergehst.
> Sprich mit dem Nutzer locker und kurz, in seiner Sprache. Erkläre Fachbegriffe in einem Halbsatz.
>
> **Regeln:**
> - API-Keys trägt der **Nutzer selbst** in `mindcraft/keys.json` ein. Frag nicht nach dem Key-Text, gib keine Keys aus.
> - Die Minecraft-EULA akzeptiert der **Nutzer selbst** (Link zeigen, fragen). Erst nach seinem „Ja“ `eula=true` schreiben.
> - Programme nur mit Zustimmung des Nutzers installieren.
> - Bei Fehlern zuerst `docs/FEHLER.md` durchsuchen – viele Probleme sind dort schon gelöst.
> - Die Bedienung jeder einzelnen Funktion steht in `docs/ANLEITUNG.md`.

Ziel: Am Ende startet `start.bat` drei Fenster (Server, KI-Gehirn, Push-to-Talk), der Nutzer joint in Minecraft
26.1.2 auf `localhost`, sein Wunsch-Charakter kommt ins Spiel, begrüßt ihn mit eigener Stimme und reagiert auf `V` + Sprechen.

---

## 1. Voraussetzungen prüfen

Alle Befehle im Projektordner ausführen:

| Prüfen | Erwartet | Wenn es fehlt (Windows, `winget`) |
|---|---|---|
| `node -v` | `v20` oder höher | `winget install OpenJS.NodeJS.LTS` |
| `py -3.10 --version` | `Python 3.10.x` | `winget install Python.Python.3.10` |
| `java -version` | Version **25** oder höher | `winget search "JDK 25"` → z. B. Eclipse Temurin 25 installieren |
| `ffplay -version` | Versionsausgabe | `winget install Gyan.FFmpeg` (danach neues Terminal, damit PATH stimmt) |
| `nvidia-smi` | Grafikkarte wird angezeigt | optional – ohne Nvidia läuft Whisper auf der CPU (langsamer, Modell `small`) |

Außerdem: **Minecraft Java Edition** mit Launcher. Den Nutzer bitten, im Launcher unter *Installationen → Neu*
die Version **26.1.2** anzulegen (der Server läuft auf dieser Version).

## 2. Abhängigkeiten installieren

```bash
cd mindcraft && npm install
```
Erwartet: endet ohne `ERR!`; am Ende läuft `patch-package` und meldet die Patches aus `mindcraft/patches/` als angewendet.

```bash
py -3.10 -m pip install -r voice/requirements.txt
```
Ohne Nvidia-GPU: die Zeilen `nvidia-cublas-cu12` und `nvidia-cudnn-cu12` darf man weglassen
(dann `py -3.10 -m pip install keyboard numpy requests sounddevice "python-socketio[client]" faster-whisper`).

Prüfen:
```bash
py -3.10 voice/ptt.py --selftest
```
→ `✅ Selbsttest ok`

## 3. Minecraft-Server

1. Die Server-Datei für **26.1.2** besorgen: [minecraft.net/download/server](https://www.minecraft.net/en-us/download/server)
   (zeigt die neueste Version – falls neuer als 26.1.2: die 26.1.2-`server.jar` über das offizielle Versions-Manifest
   `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` → Eintrag `26.1.2` → `downloads.server.url` laden).
2. Als `server/server.jar` speichern.
3. Dem Nutzer den EULA-Link zeigen: <https://aka.ms/MinecraftEULA>. Nur wenn er zustimmt:
   `server/eula.txt` mit Inhalt `eula=true` anlegen.
4. Einstellungen stehen schon in `server/server.properties` (nur `127.0.0.1`, offline-mode, Schwierigkeit easy).
   Beim ersten Start legt der Server die Welt `server/world/` an.

## 4. Keys & persönliche Einstellungen

1. `mindcraft/keys.example.json` nach `mindcraft/keys.json` kopieren.
2. Dem Nutzer erklären, welche Keys er braucht, und ihn bitten, sie **selbst** in `mindcraft/keys.json` einzutragen:
   - `OPENROUTER_API_KEY` – [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys), etwas Guthaben aufladen (5 $ reichen lange).
     Ohne diesen Key wird die Claude Code CLI (`claude`, Claude-Abo) als Gehirn benutzt.
   - `GEMINI_API_KEY` – kostenlos im [Google AI Studio](https://aistudio.google.com) → „Get API key“.
   - `FISH_API_KEY` – [fish.audio](https://fish.audio) → Konto → API Keys (Modell `s2.1-pro-free` ist kostenlos).
     Alternativ `ELEVENLABS_API_KEY`.
3. Prüfen, **ohne Werte auszugeben**:
   ```bash
   node -e "const k=require('./mindcraft/keys.json');console.log(Object.keys(k).filter(x=>k[x]))"
   ```
   → zeigt nur die Namen der ausgefüllten Keys.
4. `companion.example.json` nach `companion.json` kopieren und den Nutzer nach seinem **Minecraft-Spielernamen** fragen → `player`.

`companion.json` – alle Felder:

| Feld | Bedeutung | Beispiel |
|---|---|---|
| `player` | Minecraft-Name des Nutzers (so weiß der Bot, wer redet) | `"Steve"` |
| `profile` | Charakter-Profil, relativ zu `mindcraft/` | `"profiles/miku.json"` |
| `misheard_names` | so verhört sich die Spracherkennung beim Bot-Namen → wird automatisch korrigiert | `["Miko", "Mico"]` |
| `extra_words` | Namen/Begriffe, die die Spracherkennung kennen soll (Lore, Freunde) | `["Teto"]` |
| `hotkey` | Push-to-Talk-Taste | `"v"` |
| `mic` | Teil des Mikrofon-Namens, `null` = Windows-Standard | `"NVIDIA Broadcast"` |

## 5. Charakter bauen

### 5a. Den Nutzer interviewen

Frag kurz (gern alles in einer Nachricht):
1. **Welcher Charakter?** (bekannte Figur oder eigene Erfindung) und **wie soll er heißen?**
2. **Persönlichkeit:** 3–5 Eigenschaften (z. B. frech, schüchtern, sarkastisch, fürsorglich, chaotisch), Humor-Art.
3. **Wie redet er?** (jugendlich, förmlich, Akzent, Lieblingssprüche) und **welche Sprache** (Deutsch / Englisch / beides).
4. **Lore / Insider:** Hintergrund, Freunde, Rivalen, Running Gags (optional).
5. **Stimme:** hat er eine Lieblingsstimme auf fish.audio? Sonst suchst du mit ihm eine passende.

### 5b. Profil-Datei anlegen

1. `mindcraft/profiles/miku.json` nach `mindcraft/profiles/<name-klein>.json` kopieren.
2. `"name"` = Name des Charakters. **Das ist der Minecraft-Name des Bots:** 3–16 Zeichen, nur Buchstaben, Ziffern, `_`
   (keine Leerzeichen/Umlaute). Gespräche und Gedächtnis landen später in `mindcraft/bots/<name>/`.
3. `"conversing"` ist der große System-Prompt. Er besteht aus Absätzen; **nur diese drei sind charakter-spezifisch**:
   - **Erster Satz** `You are $NAME: Hatsune Miku, the virtual singer (...)` → wer der Charakter ist (1–2 Sätze, Aussehen/Herkunft).
     Den Rest des Absatzes (`You are NOT an assistant ... real person ...`) stehen lassen.
   - **`PERSONALITY: ...`** → Persönlichkeit und Humor aus dem Interview, konkret und mit Beispielen.
   - **`LORE YOU JOKE ABOUT ...`** → Lore/Insider aus dem Interview, oder den Absatz löschen.

   **Alles andere stehen lassen** (`YOUR OWN FREE WILL`, `YOU HAVE YOUR OWN LIFE & EYES`, `YOU PLAY LIKE A SMART ... PLAYER` 1–7,
   `TALK TO YOUR FRIEND`, `SPEECH`, `VOICE TAGS`, `PRIVATE THOUGHT`, und alle `$PLATZHALTER` wie `$NAME`, `$STATS`,
   `$INVENTORY`, `$COMMAND_DOCS`, `$EXAMPLES`, `$MEMORY`, `$INNER`, `$SELF_PROMPT`). Das sind die Spielregeln,
   die den Bot schlau und menschlich machen. Im `SPEECH`-Absatz darf man den Sprechstil anpassen
   (z. B. „like a teenager in Discord voice chat“ → passend zum Charakter).
4. `"speak_model"` = Stimme:
   - Fish Audio: `"fish/s2.1-pro-free/<voice-id>"` – Stimme auf [fish.audio](https://fish.audio) suchen,
     die ID ist der lange Hex-Code in der URL (`fish.audio/m/<voice-id>`). `s2.1-pro-free` = kostenlos.
   - ElevenLabs: `"elevenlabs/eleven_flash_v2_5/<voice_id>"`.
   - Keine Stimme: `"system"` (Windows-Sprachausgabe).
5. `"conversation_examples"`: Beispiel-Gespräche (der Spieler heißt darin `Steve`, das ist egal).
   Die Antworten klingen nach Miku – für einen deutlich anderen Charakter 5–10 der `"assistant"`-Antworten
   im neuen Stil umschreiben (Befehle wie `!collectBlocks(...)` **unverändert** lassen). Optional, aber hilft.
6. `"model"`, `"embedding"`, `"vision_model"`, `"coding"`, `"saving_memory"`, `"reflecting"`, `"modes"` nicht anfassen.
7. JSON prüfen:
   ```bash
   node -e "const p=require('./mindcraft/profiles/<name-klein>.json');console.log(p.name, p.speak_model, p.conversing.length)"
   ```
8. In `companion.json`: `"profile": "profiles/<name-klein>.json"`, `misheard_names` (wie Whisper den Namen vermutlich falsch
   schreibt, z. B. für „Luna“: `["Lunar", "Lona"]`) und `extra_words` (Namen aus der Lore) setzen.
9. Prüfen, dass alles zusammenpasst:
   ```bash
   cd mindcraft && node --input-type=module -e "import s,{companion} from './settings.js'; console.log(s.profiles[0], companion.character, companion.player)"
   ```
   ```bash
   py -3.10 voice/ptt.py --selftest
   ```

### 5c. Sprache (nur wenn nicht Deutsch)

Der Bot spiegelt die Sprache des Spielers (Deutsch/Englisch). Für **nur Englisch** zusätzlich:
- `mindcraft/settings.js` → `init_message` auf Englisch übersetzen.
- Im Profil: in `conversing` „if unsure German“ → „if unsure English“, im Absatz `PRIVATE THOUGHT` „German“ → „English“;
  in `reflecting` „in German“ → „in English“.
- `voice/ptt.py` → `LANGS = ("en", "de")` (erste Sprache = bevorzugt), `LANG = "en"`.
- `mindcraft/src/agent/inner_life.js` → `START_SELF` auf Englisch.

Andere Sprachen: dieselben Stellen, plus `LANGS` um den Whisper-Sprachcode erweitern.

### 5d. Skin (optional)

Der Server läuft im offline-mode, der Bot hat daher den Standard-Skin. Für einen eigenen Look nur beim Nutzer:
Mod **CustomSkinLoader** (Fabric) im Minecraft-Client installieren und das 64×64-PNG als
`CustomSkinLoader/LocalSkin/skins/<Botname>.png` im Minecraft-Instanzordner ablegen. Details: `docs/ANLEITUNG.md` → „Skin“.

## 6. Erster Start

1. Doppelklick auf `start.bat` (oder im Terminal `start.bat`). Es öffnen sich 3 Fenster.
   Beim allerersten Start: Server erzeugt die Welt (~30 s), Whisper lädt sein Modell (~1,6 GB, einmalig),
   Google bettet die Beispiele ein (einmalig, danach Cache in `mindcraft/bots/gemini_embeddings_cache.json`).
2. Im Browser öffnet sich das Dashboard `http://localhost:8080`.
3. Minecraft 26.1.2 → Mehrspieler → Direkt verbinden → `localhost`.
4. Der Bot kommt ins Spiel und begrüßt den Nutzer.
5. Test: `V` halten, „Hallo, komm mal her“ sagen, loslassen → im Chat erscheint grau `[gehört] …`, der Bot antwortet und läuft her.

**Woran man sieht, dass etwas fehlt:**

| Meldung | Lösung |
|---|---|
| `FEHLT: server\server.jar` / `keys.json` | Schritt 3 / 4 |
| Server-Fenster: `You need to agree to the EULA` | Schritt 3.3 |
| `API key "X" not found` | Key in `mindcraft/keys.json` fehlt |
| `TTS HTTP 401` / `402` | Stimm-Key falsch / Guthaben leer |
| `ModuleNotFoundError` im Push-to-Talk | mit `py -3.10` installiert? Schritt 2 |
| „Kaum Ton vom Mikro“ | `mic` in `companion.json` setzen |
| Bot joint nicht / `ECONNREFUSED` | Server noch nicht fertig – Gehirn-Fenster schließen, `cd mindcraft && node main.js` neu starten |

Alles Weitere: `docs/FEHLER.md` (nach der Meldung suchen) und `docs/ANLEITUNG.md`.

## 7. Abschluss

Dem Nutzer kurz zusammenfassen: wie er startet (`start.bat`), wie er redet (`V` halten), wie er stoppt
(Minecraft trennen, Gehirn- und PTT-Fenster schließen, im Server-Fenster `stop` tippen), und wo er die Persönlichkeit
später ändern kann (`mindcraft/profiles/<name>.json` → `conversing`, danach Gehirn neu starten).
