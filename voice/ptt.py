"""Push-to-Talk für den KI-Begleiter: Taste halten -> sprechen -> loslassen -> Text geht an den Bot.

Start: py -3.10 voice/ptt.py   (Mindcraft darf auch später starten – es wird automatisch verbunden)
Spracherkennung standardmäßig lokal mit faster-whisper auf der Nvidia-GPU (kostenlos, kein Key).
Selbsttest der reinen Text-Funktionen: py -3.10 voice/ptt.py --selftest
"""
import collections, io, json, os, pathlib, queue, re, site, sys, threading, time, wave

import numpy as np

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Emojis auch in alter Windows-Konsole

_root = pathlib.Path(__file__).parent.parent
_cfg = _root / "companion.json"
CFG = json.loads((_cfg if _cfg.exists() else _root / "companion.example.json").read_text(encoding="utf8"))

HOTKEY = CFG.get("hotkey", "v")  # Taste zum Halten (global, auch wenn Minecraft im Fokus ist)
CANCEL_KEY = "esc"      # während des Haltens drücken -> Aufnahme verwerfen
PLAYER = CFG["player"]  # dein Minecraft-Name -> so weiß der Bot, wer redet (companion.json)
AGENT = json.loads((_root / "mindcraft" / CFG["profile"]).read_text(encoding="utf8"))["name"]  # Name aus dem Profil
MISHEARD = CFG.get("misheard_names", [])  # so verhört sich Whisper oft beim Bot-Namen -> wird zu AGENT
EXTRA_WORDS = ", ".join(CFG.get("extra_words", []))  # Namen/Begriffe, die Whisper kennen soll
MINDSERVER = "http://localhost:8080"
STT = "local"           # "local" (Whisper auf dem PC), "fish" oder "elevenlabs" (kosten Geld, brauchen Key)
WHISPER_MODEL = "large-v3-turbo"  # GPU
WHISPER_CPU_MODEL = "small"       # Ersatz, wenn CUDA nicht geht
LANG = "de"             # Sprache für die Cloud-Erkennung (fish/elevenlabs)
LANGS = ("de", "en")    # lokal: Whisper wählt automatisch die wahrscheinlichste dieser Sprachen
RATE = 16000
MIC = CFG.get("mic")     # None/null = Windows-Standard; sonst Teil des Namens, z. B. "NVIDIA Broadcast" oder "Sharkoon"
PRE_ROLL_S = 0.4        # so viel Audio VOR dem Drücken wird mitgenommen (Wortanfang nicht abschneiden)
POST_ROLL_S = 0.3       # so lange wird NACH dem Loslassen weiter aufgenommen (Wortende)
MIN_HOLD_S = 0.25       # kürzer gehalten = nur angetippt (z. B. 'v' im Chat getippt) -> verwerfen
PENDING_MAX_AGE_S = 60  # Sätze, die gesagt wurden, während der Bot offline war, so lange aufheben

_keys = _root / "mindcraft" / "keys.json"
KEYS = json.loads(_keys.read_text(encoding="utf8")) if _keys.exists() else {}
whisper = None
whisper_device = None
last_lang = LANGS[0]

INITIAL_PROMPTS = {
    "de": f"Gespräch in Minecraft mit {AGENT} und {PLAYER}. Begriffe: {AGENT}, {PLAYER}, {EXTRA_WORDS}, Cobblestone, Dirt, Crafting Table, Spitzhacke, Fackel, Hütte, Basis, Spawn, Creeper, Skelett, Zombie. Nein, nein. Ja, okay.",
    "en": f"Voice chat in Minecraft with {AGENT} and {PLAYER}. Words: {AGENT}, {PLAYER}, {EXTRA_WORDS}, cobblestone, dirt, hut, shelter, crafting table, pickaxe, torch, base, spawn, creeper, skeleton, zombie. No, no. Yeah, okay.",
}

# Whisper "erfindet" bei Stille/Rauschen Sätze aus YouTube-Untertiteln.
# STRONG: sagt man praktisch nie zum Bot -> Segment immer verwerfen.
HALLU_STRONG = re.compile(
    r"untertitel|amara\.org|im auftrag des|\b(zdf|swr|ard)\b|funk\.net|fürs zuschauen|für's zuschauen|"
    r"abonnier|thanks? (you )?for watching|subtitles? by|please subscribe|"
    r"like and subscribe|www\.|https?://|©|copyright", re.IGNORECASE)
# WEAK: kann echt gesagt sein -> nur verwerfen, wenn das Segment ALLEIN steht und Whisper unsicher war (Stille)
HALLU_WEAK = re.compile(
    r"\s*(vielen dank\.?|danke( schön)?\.?|tschüss\.?|thank you\.?|thanks\.?|bye\.?|you\.?|\.+|…)\s*",
    re.IGNORECASE)


def is_hallucination(text, no_speech_prob=0.0, alone=True):
    """True, wenn ein Whisper-Segment sehr wahrscheinlich erfunden ist."""
    t = text.strip()
    if not t or HALLU_STRONG.search(t):
        return True
    return alone and no_speech_prob > 0.3 and bool(HALLU_WEAK.fullmatch(t))


def _add_cuda_dlls():
    # CUDA-DLLs aus den pip-Paketen nvidia-cublas-cu12 / nvidia-cudnn-cu12 auffindbar machen (Windows)
    for sp in site.getsitepackages():
        for lib in ("cublas", "cudnn"):
            d = pathlib.Path(sp) / "nvidia" / lib / "bin"
            if d.is_dir():
                os.add_dll_directory(str(d)); os.environ["PATH"] = f"{d};{os.environ.get('PATH', '')}"


def load_whisper(force_cpu=False):
    """Whisper einmal beim Start laden (GPU, sonst CPU)."""
    global whisper, whisper_device
    from faster_whisper import WhisperModel
    if not force_cpu:
        _add_cuda_dlls()
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() == 0:
                raise RuntimeError("keine CUDA-GPU gefunden")
            whisper = WhisperModel(WHISPER_MODEL, device="cuda", compute_type="float16")
            # Testlauf (list() erzwingt das Rechnen) -> fehlende cuDNN/cuBLAS-DLLs fallen JETZT auf, nicht beim 1. Satz
            list(whisper.transcribe(np.random.uniform(-0.1, 0.1, RATE).astype(np.float32), language=LANGS[0], beam_size=5)[0])
            whisper_device = "cuda"
            print(f"🧠 Whisper {WHISPER_MODEL} läuft auf der GPU")
            return
        except Exception as e:
            print(f"⚠️  GPU geht nicht ({e}) – nehme CPU (langsamer)")
    whisper = WhisperModel(WHISPER_CPU_MODEL, device="cpu", compute_type="int8")
    whisper_device = "cpu"
    print(f"🧠 Whisper {WHISPER_CPU_MODEL} läuft auf der CPU")


def mic_device(sd):
    """MIC-Namensteil -> Geräte-Nummer (nur MME, sonst gibt es jeden Namen 3x)."""
    if MIC is None:
        return None
    for i, d in enumerate(sd.query_devices()):
        if d['max_input_channels'] > 0 and d['hostapi'] == 0 and MIC.lower() in d['name'].lower():
            return i
    raise RuntimeError(f"Mikro '{MIC}' nicht gefunden – Namen siehe Windows-Soundeinstellungen")


def to_wav(chunks):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(np.concatenate(chunks).tobytes())
    return buf.getvalue()


def clean_transcript(text):
    """Typische Whisper-Hörfehler und Stotter-Schleifen ('me, me, me...') bereinigen."""
    if not text:
        return ""
    # Stotter-Schleifen ab 4 gleichen Wörtern in Folge kürzen
    text = re.sub(r"\b(\w+)(?:[\s,.;!]+\1){3,}\b", r"\1", text, flags=re.IGNORECASE)
    # Häufige Fehl-Schreibweisen für den Bot-Namen (companion.json) und 'Nein, nein'
    if MISHEARD:
        text = re.sub(r"\b(" + "|".join(map(re.escape, MISHEARD)) + r")\b", AGENT, text, flags=re.IGNORECASE)
    if re.fullmatch(r"[\s,.;!]*9[\s,.;!]+9[\s,.;!]*", text):
        text = "Nein, nein."
    text = text.strip()
    return "" if is_hallucination(text) else text


def pick_lang(probs, speech_s, last):
    """Sprache aus LANGS wählen; kurze Sätze ('Ja', 'Okay') behalten die zuletzt benutzte Sprache,
    außer die andere ist eindeutig (> 0,9)."""
    best = max(LANGS, key=lambda l: probs.get(l, 0.0))
    if speech_s < 1.5 and probs.get(best, 0.0) < 0.9:
        return last
    return best


def transcribe(chunks):
    if STT == "local":
        global last_lang
        audio = np.concatenate(chunks).flatten().astype(np.float32) / 32768.0
        _, _, probs = whisper.detect_language(audio)
        last_lang = lang = pick_lang(dict(probs), len(audio) / RATE - PRE_ROLL_S - POST_ROLL_S, last_lang)
        segs, _ = whisper.transcribe(
            audio,
            language=lang,
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
            repetition_penalty=1.2,
            no_repeat_ngram_size=3,
            compression_ratio_threshold=2.0,
            no_speech_threshold=0.6,
            initial_prompt=INITIAL_PROMPTS.get(lang),
            hotwords=f"{AGENT} {PLAYER} Minecraft {EXTRA_WORDS.replace(',', '')} hut cobblestone",
        )
        segs = list(segs)
        kept = [s.text.strip() for s in segs if not is_hallucination(s.text, s.no_speech_prob, alone=len(segs) == 1)]
        return clean_transcript(" ".join(kept))
    import requests
    wav = to_wav(chunks)
    if STT == "fish":
        r = requests.post("https://api.fish.audio/v1/asr",
                          headers={"Authorization": f"Bearer {KEYS['FISH_API_KEY']}", "model": "transcribe-1"},
                          files={"audio": ("a.wav", wav, "audio/wav")}, data={"language": LANG}, timeout=30)
    else:
        r = requests.post("https://api.elevenlabs.io/v1/speech-to-text",
                          headers={"xi-api-key": KEYS["ELEVENLABS_API_KEY"]},
                          files={"file": ("a.wav", wav, "audio/wav")},
                          data={"model_id": "scribe_v2", "language_code": LANG}, timeout=30)
    r.raise_for_status()
    return clean_transcript(r.json()["text"])


class Bot:
    """Verbindung zum MindServer. Verbindet von selbst neu (auch wenn Mindcraft erst später startet) und
    hebt Sätze auf, solange der Bot nicht im Spiel ist (MindServer würde sie sonst stumm wegwerfen)."""

    def __init__(self):
        import socketio
        self.sio = socketio.Client(reconnection=True, reconnection_delay_max=5)
        self.in_game = False
        self.pending = collections.deque()  # (zeit, text)
        self.lock = threading.Lock()
        self.sio.on("connect", lambda: print("🔌 Mit Mindcraft verbunden"))
        self.sio.on("disconnect", self._on_disconnect)
        self.sio.on("agents-status", self._on_status)
        threading.Thread(target=self._connect_loop, daemon=True).start()

    def _connect_loop(self):
        # socketio verbindet nur nach einem ERFOLGREICHEN ersten connect() selbst neu -> ersten Versuch hier wiederholen
        warned = False
        while not self.sio.connected:
            try:
                self.sio.connect(MINDSERVER, wait_timeout=5)
                return
            except Exception as e:
                if not warned:
                    print(f"⏳ Mindcraft noch nicht erreichbar ({e}) – versuche weiter …"); warned = True
                time.sleep(3)

    def _on_disconnect(self, *_):
        self.in_game = False
        print("🔌 Verbindung zu Mindcraft weg – verbinde neu …")

    def _on_status(self, agents):
        was = self.in_game
        self.in_game = any(a.get("name") == AGENT and a.get("in_game") for a in agents or [])
        if self.in_game and not was:
            print(f"✅ {AGENT} ist im Spiel")
            self._flush()

    def _flush(self):
        with self.lock:
            while self.pending:
                t, text = self.pending.popleft()
                if time.time() - t <= PENDING_MAX_AGE_S:
                    self._emit(text)

    def _emit(self, text):
        self.sio.emit("send-message", (AGENT, {"from": PLAYER, "message": text}))

    def send(self, text):
        with self.lock:
            if self.sio.connected and self.in_game:
                try:
                    self._emit(text); return
                except Exception as e:
                    print(f"⚠️  Senden fehlgeschlagen ({e})")
            self.pending.append((time.time(), text))
            print(f"⏸  {AGENT} ist gerade nicht da – Satz wird nachgereicht, sobald sie wieder im Spiel ist")


def worker(jobs, bot):
    while True:
        audio = jobs.get()
        try:
            text = transcribe(audio)
        except Exception as e:
            msg = str(e).lower()
            if STT == "local" and whisper_device == "cuda" and any(k in msg for k in ("cuda", "cublas", "cudnn", "out of memory")):
                print(f"❌ GPU-Fehler: {e} – wechsle auf CPU")
                try:
                    load_whisper(force_cpu=True); text = transcribe(audio)
                except Exception as e2:
                    print(f"❌ STT-Fehler: {e2}"); continue
            else:
                print(f"❌ STT-Fehler: {e}"); continue
        print(f"🗣  {text or '(nichts verstanden)'}")
        if text:
            bot.send(text)


def main():
    import keyboard, sounddevice as sd
    if STT == "local":
        load_whisper()
    bot = Bot()

    lock = threading.Lock()  # Audio-Thread vs. Tasten-Schleife (chunks/pre gleichzeitig ändern -> RuntimeError)
    chunks, recording = [], False
    pre = collections.deque(maxlen=round(PRE_ROLL_S / 0.1))  # letzte 0,4 s in 100-ms-Blöcken
    last_audio = [time.time()]
    jobs = queue.Queue()  # fertige Aufnahmen -> Whisper-Thread (Taste bleibt währenddessen bereit)

    def on_audio(data, frames, t, status):
        last_audio[0] = time.time()
        with lock:
            (chunks if recording else pre).append(data.copy())

    def open_stream():
        """Mikro öffnen; bei Fehler (abgesteckt, belegt) alle 3 s neu versuchen."""
        warned = False
        while True:
            try:
                sd._terminate(); sd._initialize()  # Geräteliste neu einlesen (Mikro ab-/angesteckt, Standard geändert)
                mic = mic_device(sd)
                s = sd.InputStream(device=mic, samplerate=RATE, channels=1, dtype="int16",
                                   blocksize=RATE // 10, callback=on_audio)
                s.start()
                last_audio[0] = time.time()
                print(f"🎙  Mikro: {sd.query_devices(mic, kind='input')['name']}")
                return s, mic
            except Exception as e:
                if not warned:
                    print(f"⚠️  Mikro geht nicht ({e}) – versuche alle 3 s neu …"); warned = True
                time.sleep(3)

    threading.Thread(target=worker, args=(jobs, bot), daemon=True).start()
    # on_press_key reagiert auf die Taste egal ob Strg (Sprinten) oder Shift (Schleichen) gehalten wird –
    # keyboard.wait(HOTKEY) hat das als anderes Tastenkürzel ignoriert
    pressed_evt = threading.Event()
    keyboard.on_press_key(HOTKEY, lambda e: pressed_evt.set())

    stream, mic = open_stream()
    print(f"🎤 Bereit. '{HOTKEY}' halten zum Sprechen ({CANCEL_KEY} = verwerfen), Strg+C zum Beenden.")
    while True:
        # Watchdog: kommt > 2 s kein Audio mehr (Gerät weg, Treiber hängt), Stream neu öffnen
        if not stream.active or time.time() - last_audio[0] > 2:
            print("⚠️  Mikro liefert nichts mehr – öffne neu …")
            try:
                stream.close(ignore_errors=True)
            except Exception:
                pass
            stream, mic = open_stream()
        if not pressed_evt.wait(1.0):
            continue
        with lock:
            chunks.clear(); chunks.extend(pre); recording = True
        pressed = time.time()
        cancelled = False
        while keyboard.is_pressed(HOTKEY):
            if keyboard.is_pressed(CANCEL_KEY):
                cancelled = True
            sd.sleep(20)
        held = time.time() - pressed  # VOR dem Nachlauf messen, sonst ist jedes Antippen >= POST_ROLL_S
        sd.sleep(int(POST_ROLL_S * 1000))
        with lock:
            recording = False
            rec = list(chunks)
        pressed_evt.clear()  # Tasten-Wiederholungen beim Halten verwerfen
        if cancelled:
            print("● verworfen"); continue
        if held < MIN_HOLD_S:
            print("● zu kurz"); continue
        if not rec:
            print("⚠️  Kein Audio aufgenommen – Mikro weg?"); continue
        peak = max(int(np.abs(c).max()) for c in rec) / 32768
        print(f"● Aufnahme {held:.1f}s, Pegel {peak:.0%}")
        if peak < 0.02:  # praktisch Stille -> falsches/stummes Mikro
            print(f"⚠️  Kaum Ton vom Mikro '{sd.query_devices(mic, kind='input')['name']}' – richtiges Mikro?"); continue
        jobs.put(rec)


def selftest():
    assert clean_transcript("Untertitel im Auftrag des ZDF, 2021") == ""
    assert clean_transcript("Untertitelung des ZDF für funk, 2017") == ""
    assert clean_transcript("Vielen Dank fürs Zuschauen!") == ""
    assert clean_transcript("Thanks for watching!") == ""
    assert clean_transcript(f"Hey {AGENT}, was machst du gerade?") == f"Hey {AGENT}, was machst du gerade?"
    assert clean_transcript(f"Vielen Dank, {AGENT}") == f"Vielen Dank, {AGENT}"
    assert clean_transcript("me me me me me") == "me"
    if MISHEARD:
        assert clean_transcript(f"Hallo {MISHEARD[0]}") == f"Hallo {AGENT}"
    assert clean_transcript("9, 9.") == "Nein, nein."
    assert is_hallucination("Vielen Dank.", no_speech_prob=0.5)
    assert not is_hallucination("Vielen Dank.", no_speech_prob=0.1)
    assert not is_hallucination("Vielen Dank.", no_speech_prob=0.5, alone=False)
    assert is_hallucination("Thank you.", no_speech_prob=0.6)
    assert not is_hallucination("Ok then stop chasing me")
    assert not is_hallucination("Hilf mir mal bei der Basis")
    assert not is_hallucination("That was hard") and not is_hallucination("Guard the base")
    assert not is_hallucination(f"Bis zum nächsten Mal, {AGENT}")
    assert pick_lang({"de": 0.6, "en": 0.4}, 0.5, "en") == "en"
    assert pick_lang({"de": 0.95, "en": 0.05}, 0.5, "en") == "de"
    assert pick_lang({"de": 0.3, "en": 0.7}, 3.0, "de") == "en"
    assert pick_lang({}, 3.0, "de") == "de"
    print("✅ Selbsttest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest(); sys.exit(0)
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
