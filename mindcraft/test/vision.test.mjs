// node --test test/vision.test.mjs  – Echtes Sehen (ohne Minecraft, ohne echte API)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createBuildWatcher } from '../src/agent/life.js';
import { VisionInterpreter } from '../src/agent/vision/vision_interpreter.js';
import { LOOK_REQUEST } from '../src/agent/agent.js';

test('Bau gilt erst ab genug Blöcken und nach Ruhe als fertig', () => {
    const w = createBuildWatcher(3, 1000);
    w.add('Steve', { x: 0, y: 64, z: 0 }, 0);
    w.add('Steve', { x: 2, y: 64, z: 0 }, 100);
    assert.deepEqual(w.finished(500), []);           // noch zu wenig + zu früh
    w.add('Steve', { x: 4, y: 67, z: 3 }, 200);
    assert.deepEqual(w.finished(800), []);           // genug Blöcke, aber baut noch
    const [b] = w.finished(1300);
    assert.equal(b.name, 'Steve');
    assert.equal(b.blocks, 3);
    assert.deepEqual(b.center, { x: 2, y: 65, z: 1 });
    assert.deepEqual(w.finished(5000), []);          // danach vergessen
});

test('kleine Bauten werden nach Ruhe verworfen', () => {
    const w = createBuildWatcher(3, 1000);
    w.add('Alex', { x: 0, y: 0, z: 0 }, 0);
    assert.deepEqual(w.finished(2000), []);
    w.add('Alex', { x: 0, y: 0, z: 0 }, 2100);
    w.add('Alex', { x: 0, y: 0, z: 0 }, 2200);
    assert.deepEqual(w.finished(2300), []);           // alter Block zählt nicht mit
});

test('Zuruf-Erkennung DE/EN', () => {
    for (const t of ['Schau mal hier', 'wie findest du mein Haus?', 'look at this', 'Was ist das da?', 'guck mal Miku'])
        assert.ok(LOOK_REQUEST.test(t), t);
    for (const t of ['see you later', 'Hol mal Holz', 'Ich hab das gesehen', 'Was machst du'])
        assert.ok(!LOOK_REQUEST.test(t), t);
});

function fakeVision(reply) {
    const fp = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-'));
    const calls = [];
    const agent = { name: 'Miku', bot: {}, prompter: { vision_model: { sendVisionRequest: async (turns, prompt) => { calls.push(prompt); return reply; } } } };
    const v = new VisionInterpreter(agent, false); // false: keine echte Kamera bauen
    v.allow_vision = true; v.fp = fp;
    v.camera = { capture: async () => { fs.writeFileSync(path.join(fp, 'x.jpg'), 'jpg'); return 'x'; } };
    return { v, calls, fp };
}

test('see(): fragt mit eigener Frage, löscht das Bild, kein Doppel-Blick', async () => {
    const { v, calls, fp } = fakeVision('A small oak hut.');
    let aimed = false;
    const [a, b] = await Promise.all([v.see('What is this?', async () => { aimed = true; }), v.see('second')]);
    assert.equal(a, 'A small oak hut.');
    assert.equal(b, null);                            // läuft schon -> nicht parallel
    assert.ok(aimed);
    assert.match(calls[0], /What is this\?/);
    await new Promise(r => setTimeout(r, 50));
    assert.ok(!fs.existsSync(path.join(fp, 'x.jpg')));
});

test('see(): ohne Vision-Modell null statt Absturz', async () => {
    const { v } = fakeVision('x');
    v.agent.prompter.vision_model = {};
    assert.equal(await v.see('?'), null);
});
