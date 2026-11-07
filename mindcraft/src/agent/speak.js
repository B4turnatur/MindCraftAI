import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { TTSConfig as gptTTSConfig } from '../models/gpt.js';
import { TTSConfig as geminiTTSConfig } from '../models/gemini.js';
import { getKey } from '../utils/keys.js';
import { splitThought } from './inner_life.js';

let speakingQueue = []; // each item: {text, model, audioData, ready}
let isSpeaking = false;
let currentPlayer = null; // aktueller Abspiel-Prozess (für Barge-In / sofortiges Stoppen)
let generation = 0;       // wird bei stopSpeaking() erhöht -> alte Abspiel-Schleife beendet sich (F-A2)
const MAX_QUEUE = 4;      // mehr wartende Sätze -> älteste verwerfen, damit sie nicht minutenlang hinterherredet

// Fish S2/S2.1 versteht Stimm-Tags in eckigen Klammern (docs.fish.audio → Emotions). Nur diese kleine Auswahl
// darf das LLM benutzen; alles andere in [..] wird entfernt. Für Chat/andere TTS werden alle Tags entfernt.
export const VOICE_TAGS = ['laughing', 'chuckling', 'sighing', 'groaning', 'gasping', 'whispering', 'excited',
    'sarcastic', 'annoyed', 'surprised', 'sad', 'happy', 'nervous', 'yawning', 'break', 'long-break'];
const TAG_RE = /\[\s*([a-z][a-z -]{0,30}?)\s*\]/gi;

// Entfernt alle [tag]-Stimm-Tags (für Chat, Konsole, System-TTS)
export function stripVoiceTags(text) {
    return String(text ?? '').replace(TAG_RE, ' ').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?;:])(?![a-zA-Z])/g, '$1').trim();
}

// Bereinigt Text vor dem Vorlesen: keine Befehle, Koordinaten, Unterstriche (oak_log), Markdown-Sternchen, Emojis.
// keepTags=true (nur Fish): erlaubte Stimm-Tags bleiben als [tag] stehen, unbekannte fliegen raus.
export function cleanForSpeech(text, keepTags = false) {
    if (!text) return '';
    const tags = [];
    let t = splitThought(text).rest.replace(TAG_RE, (_, name) => {
        name = name.toLowerCase().trim();
        if (!keepTags || !VOICE_TAGS.includes(name)) return ' ';
        tags.push(name);
        return ` §${tags.length - 1}§ `; // Platzhalter, damit die Regeln unten das Tag nicht zerlegen
    });
    t = t
        .replace(/(^|\s)![a-zA-Z]+(\((?:"[^"]*"|[^)"])*\))?/g, '$1') // !befehl / !befehl("a (b)", 3)
        .replace(/\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/g, '') // (79, 82, -25) weglassen
        .replace(/\bx\s*[:=]\s*-?\d+(?:\.\d+)?\s*,?\s*y\s*[:=]\s*-?\d+(?:\.\d+)?\s*,?\s*z\s*[:=]\s*-?\d+(?:\.\d+)?/gi, 'hier')
        .replace(/\bminecraft:/gi, '')
        .replace(/\b([a-z]+)_([a-z_]+)\b/gi, (_, a, b) => `${a} ${b.replace(/_/g, ' ')}`) // oak_log -> oak log
        .replace(/[*_`#~]+/g, ' ')                 // Markdown (*used punch*) nicht vorlesen
        .replace(/\p{Extended_Pictographic}️?/gu, '') // Emojis
        .replace(/\s+/g, ' ')
        .replace(/\s+([.,!?;:])/g, '$1')           // "bei ." -> "bei."
        .replace(/^[\s.,;:]+/, '')
        .trim();
    return t.replace(/§(\d+)§/g, (_, i) => `[${tags[i]}]`).replace(/\s+/g, ' ').trim();
}

// Verworfenes Item: evtl. offenen Audio-Download schließen (sonst bleibt die HTTP-Verbindung hängen)
function discard(item) {
    item.ready?.then(() => item.audioData?.stream?.cancel?.()).catch(() => {});
}

// Bricht laufende Sprachausgabe und Warteschlange sofort ab (z. B. wenn der Spieler reinredet)
export function stopSpeaking() {
    generation++;
    speakingQueue.forEach(discard);
    speakingQueue = [];
    if (currentPlayer) {
        try { currentPlayer.kill(); } catch {}
        currentPlayer = null;
    }
    isSpeaking = false;
}

export function speak(text, speak_model) {
    const model = speak_model || 'system';
    const isFish = (typeof model === 'string' ? model.split('/')[0] : model.api) === 'fish';
    const cleanText = cleanForSpeech(text, isFish);
    if (!/[\p{L}\p{N}]/u.test(stripVoiceTags(cleanText))) return; // nur Satzzeichen/Tags übrig -> nichts sagen

    const item = { text: cleanText, model, audioData: null, ready: null };

    if (model === 'system') {
        item.ready = Promise.resolve();
    } else {
        item.ready = fetchRemoteAudio(cleanText, model)
            .then(data => { item.audioData = data; })
            .catch(err => { item.error = err; });
    }

    speakingQueue.push(item);
    while (speakingQueue.length > MAX_QUEUE) discard(speakingQueue.shift());
    if (!isSpeaking) processQueue();
}

async function fetchRemoteAudio(txt, model) {
    function getModelUrl(prov) {
        if (prov === 'openai') return gptTTSConfig.baseUrl;
        if (prov === 'google') return geminiTTSConfig.baseUrl;
        return 'https://api.openai.com/v1';
    }

    let prov, mdl, voice, url;
    if (typeof model === 'string') {
        [prov, mdl, voice] = model.split('/');
        url = getModelUrl(prov);
    } else {
        prov = model.api;
        mdl = model.model;
        voice = model.voice;
        url = model.url || getModelUrl(prov);
    }

    if (prov === 'openai') {
        return gptTTSConfig.sendAudioRequest(txt, mdl, voice, url);
    } else if (prov === 'google') {
        return geminiTTSConfig.sendAudioRequest(txt, mdl, voice, url);
    } else if (prov === 'fish') {
        // speak_model: "fish/<model e.g. s2.1-pro>/<reference_id of the voice>"
        return fetchMp3('https://api.fish.audio/v1/tts', {
            'Authorization': `Bearer ${getKey('FISH_API_KEY')}`, 'model': mdl,
        }, { text: txt, reference_id: voice, format: 'mp3', latency: 'low' });
    } else if (prov === 'elevenlabs') {
        // speak_model: "elevenlabs/<model e.g. eleven_flash_v2_5>/<voice_id>"
        return fetchMp3(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
            'xi-api-key': getKey('ELEVENLABS_API_KEY'),
        }, { text: txt, model_id: mdl });
    }
    else {
        throw new Error(`TTS Provider ${prov} is not supported.`);
    }
}

async function fetchMp3(url, headers, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}: ${await res.text()}`);
    return { stream: res.body }; // nicht abwarten: wird beim Abspielen direkt in ffplay gestreamt
}

// Startet einen Abspiel-Prozess, merkt ihn für stopSpeaking() und wartet, bis er fertig ist
function runPlayer(cmd, args, opts = {}) {
    return new Promise(resolve => {
        let player;
        try { player = spawn(cmd, args, { windowsHide: true, ...opts }); }
        catch (err) { console.error('[TTS] spawn error', err); return resolve(null); }
        currentPlayer = player;
        const done = () => {
            if (currentPlayer === player) currentPlayer = null;
            resolve(player);
        };
        player.on('error', err => { console.error(`[TTS] ${cmd} error`, err.message); done(); });
        player.on('exit', done);
        player.stdin?.on('error', () => {}); // Player beendet -> Rest verwerfen
        opts.onStart?.(player);
    });
}

// Spielt das Audio ab, während es noch heruntergeladen wird (erstes Byte ~0,8 s statt ~3 s warten)
export function playStream(stream) {
    return runPlayer('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet',
        '-fflags', 'nobuffer', '-probesize', '32', '-analyzeduration', '0', '-f', 'mp3', '-i', 'pipe:0'], {
        stdio: ['pipe', 'ignore', 'ignore'],
        onStart: (player) => (async () => {
            try { for await (const chunk of stream) { if (currentPlayer !== player) break; player.stdin.write(chunk); } }
            catch (e) { console.error('[TTS] stream error', e.message); }
            try { player.stdin.end(); } catch {}
        })(),
    });
}

async function playItem(item) {
    const { text: txt, model, audioData } = item;
    if (model === 'system') {
        // Text über Umgebungsvariable/Argument statt in den Befehl eingebaut -> Anführungszeichen im Text brechen nichts
        if (process.platform === 'win32')
            return runPlayer('powershell', ['-NoProfile', '-Command',
                'Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=2; $s.Speak($env:MIKU_TTS_TEXT); $s.Dispose()'],
                { stdio: 'ignore', env: { ...process.env, MIKU_TTS_TEXT: txt } });
        return runPlayer(process.platform === 'darwin' ? 'say' : 'espeak', [txt], { stdio: 'ignore' });
    }
    if (!audioData) return console.error('[TTS] No audio data ready');
    if (audioData.stream) return playStream(audioData.stream); // fish / elevenlabs: streamen

    const tmpPath = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`);
    await fs.writeFile(tmpPath, Buffer.from(audioData, 'base64'));
    try { await runPlayer('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', tmpPath], { stdio: 'ignore' }); }
    finally { fs.unlink(tmpPath).catch(() => {}); }
}

// Eine Abspiel-Schleife pro "Generation": nach stopSpeaking() beendet sich die alte still,
// statt einen schon abgebrochenen Satz nach dem Download doch noch (überlappend) abzuspielen
async function processQueue() {
    if (isSpeaking) return;
    isSpeaking = true;
    const myGen = generation;
    try {
        while (speakingQueue.length > 0 && myGen === generation) {
            const item = speakingQueue.shift();
            await item.ready;
            if (myGen !== generation) { discard(item); break; }
            if (item.error) { console.error('[TTS] preprocess error', item.error.message || item.error); continue; }
            try { await playItem(item); }
            catch (e) { console.error('[TTS] Audio error', e); }
        }
    } finally {
        if (myGen === generation) isSpeaking = false;
    }
}
