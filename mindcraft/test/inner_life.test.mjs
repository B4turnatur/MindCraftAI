// Tests für Mikus Innenleben. Start: node --test test/inner_life.test.mjs (aus mindcraft/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InnerLife, splitThought, parseReflection } from '../src/agent/inner_life.js';

const START = 'Ich bin neu hier und lerne meinen Freund gerade erst kennen.';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'il-'));
const mk = (dir = tmp(), extra = {}) => new InnerLife({ name: 'T', ...extra }, dir);

// ---- Task 1 ----
test('splitThought: einfacher Gedanke', () => {
    assert.deepEqual(splitThought('<think>Ernsthaft?</think> Ey!'), { thought: 'Ernsthaft?', rest: 'Ey!' });
});
test('splitThought: mehrere Blöcke, Groß/klein', () => {
    assert.deepEqual(splitThought('Hi <think>a</think> du <THINK>b</THINK>'), { thought: 'a b', rest: 'Hi du' });
});
test('splitThought: offenes think', () => {
    assert.deepEqual(splitThought('Hallo <think>geheim ohne ende'), { thought: 'geheim ohne ende', rest: 'Hallo' });
});
test('splitThought: ohne think', () => {
    assert.deepEqual(splitThought('nur text'), { thought: null, rest: 'nur text' });
});
test('Startzustand + Speichern/Laden', () => {
    const dir = tmp();
    const a = mk(dir); a.load();
    assert.equal(a.state.self, START);
    a.addThought('hallo du');
    const b = mk(dir); b.load();
    assert.equal(b.state.thoughts.at(-1).text, 'hallo du');
});
test('kaputte Datei wird umbenannt', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'inner_life.json'), '{kaputt');
    const a = mk(dir);
    assert.doesNotThrow(() => a.load());
    assert.equal(a.state.self, START);
    assert.ok(fs.readdirSync(dir).some(f => f.startsWith('inner_life.broken-')));
});
test('Grenzen', () => {
    const a = mk(); a.load();
    for (let i = 0; i < 10; i++) a.addThought('g' + i);
    assert.equal(a.state.thoughts.length, 8);
    assert.equal(a.state.thoughts[0].text, 'g2');
    for (let i = 0; i < 45; i++) a.addExperience('e' + i);
    assert.equal(a.state.experiences.length, 40);
    a.addThought('x'.repeat(500));
    assert.ok(a.state.thoughts.at(-1).text.length <= 200);
});
test('promptBlock zeigt nur letzte 3 Gedanken', () => {
    const a = mk(); a.load();
    ['eins', 'zwei', 'drei', 'vier'].forEach(t => a.addThought(t));
    const p = a.promptBlock();
    assert.ok(!p.includes('eins'));
    assert.ok(p.includes('zwei') && p.includes('vier'));
    assert.ok(p.includes('How you feel: ' + START));
});
test('knows: case-insensitive', () => {
    const a = mk(); a.load();
    a.state.self = 'x';
    a.addExperience('Steve hat mich geschlagen');
    assert.equal(a.knows('steve'), true);
    assert.equal(a.knows('Fremder'), false);
});
test('hasNewSinceReflection', () => {
    const a = mk(); a.load();
    assert.equal(a.hasNewSinceReflection(), false);
    a.addExperience('etwas');
    assert.equal(a.hasNewSinceReflection(), true);
});

// ---- Task 2 ----
const GOOD = JSON.stringify({ self: 'Mir geht es gut.', about_friend: 'Er ist frech.', wants: 'Haus bauen.',
    project: { title: 'Haus am See', plan: '1. Holz 2. Bauen', done: '' }, milestones_new: ['Erster Diamant'], experiences_summary: 'Wir haben gespielt.' });
const withModel = (fn) => {
    const calls = { n: 0 };
    const agent = { prompter: { profile: { reflecting: 'R $NAME $INNER_STATE $NEW_EXPERIENCES $THOUGHTS $MEMORY' },
        chat_model: { sendRequest: async (...a) => { calls.n++; return fn(...a); } } } };
    const il = mk(tmp(), agent); il.load();
    return { il, calls };
};
test('parseReflection', () => {
    assert.deepEqual(parseReflection('```json\n{"self":"ok"}\n```'), { self: 'ok' });
    assert.deepEqual(parseReflection('Klar! {"self":"a"} fertig'), { self: 'a' });
    assert.equal(parseReflection('kein json'), null);
    assert.equal(parseReflection('{"self":""}'), null);
});
test('reflect übernimmt gültige Antwort', async () => {
    const { il } = withModel(async () => GOOD);
    il.addExperience('a'); il.addExperience('b');
    assert.equal(await il.reflect(), true);
    assert.equal(il.state.self, 'Mir geht es gut.');
    assert.equal(il.state.milestones.at(-1).text, 'Erster Diamant');
    assert.equal(il.state.experiences.length, 1);
    assert.match(il.state.experiences[0].what, /Wir haben gespielt/);
    assert.ok(il.state.last_reflection > 0);
});
test('reflect mit Müll ändert nichts', async () => {
    const { il } = withModel(async () => 'Müll');
    il.addExperience('a');
    const before = structuredClone(il.state);
    assert.equal(await il.reflect(), false);
    assert.deepEqual(il.state, before);
});
test('Erlebnis während Reflexion bleibt erhalten', async () => {
    let il;
    ({ il } = withModel(async () => { await new Promise(r => setTimeout(r, 50)); return GOOD; }));
    il.addExperience('alt');
    const p = il.reflect();
    await new Promise(r => setTimeout(r, 10));
    il.addExperience('neu');
    await p;
    assert.ok(il.state.experiences.some(e => e.what === 'neu'));
    assert.ok(!il.state.experiences.some(e => e.what === 'alt'));
    assert.equal(il.hasNewSinceReflection(), true);
});
test('keine parallele Reflexion', async () => {
    const { il, calls } = withModel(async () => { await new Promise(r => setTimeout(r, 30)); return GOOD; });
    il.addExperience('a');
    const [a, b] = await Promise.all([il.reflect(), il.reflect()]);
    assert.equal(a, true); assert.equal(b, false); assert.equal(calls.n, 1);
});
test('zu langes self wird gekürzt', async () => {
    const { il } = withModel(async () => JSON.stringify({ self: 'x'.repeat(1000) }));
    il.addExperience('a');
    await il.reflect();
    assert.ok(il.state.self.length <= 400);
});

// ---- Task 3 ----
test('cleanForSpeech liest keine Gedanken vor', async () => {
    const { cleanForSpeech } = await import('../src/agent/speak.js');
    const a = cleanForSpeech('<think>geheim</think> Hallo');
    assert.ok(!/geheim|think/i.test(a), a);
    assert.equal(cleanForSpeech('Hallo <think>offen').trim(), 'Hallo');
});
test('agent.js lässt sich importieren', async () => {
    await import('../src/agent/agent.js');
});

// ---- Task 4 ----
test('createDropTracker', async () => {
    const { createDropTracker } = await import('../src/agent/life.js');
    const d = createDropTracker();
    d.markOwnDrop(5, 'diamond', false);
    assert.deepEqual(d.checkPickup(5), { itemName: 'diamond', isGift: false });
    assert.equal(d.checkPickup(5), null);
    assert.equal(d.checkPickup(99), null);
    const short = createDropTracker(10);
    short.markOwnDrop(1, 'x', false);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(short.checkPickup(1), null);
});
test('createPlacedTracker', async () => {
    const { createPlacedTracker } = await import('../src/agent/life.js');
    const p = createPlacedTracker();
    p.markPlaced({ x: 1.2, y: 64, z: -3.7 });
    assert.equal(p.wasPlaced({ x: 1, y: 64, z: -4 }), true);
    p.forget({ x: 1, y: 64, z: -4 });
    assert.equal(p.wasPlaced({ x: 1, y: 64, z: -4 }), false);
    const small = createPlacedTracker(2);
    [1, 2, 3].forEach(x => small.markPlaced({ x, y: 0, z: 0 }));
    assert.equal(small.wasPlaced({ x: 1, y: 0, z: 0 }), false);
    assert.equal(small.wasPlaced({ x: 3, y: 0, z: 0 }), true);
});
test('Schlag-Event zwingt nicht mehr zum Zurückschlagen', () => {
    const src = fs.readFileSync(new URL('../src/agent/life.js', import.meta.url), 'utf8');
    assert.ok(!src.includes('fight back'));
    assert.ok(!src.includes('!punch("${'));
    assert.ok(!src.includes('!attackPlayer("${'));
});

// ---- Task 5 ----
test('mayAttackPlayer: Fremden-Sperre', async () => {
    const { mayAttackPlayer } = await import('../src/agent/commands/actions.js');
    assert.equal(mayAttackPlayer({ inner: { knows: n => n === 'Steve' } }, 'Steve'), true);
    assert.equal(mayAttackPlayer({ inner: { knows: n => n === 'Steve' } }, 'Fremder'), false);
    assert.equal(mayAttackPlayer({}, 'X'), true);
});
test('Prompt: freier Wille statt Zurückschlag-Pflicht', () => {
    const p = JSON.parse(fs.readFileSync(new URL('../profiles/miku.json', import.meta.url), 'utf8'));
    assert.ok(!p.conversing.includes('fight them for real with !attackPlayer'));
    assert.ok(!p.conversing.includes('If they hit you a couple times, hit back with !punch'));
    assert.ok(p.conversing.includes('You decide yourself'));
});

// ---- Task 6 (Probe-Befund) ----
test('splitThought versteht auch <thought>', () => {
    assert.deepEqual(splitThought('<thought>Drittes Mal!</thought> Ey! !punch("Steve", 2)'),
        { thought: 'Drittes Mal!', rest: 'Ey! !punch("Steve", 2)' });
    assert.deepEqual(splitThought('Na <thought>offen'), { thought: 'offen', rest: 'Na' });
});
test('promptConvo schneidet Gedanken nicht mehr ab', () => {
    const src = fs.readFileSync(new URL('../src/models/prompter.js', import.meta.url), 'utf8');
    const convo = src.slice(src.indexOf('async promptConvo'), src.indexOf('async promptCoding'));
    assert.ok(!convo.includes("split('</think>')"));
});

// ---- Final-Review-Fixes ----
test('Fix 3: verwaistes </think> schluckt die Begründung davor', () => {
    assert.deepEqual(splitThought('ich überlege kurz</think> Hallo!'), { thought: 'ich überlege kurz', rest: 'Hallo!' });
});
test('Fix 2: doppeltes Erlebnis direkt hintereinander wird nicht gespeichert', () => {
    const a = mk(); a.load();
    a.addExperience('wichtig: Diamant geklaut', true);
    for (let i = 0; i < 50; i++) a.addExperience('Freund ist AFK');
    assert.equal(a.state.experiences.length, 2);
    assert.ok(a.state.experiences.some(e => e.what.includes('Diamant')));
});
test('Fix 4: Join/Welt-Erlebnisse machen niemanden bekannt, Wortgrenzen', () => {
    const a = mk(); a.load();
    a.state.self = 'x';
    a.addExperience('Griefer123 ist auf den Server gekommen', false, 'join');
    assert.equal(a.knows('Griefer123'), false);
    a.addExperience('Steve hat mich geschlagen');
    assert.equal(a.knows('Steve'), true);
    assert.equal(a.knows('Ste'), false);
});
test('Fix 1: findBreaker beschuldigt nur, wer kurz vorher geschwungen hat, nie bei eigenem Abbau', async () => {
    const { findBreaker } = await import('../src/agent/life.js');
    const pos = { x: 0, y: 64, z: 0 };
    const near = [{ username: 'Steve', dist: 3 }];
    const now = 10_000;
    assert.equal(findBreaker(pos, near, { Steve: now - 500 }, null, now), 'Steve');
    assert.equal(findBreaker(pos, near, {}, null, now), null);                            // kein Schlag → Explosion/Sand
    assert.equal(findBreaker(pos, near, { Steve: now - 5000 }, null, now), null);    // Schlag zu lange her
    assert.equal(findBreaker(pos, near, { Steve: now - 500 }, { key: '0,64,0', at: now - 300 }, now), null); // sie selbst
    assert.equal(findBreaker(pos, [{ username: 'Steve', dist: 9 }], { Steve: now - 500 }, null, now), null);
});
