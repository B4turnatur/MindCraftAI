// Mikus Innenleben: Erlebnisse -> private Gedanken -> Reflexion. Nur Text, keine Zahlen.
// Datei: bots/<name>/inner_life.json. Spec: docs/superpowers/specs/2026-11-07-innenleben-design.md
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const START_SELF = 'Ich bin neu hier und lerne meinen Freund gerade erst kennen.';
const MAX_THOUGHTS = 8, MAX_EXPERIENCES = 40, MAX_MILESTONES = 30;
const MAX_SELF = 400, MAX_WANTS = 200, MAX_THOUGHT = 200;
const PROMPT_THOUGHTS = 3;

const clip = (s, n) => {
    s = String(s ?? '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

const defaults = () => ({
    self: START_SELF, about_friend: '', wants: '',
    project: { title: '', plan: '', done: '' },
    thoughts: [], experiences: [], milestones: [],
    last_reflection: 0,
});

/** Trennt alle <thought>…</thought>- (und <think>…</think>-) Blöcke ab. Ein offenes Tag ohne Ende schluckt den Rest. */
export function splitThought(text) {
    const parts = [];
    let rest = String(text ?? '');
    // Verwaistes </think> ohne Anfang (Reasoning-Modelle): alles davor ist Gedanke, nicht Antwort
    const close = rest.search(/<\/(thought|think)>/i), firstOpen = rest.search(/<(thought|think)>/i);
    if (close !== -1 && (firstOpen === -1 || close < firstOpen)) {
        parts.push(rest.slice(0, close).trim());
        rest = rest.slice(close).replace(/<\/(thought|think)>/i, ' ');
    }
    rest = rest
        .replace(/<(thought|think)>([\s\S]*?)<\/\1>/gi, (_, _tag, t) => { parts.push(t.trim()); return ' '; });
    const open = rest.search(/<(thought|think)>/i);
    if (open !== -1) {
        parts.push(rest.slice(open).replace(/<(thought|think)>/i, '').trim());
        rest = rest.slice(0, open);
    }
    rest = rest.replace(/<\/(thought|think)>/gi, ' ').replace(/[ \t]+/g, ' ').trim();
    const thought = parts.filter(Boolean).join(' ').trim();
    return { thought: thought || null, rest };
}

/** Erstes {...} aus der Modellantwort (auch in ```-Zaun). Gültig nur mit nicht-leerem `self`. */
export function parseReflection(text) {
    const s = String(text ?? '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a === -1 || b <= a) return null;
    try {
        const obj = JSON.parse(s.slice(a, b + 1));
        return obj && typeof obj.self === 'string' && obj.self.trim() ? obj : null;
    } catch { return null; }
}

const REFLECT_INTERVAL_MS = 25 * 60e3;
const REFLECT_ON_START_DELAY_MS = 30e3;

export class InnerLife {
    constructor(agent, dir = `./bots/${agent.name}`) {
        this.agent = agent;
        this.dir = dir;
        this.fp = path.join(dir, 'inner_life.json');
        this.state = defaults();
        this.reflecting = false;
        this.timers = [];
    }

    load() {
        if (!existsSync(this.fp)) { this.state = defaults(); return; }
        try {
            const data = JSON.parse(readFileSync(this.fp, 'utf8'));
            this.state = { ...defaults(), ...data, project: { ...defaults().project, ...(data.project || {}) } };
            for (const k of ['thoughts', 'experiences', 'milestones'])
                if (!Array.isArray(this.state[k])) this.state[k] = [];
        } catch (err) {
            console.warn('[inner] inner_life.json kaputt, starte neu:', err.message);
            try { renameSync(this.fp, path.join(this.dir, `inner_life.broken-${Date.now()}.json`)); } catch {}
            this.state = defaults();
        }
    }

    save() {
        try {
            mkdirSync(this.dir, { recursive: true });
            const tmp = this.fp + '.tmp';
            writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
            renameSync(tmp, this.fp);
        } catch (err) { console.warn('[inner] save failed:', err.message); }
    }

    /** kind: '' (normal) | 'join' | 'world' – join/world machen niemanden "bekannt" (Fremden-Sperre). */
    addExperience(what, important = false, kind = '') {
        if (!what) return;
        what = clip(what, 300);
        const last = this.state.experiences.at(-1);
        if (last && last.what === what) return; // gleiches Ereignis direkt nochmal (z. B. AFK alle 5 s) nicht stapeln
        this.state.experiences.push({ t: now(), ts: Date.now(), what, important: !!important, ...(kind ? { kind } : {}) });
        if (this.state.experiences.length > MAX_EXPERIENCES)
            this.state.experiences.splice(0, this.state.experiences.length - MAX_EXPERIENCES);
        this.save();
    }

    addThought(text) {
        text = clip(text, MAX_THOUGHT);
        if (!text) return;
        this.state.thoughts.push({ t: now(), ts: Date.now(), text });
        if (this.state.thoughts.length > MAX_THOUGHTS)
            this.state.thoughts.splice(0, this.state.thoughts.length - MAX_THOUGHTS);
        this.save();
    }

    hasNewSinceReflection() {
        const since = this.state.last_reflection || 0;
        return this.state.experiences.some(e => (e.ts || 0) > since) || this.state.thoughts.some(t => (t.ts || 0) > since);
    }

    knows(name) {
        if (!name) return false;
        const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${esc}($|[^\\p{L}\\p{N}_])`, 'iu'); // ganzes Wort, kein "Ste" in "Steve"
        const s = this.state;
        return [s.self, s.about_friend, ...s.experiences.filter(e => !e.kind).map(e => e.what), ...s.milestones.map(m => m.text), ...s.thoughts.map(t => t.text)]
            .some(x => re.test(String(x || '')));
    }

    async reflect() {
        if (this.reflecting) return false;
        const template = this.agent.prompter?.profile?.reflecting;
        const model = this.agent.prompter?.chat_model;
        if (!template || !model) return false;
        this.reflecting = true;
        const start = Date.now();
        try {
            const s = this.state, since = s.last_reflection || 0;
            const fresh = s.experiences.filter(e => (e.ts || 0) > since);
            const prompt = template
                .replaceAll('$NAME', this.agent.name ?? 'Miku')
                .replaceAll('$INNER_STATE', JSON.stringify({ self: s.self, about_friend: s.about_friend, wants: s.wants, project: s.project, milestones: s.milestones }))
                .replaceAll('$NEW_EXPERIENCES', fresh.map(e => `${e.t} – ${e.what}`).join('\n') || '(none)')
                .replaceAll('$THOUGHTS', s.thoughts.filter(t => (t.ts || 0) > since).map(t => t.text).join(' | ') || '(none)')
                .replaceAll('$MEMORY', this.agent.history?.memory ?? '');
            const r = parseReflection(await model.sendRequest([], prompt));
            if (!r) { console.warn('[inner] reflection failed: no valid JSON'); return false; }
            s.self = clip(r.self, MAX_SELF);
            if (typeof r.about_friend === 'string') s.about_friend = clip(r.about_friend, MAX_SELF);
            if (typeof r.wants === 'string') s.wants = clip(r.wants, MAX_WANTS);
            if (r.project && typeof r.project === 'object')
                s.project = { title: clip(r.project.title, 120), plan: clip(r.project.plan, 300), done: clip(r.project.done, 200) };
            for (const m of Array.isArray(r.milestones_new) ? r.milestones_new : [])
                if (typeof m === 'string' && m.trim()) s.milestones.push({ t: now().slice(0, 10), text: clip(m, 200) });
            if (s.milestones.length > MAX_MILESTONES) s.milestones.splice(0, s.milestones.length - MAX_MILESTONES);
            if (typeof r.experiences_summary === 'string' && r.experiences_summary.trim()) {
                const later = s.experiences.filter(e => (e.ts || 0) > start); // kamen während der Reflexion
                s.experiences = [{ t: now(), ts: start, what: 'Zusammenfassung: ' + clip(r.experiences_summary, 300), important: false }, ...later];
            }
            s.last_reflection = start;
            this.save();
            return true;
        } catch (err) {
            console.warn('[inner] reflection failed:', err?.message || err);
            return false;
        } finally { this.reflecting = false; }
    }

    start(intervalMs = REFLECT_INTERVAL_MS) {
        this.stop();
        const run = () => { if (this.hasNewSinceReflection()) this.reflect(); };
        this.timers.push(setInterval(run, intervalMs));
        if (this.hasNewSinceReflection()) this.timers.push(setTimeout(run, REFLECT_ON_START_DELAY_MS));
    }

    stop() {
        this.timers.forEach(t => { clearInterval(t); clearTimeout(t); });
        this.timers = [];
    }

    promptBlock() {
        const s = this.state, lines = [];
        if (s.self) lines.push('How you feel: ' + s.self);
        if (s.about_friend) lines.push('What you think of your friend: ' + s.about_friend);
        if (s.wants) lines.push('What you want: ' + s.wants);
        if (s.project?.title) lines.push(`Your own project: ${s.project.title} – plan: ${s.project.plan || '?'} – done: ${s.project.done || 'nothing yet'}`);
        const th = s.thoughts.slice(-PROMPT_THOUGHTS).map(t => `"${t.text}"`);
        if (th.length) lines.push('Your recent private thoughts: ' + th.join(' | '));
        return lines.join('\n');
    }
}

export const _limits = { MAX_SELF, MAX_WANTS, MAX_MILESTONES, clip, now };
