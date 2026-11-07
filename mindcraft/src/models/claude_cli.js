import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import os from 'os';
import path from 'path';

// Nutzt das Claude-Abo über die Claude-Code-CLI statt eines API-Keys.
// Profil: "model": "claude-cli/sonnet" (oder haiku, opus, volle Modell-ID).
// Voraussetzung: einmal "claude auth login" im Terminal.
//
// Dauer-Modus: EIN claude-Prozess bleibt offen (stream-json über stdin/stdout), damit nicht jede
// Antwort die CLI neu starten muss. Weil Mindcraft jedes Mal den kompletten Spielstand schickt,
// wächst der Verlauf im Prozess -> nach RESTART_EVERY Anfragen wird er gegen einen frischen,
// schon vorgewärmten Prozess getauscht (Mikus Gedächtnis liegt in Mindcraft, geht also nicht verloren).
const RESTART_EVERY = 12;
const TIMEOUT_MS = 120000;
const WORKERS = 2; // 2 Prozesse: Gedächtnis-Zusammenfassung blockiert nicht Mikus nächste Antwort

const SYSTEM = 'You are the brain of a Minecraft bot. Every user message is fully self-contained: it holds the '
    + 'instructions for this turn inside <instructions> and the conversation inside <conversation>. Ignore all '
    + 'earlier messages, follow only the newest <instructions>, and output ONLY the bot\'s next reply text.';

export class ClaudeCLI {
    static prefix = 'claude-cli';
    constructor(model_name, url, params) {
        this.model_name = model_name || 'sonnet';
        this.params = params || {};
        this.cmd = process.env.MIKU_CLAUDE_CMD ? JSON.parse(process.env.MIKU_CLAUDE_CMD) : ['claude']; // für Tests
        this.cwd = path.join(os.tmpdir(), 'miku-cli'); // leerer Ordner -> keine Projekt-CLAUDE.md
        mkdirSync(this.cwd, { recursive: true });
        // pro Prozess eine Warteschlange (ein Prozess kann nur eine Anfrage gleichzeitig); 2. Prozess startet erst bei Bedarf
        this.slots = Array.from({ length: WORKERS }, () => ({ proc: null, queue: Promise.resolve(), busy: 0 }));
    }

    spawnProc() {
        const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
            '--model', this.model_name, '--tools', '', '--setting-sources', '', '--strict-mcp-config',
            '--no-session-persistence', '--system-prompt', SYSTEM];
        if (this.params.effort) args.push('--effort', this.params.effort);
        // Variablen einer umgebenden Claude-Code-Sitzung nicht weiterreichen (eigener Login zählt)
        const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
            !k.startsWith('CLAUDE_CODE_') && !k.startsWith('CLAUDE_AGENT_SDK') && k !== 'CLAUDECODE' && k !== 'ANTHROPIC_BASE_URL'));

        const p = spawn(this.cmd[0], [...this.cmd.slice(1), ...args], { cwd: this.cwd, env, windowsHide: true });
        const st = { p, used: 0, pending: null, buf: '', err: '', dead: false };
        p.stdout.setEncoding('utf8');
        p.stdout.on('data', d => {
            st.buf += d;
            let i;
            while ((i = st.buf.indexOf('\n')) >= 0) {
                const line = st.buf.slice(0, i).trim();
                st.buf = st.buf.slice(i + 1);
                if (!line) continue;
                let msg;
                try { msg = JSON.parse(line); } catch { continue; }
                if (msg.type === 'result' && st.pending) {
                    const { resolve, reject } = st.pending;
                    st.pending = null;
                    if (msg.is_error || msg.subtype !== 'success') reject(new Error(msg.result || msg.subtype));
                    else resolve(msg.result ?? '');
                }
            }
        });
        p.stderr.on('data', d => st.err += d);
        const die = (why) => {
            st.dead = true;
            if (st.pending) { st.pending.reject(new Error(why)); st.pending = null; }
        };
        p.on('error', e => die(e.message));
        p.on('close', code => die(`claude exit ${code}: ${st.err.trim().slice(-500)}`));
        return st;
    }

    ask(slot, text) {
        if (!slot.proc || slot.proc.dead) slot.proc = this.spawnProc();
        const st = slot.proc;
        st.used++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { st.p.kill(); reject(new Error('claude timeout')); }, TIMEOUT_MS);
            st.pending = {
                resolve: v => { clearTimeout(timer); resolve(v); },
                reject: e => { clearTimeout(timer); reject(e); },
            };
            st.p.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
        }).finally(() => {
            if (st.used >= RESTART_EVERY && !st.dead) {
                st.p.stdin.end(); // alten Prozess sauber beenden ...
                slot.proc = this.spawnProc(); // ... und den nächsten schon vorwärmen
            }
        });
    }

    async sendRequest(turns, systemMessage) {
        const convo = turns.map(t => `[${t.role}]: ${typeof t.content === 'string' ? t.content : JSON.stringify(t.content)}`).join('\n\n');
        // Wenn turns leer ist (z. B. promptMemSaving oder promptShouldRespondToBot), ist es eine neutrale
        // System-Aufgabe und KEINE Rollenspiel-Antwort an den Spieler (verhindert In-Character-Verweigerung).
        const text = turns.length > 0
            ? `<instructions>\n${systemMessage || ''}\n</instructions>\n\n<conversation>\n${convo}\n</conversation>\n\nWrite ONLY your next reply as the assistant.`
            : `<instructions>\nSYSTEM META-TASK — DO NOT ROLEPLAY, DO NOT ADDRESS ANY PLAYER, IGNORE ANY PREVIOUS ARGUMENT IN THIS SESSION.\n${systemMessage || ''}\n</instructions>\n\n<conversation>\n(no conversation — execute the meta-task above objectively and output ONLY the raw result text)\n</conversation>`;
        console.log(`Awaiting claude-cli response from ${this.model_name}...`);
        const slot = this.slots.reduce((a, b) => (b.busy < a.busy ? b : a)); // freiester Prozess
        slot.busy++;
        const run = slot.queue.then(() => this.ask(slot, text));
        slot.queue = run.catch(() => {});
        try {
            const res = (await run).trim();
            console.log('Received.');
            return res;
        } catch (e) {
            console.error('[claude-cli]', e.message);
            return 'My brain disconnected, try again.';
        } finally {
            slot.busy--;
        }
    }

    async sendVisionRequest(turns, systemMessage) {
        return this.sendRequest(turns, systemMessage); // ponytail: kein Bild-Input über die CLI
    }

    async embed(text) {
        throw new Error('Embeddings are not supported by claude-cli.'); // Mindcraft nutzt dann Wort-Überlappung
    }

    close() {
        for (const s of this.slots) s.proc?.p.stdin.end();
    }
}

// Selbsttest: node src/models/claude_cli.js   -> 3 Anfragen, zeigt Antwortzeiten
if (process.argv[1] && process.argv[1].endsWith('claude_cli.js')) {
    const m = new ClaudeCLI(process.argv[2] || 'haiku');
    let ok = true;
    for (const q of ['Hallo Miku!', 'Was ist dein Lieblingsessen?', 'Sag tschüss.']) {
        const t0 = Date.now();
        const r = await m.sendRequest([{ role: 'user', content: `Spieler: ${q}` }],
            'You are Miku. Answer in German in one short sentence.');
        console.log(`→ "${r}" (${Date.now() - t0} ms)`);
        if (!r || r.startsWith('My brain')) { ok = false; break; }
    }
    m.close();
    process.exit(ok ? 0 : 1);
}
