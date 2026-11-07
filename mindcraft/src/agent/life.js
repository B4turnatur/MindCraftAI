import { Vec3 } from 'vec3';
// Macht Miku lebendiger & menschlicher:
// - Meldet Schläge, Klauen, Kaputtmachen nur als Fakten - wie sie reagiert, entscheidet Miku selbst (Innenleben, inner_life.js)
// - Beschützt den Freund automatisch, wenn er von Monstern angegriffen wird
// - Erwidert den Minecraft-typischen Shift-Gruß (2x kurz ducken / sneaken) ohne LLM-Verzögerung
// - Merkt, wenn der Spieler ihr Items zuwirft, und reagiert darauf
// - Reagiert auf Tode und redet von selbst, wenn es länger still ist
// - Körpersprache (Freudenhüpfer bei Geschenk, betroffen wegschauen bei Schlag, agent.emote('nod'))
// - Kommentiert Regen, Sonnenauf-/untergang, Freund fast tot, Freund lange AFK (gemeinsame 4-min-Bremse)
// (Blick/Gesten/Hinsetzen im Leerlauf: Modi idle_staring + idle_fidget in modes.js)
import * as skills from './library/skills.js';
import * as world from './library/world.js';

const DROP_TTL_MS = 5 * 60e3;      // so lange merkt sie sich eigene fallen gelassene Items
const DROP_MAX = 200;
const PLACED_MAX = 2000;           // so viele selbst gesetzte Blöcke merkt sie sich
const DAMAGE_EVENT_COOLDOWN_MS = 20e3; // "Block kaputt gemacht" höchstens alle 20 s als Event (sonst nur Erlebnis)
const DAMAGE_RADIUS = 6;

/** Merkt sich Item-Entities, die Miku selbst gedroppt hat (Klau-Erkennung). */
export function createDropTracker(ttlMs = DROP_TTL_MS) {
    const drops = new Map();
    const prune = () => {
        const now = Date.now();
        for (const [id, d] of drops) if (now - d.at > ttlMs) drops.delete(id);
        while (drops.size > DROP_MAX) drops.delete(drops.keys().next().value);
    };
    return {
        markOwnDrop(entityId, itemName, isGift) { drops.set(entityId, { itemName, isGift: !!isGift, at: Date.now() }); prune(); },
        checkPickup(entityId) {
            prune();
            const d = drops.get(entityId);
            if (!d) return null;
            drops.delete(entityId);
            return { itemName: d.itemName, isGift: d.isGift };
        },
    };
}

const SWING_WINDOW_MS = 1500;   // Spieler muss kurz vorher zugeschlagen haben (sonst Explosion, Sand, Fackel...)
const OWN_DIG_WINDOW_MS = 3000;

/**
 * Wer hat den Block abgebaut? nearby: [{username, dist}], swings: {username: zeit}, ownDig: {key, at}|null.
 * Gibt den Namen zurück oder null (sie selbst, keiner hat geschlagen, zu weit weg).
 */
export function findBreaker(pos, nearby, swings, ownDig, now = Date.now()) {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    if (ownDig && ownDig.key === key && now - ownDig.at < OWN_DIG_WINDOW_MS) return null;
    const cands = nearby.filter(p => p.dist <= DAMAGE_RADIUS && now - (swings[p.username] || 0) < SWING_WINDOW_MS)
        .sort((a, b) => a.dist - b.dist);
    return cands[0]?.username ?? null;
}

/** Merkt sich Positionen von Blöcken, die Miku selbst gesetzt hat (Kaputtmach-Erkennung). */
export function createPlacedTracker(max = PLACED_MAX) {
    const set = new Set();
    const key = (p) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
    return {
        markPlaced(pos) {
            const k = key(pos);
            set.delete(k); set.add(k);
            while (set.size > max) set.delete(set.values().next().value);
        },
        wasPlaced(pos) { return set.has(key(pos)); },
        forget(pos) { set.delete(key(pos)); },
    };
}

const IDLE_MIN_MS = 4 * 60e3;            // frühestens so lange Stille, bevor sie von selbst redet
const IDLE_MAX_MS = 8 * 60e3;            // spätestens
const MOB_REACT_COOLDOWN_MS = 120e3;     // eigene Mob-Schaden-Reaktion höchstens alle 2 Minuten
const FRIEND_HURT_COOLDOWN_MS = 90e3;    // Kommentar, wenn der Freund gehauen wird, höchstens alle 90 s
const GIFT_COOLDOWN_MS = 30e3;           // Reaktion auf zugeworfene Items höchstens alle 30 s
const HIT_WINDOW_MS = 2 * 60e3;          // wie lange Schläge für Eskalation gezählt werden (2 min)
const FREE_AFTER_MS = 60e3;              // so lange untätig -> sucht sich selbst etwas zu tun
const FREE_COOLDOWN_MS = 5 * 60e3;       // höchstens alle 5 min so ein Anstoß (spart Abo-Limit)
const JOIN_GREET_COOLDOWN_MS = 10 * 60e3; // denselben Spieler höchstens alle 10 min begrüßen
// Welt-Reaktionen (Regen, Sonnenauf-/untergang, Freund fast tot, Freund lange AFK) - alle teilen sich eine Bremse
const WORLD_REACT_COOLDOWN_MS = 4 * 60e3; // höchstens 1 Welt-Kommentar alle 4 min (zusätzlich zur 30-s-Gesprächsbremse)
const WORLD_REACT_CHANCE = 0.6;           // nicht auf JEDEN Regen/Sonnenuntergang reagieren - wirkt sonst skriptig
const FRIEND_LOW_HP = 6;                  // Freund-Leben (von 20), ab dem sie besorgt reagiert
const FRIEND_AFK_COMMENT_MS = 5 * 60e3;   // Freund steht so lange still -> einmal kommentieren (idle_fidget setzt bot.friend_afk_since)
const EMOTE_COOLDOWN_MS = 4000;           // Körpersprache (hüpfen, nicken, zu Boden schauen) nicht öfter als alle 4 s

// Echtes Sehen
const LOOK_AROUND_EVERY_MS = 2 * 60e3;   // von selbst umschauen alle 2 min …
const LOOK_AROUND_MOVED = 48;            // … oder früher, wenn sie so weit an einen neuen Ort gekommen ist
const LOOK_AROUND_MIN_GAP_MS = 2 * 60e3; // aber nie öfter als alle 2 min (Kosten)
const BUILD_MIN_BLOCKS = 30;             // ab so vielen gesetzten Blöcken gilt es als "Bau" des Spielers
const BUILD_DONE_AFTER_MS = 45e3;        // so lange nichts mehr gesetzt -> Bau gilt als fertig
const BUILD_MAX_LOOK_DIST = 28;          // nur anschauen, wenn sie nah genug dran ist

// Merkt sich gesetzte Blöcke pro Spieler; finished() liefert fertige Bauten (genug Blöcke, eine Weile Ruhe) und vergisst sie.
export function createBuildWatcher(minBlocks = BUILD_MIN_BLOCKS, doneAfter = BUILD_DONE_AFTER_MS) {
    const builds = {}; // name -> { n, x, y, z (Summen), last }
    return {
        add(name, pos, now = Date.now()) {
            const b = builds[name] ||= { n: 0, x: 0, y: 0, z: 0, last: now };
            if (now - b.last > 3 * doneAfter) Object.assign(b, { n: 0, x: 0, y: 0, z: 0 }); // alter Rest verfällt
            b.n++; b.x += pos.x; b.y += pos.y; b.z += pos.z; b.last = now;
        },
        finished(now = Date.now()) {
            const out = [];
            for (const [name, b] of Object.entries(builds)) {
                if (now - b.last < doneAfter) continue;
                if (b.n >= minBlocks) out.push({ name, blocks: b.n, center: { x: b.x / b.n, y: b.y / b.n, z: b.z / b.n } });
                delete builds[name];
            }
            return out;
        },
    };
}

const randIdle = () => IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);

function isEntityCrouching(ent) {
    if (!ent) return false;
    if (ent.crouching) return true;
    const flags = ent.metadata?.[0];
    if (typeof flags === 'number' && (flags & 0x02) !== 0) return true;
    if (ent.metadata?.[6] === 5 || ent.metadata?.[6] === 'crouching') return true;
    return false;
}

export function startLife(agent) {
    const bot = agent.bot;
    let lastTalk = Date.now();
    let nextIdle = randIdle();
    let lastMobReact = 0;
    let lastFriendHurtReact = 0;
    let hits = [];
    let hitTimer = null;
    let lastDeathMsg = '', lastDeathTime = 0;
    let idleSince = 0, lastFree = 0;

    // Für Shift-Gruß (Crouch-Tap)
    let friendWasCrouching = false;
    let lastCrouchGreet = 0;

    // Für zugeworfene Items (Geschenke)
    let invSnapshot = {};
    let giftTimer = null;
    let lastGiftTime = 0;

    const updateInvSnapshot = () => {
        if (giftTimer) return; // Geschenk wird gerade ausgewertet -> Vergleichsbasis nicht überschreiben
        try { invSnapshot = world.getInventoryCounts(bot); } catch {}
    };

    // Alle Timer merken, damit beim Verbindungsende nichts mehr auf den toten Bot zugreift
    const intervals = [];
    let ended = false;
    const guarded = (fn) => () => {
        if (ended || !bot.entity) return;
        try { fn(); } catch (err) { console.error('[life]', err.message); }
    };
    const every = (ms, fn) => intervals.push(setInterval(guarded(fn), ms));
    const later = (ms, fn) => setTimeout(guarded(fn), ms);
    bot.once('end', () => {
        ended = true;
        intervals.forEach(clearInterval);
        clearTimeout(hitTimer); clearTimeout(giftTimer);
    });
    later(2000, updateInvSnapshot);

    // lowPriority: von selbst reden / eigene Projekte - nicht, während sie gerade noch antwortet (sonst 2 LLM-Runden parallel)
    const event = (text, lowPriority = false) => {
        if (lowPriority && agent.thinking > 0) return false;
        lastTalk = Date.now();
        agent.handleMessage('system', `[EVENT] ${text}`)
            .catch(err => console.error('[life] event error:', err?.message || err));
        return true;
    };
    const nearestFriend = () => bot.nearestEntity(e => e.type === 'player' && e.username !== bot.username);
    const busyNow = () => !agent.isIdle() && agent.actions.currentActionLabel !== 'action:followPlayer';
    const exp = (what, important = false) => { try { agent.inner?.addExperience(what, important); } catch {} };

    // Körpersprache ohne LLM: nur wenn sie nichts Wichtiges tut (frei oder beim Folgen), nie im Kampf/bei Aufgaben
    let lastEmote = 0;
    const emote = (kind) => {
        if (busyNow() || Date.now() - lastEmote < EMOTE_COOLDOWN_MS || bot.health <= 0) return;
        lastEmote = Date.now();
        const lock = (ms) => { bot.lookOverrideUntil = Date.now() + ms; }; // idle_staring hält solange still
        const baseYaw = bot.entity.yaw;
        const look = (dyaw, pitch) => bot.look(baseYaw + dyaw, pitch, false).catch(() => {});
        if (kind === 'happy') { // 2 Freudenhüpfer
            for (const t of [0, 450]) {
                later(t, () => bot.setControlState('jump', true));
                later(t + 250, () => bot.setControlState('jump', false));
            }
        } else if (kind === 'nod') { // Kopf nicken
            lock(1200);
            // mineflayer-pitch: positiv = hoch, negativ = runter
            [-0.5, 0.1, -0.5, 0].forEach((p, i) => later(i * 220, () => look(0, p)));
        } else if (kind === 'hurt') { // betroffen zu Boden / zur Seite schauen
            lock(1800);
            look((Math.random() < 0.5 ? -1 : 1) * 0.6, -0.9);
        } else if (kind === 'shake') { // Kopf schütteln
            lock(1200);
            [0.35, -0.35, 0.35, 0].forEach((d, i) => later(i * 200, () => look(d, 0)));
        }
    };
    agent.emote = emote; // z. B. agent.emote('nod') aus agent.js beim Zustimmen (life.js selbst nutzt happy/hurt)

    // Bei Tod ausstehende Schlag-Events abbrechen und Zähler zurücksetzen (verhindert Geister-Events nach Respawn)
    bot.on('death', () => {
        clearTimeout(hitTimer);
        hitTimer = null;
        hits = [];
    });

    // 1. Minecraft Shift-Gruß: Wenn der Freund in der Nähe (< 8 Blöcke) kurz duckt, duckt Miku 2x freundlich zurück
    every(200, () => {
        if (!agent.isIdle()) return;
        const friend = nearestFriend();
        if (!friend || friend.position.distanceTo(bot.entity.position) > 8) {
            friendWasCrouching = false;
            return;
        }
        const nowCrouching = isEntityCrouching(friend);
        if (nowCrouching && !friendWasCrouching && Date.now() - lastCrouchGreet > 6000) {
            lastCrouchGreet = Date.now();
            bot.lookAt(friend.position.offset(0, (friend.height || 1.8) * 0.9, 0)).catch(() => {});
            // 2x kurz Sneaken wie ein echter Minecraft-Spieler
            bot.setControlState('sneak', true);
            later(160, () => bot.setControlState('sneak', false));
            later(300, () => { if (agent.isIdle()) bot.setControlState('sneak', true); }); // Aktion gestartet -> nicht weiter ducken
            later(460, () => bot.setControlState('sneak', false));
        }
        friendWasCrouching = nowCrouching;
    });

    // 2. Zugeworfene Items erkennen (wenn der Spieler neben Miku steht und ihr etwas hinwirft)
    bot.on('playerCollect', (collector) => {
        if (collector !== bot.entity) return;
        const miningOrBusy = !agent.isIdle() && agent.actions.currentActionLabel !== 'action:followPlayer';
        const friend = nearestFriend();
        if (miningOrBusy || !friend || friend.position.distanceTo(bot.entity.position) > 7) {
            later(400, updateInvSnapshot);
            return;
        }
        clearTimeout(giftTimer);
        giftTimer = setTimeout(() => {
            giftTimer = null;
            if (!bot.entity) return;
            let nowInv;
            try { nowInv = world.getInventoryCounts(bot); } catch { return; }
            const gained = [];
            for (const [item, count] of Object.entries(nowInv)) {
                const diff = count - (invSnapshot[item] || 0);
                if (diff > 0) gained.push(`${diff}x ${item}`);
            }
            invSnapshot = nowInv;
            if (gained.length > 0 && Date.now() - lastGiftTime > GIFT_COOLDOWN_MS) {
                lastGiftTime = Date.now();
                emote('happy');
                exp(`${friend.username} hat mir ${gained.join(', ')} geschenkt`, true);
                event(`${friend.username} just tossed you ${gained.join(', ')}. React naturally in one short sentence `
                    + `(thank them if it's useful like food, tools or materials, or tease them if it's junk like dirt or rotten flesh).`);
            }
        }, 1200);
    });

    // 3. Schläge & Kämpfe (auf Miku ODER auf den Freund)
    bot.on('entityHurt', (entity, source) => {
        const now = Date.now();

        // Fall A: Dein Freund wird in deiner Nähe (< 20 Blöcke) von einem Monster angegriffen -> sofort helfen!
        if (entity?.type === 'player' && entity.username !== bot.username && source && source !== bot.entity && source.type !== 'player') {
            if (!bot.entity || bot.health <= 0) return;
            const dist = entity.position.distanceTo(bot.entity.position);
            if (dist <= 20) {
                const canHelp = agent.isIdle() || agent.actions.currentActionLabel === 'action:followPlayer';
                if (canHelp && source.isValid !== false) {
                    agent.actions.runAction('mode:protectFriend', async () => {
                        await skills.attackEntity(bot, source, true);
                    }).catch(err => console.error('[life] protectFriend:', err?.message || err));
                }
                if (now - lastFriendHurtReact > FRIEND_HURT_COOLDOWN_MS) {
                    lastFriendHurtReact = now;
                    const mobName = source.displayName || source.name || 'a monster';
                    event(`Your friend ${entity.username} is being attacked by ${mobName} (${Math.round(dist)}m away)! `
                        + `Say one short line (teasing them or telling them you've got their back). Do NOT use a command, you are already attacking it.`);
                }
            }
            return;
        }

        // Fall B: Miku selbst wird getroffen
        if (!bot.entity || entity !== bot.entity || bot.health <= 0) return;
        if (source?.type === 'player' && source.username !== bot.username) {
            if (hits.length === 0) emote('hurt'); // erster Schlag: kurz betroffen wegschauen
            hits.push(now);
            hits = hits.filter(t => now - t < HIT_WINDOW_MS);
            clearTimeout(hitTimer);
            hitTimer = setTimeout(() => {
                hitTimer = null;
                if (!bot.entity || bot.health <= 0) return;
                const burst = hits.filter(t => Date.now() - t < 4000).length;
                exp(`${source.username} hat mich ${burst}x geschlagen (${hits.length}x in den letzten 2 min)`, hits.length >= 5);
                event(`${source.username} just hit you ${burst} time(s) (${hits.length} time(s) in the last 2 minutes, your health ${Math.round(bot.health)}/20). `
                    + `How you react is completely up to you and your feelings.`);
            }, 1200);
        } else if (source && now - lastMobReact > MOB_REACT_COOLDOWN_MS) {
            lastMobReact = now;
            const name = source.displayName || source.name || 'something';
            event(`A ${name} just hurt you (health ${Math.round(bot.health)}/20). React with a very short spoken line. `
                + `Do NOT use any command, self-defense is automatic.`);
        }
    });

    bot.on('messagestr', (message, _pos, json) => {
        lastTalk = Date.now(); // jede Chatzeile zählt als "es wird geredet"
        if (json?.translate?.startsWith('death') && message.startsWith(bot.username)) {
            exp(`Ich bin gestorben: "${message}"`, true);
            return;
        }
        if (json?.translate?.startsWith('death') && !message.startsWith(bot.username)) {
            if (message === lastDeathMsg && Date.now() - lastDeathTime < 5000) return; // Server schickt Todesmeldung teils doppelt
            lastDeathMsg = message; lastDeathTime = Date.now();
            exp(`Todesmeldung: "${message}"`, true);
            event(`This death message just appeared: "${message}". React in character (dark humour welcome, but you do care about your friend).`);
        }
    });

    // Eigenes Leben: steht sie nur rum (keine Aktion, kein !goal), sucht sie sich selbst ein Projekt
    every(10e3, () => {
        const now = Date.now();
        updateInvSnapshot();
        const free = agent.isIdle() && !agent.self_prompter.isActive() && !agent.shut_up;
        if (!free) { idleSince = 0; return; }
        idleSince ||= now;
        if (now - idleSince < FREE_AFTER_MS || now - lastFree < FREE_COOLDOWN_MS || now - lastTalk < 30e3) return;
        const daytime = bot.time.timeOfDay < 12000 ? 'day' : 'night';
        const inner = agent.inner?.state;
        const text = inner?.project?.title
            ? `You have been standing around for a minute and nobody needs you right now (it is ${daytime}, health ${Math.round(bot.health)}/20, food ${Math.round(bot.food)}/20). `
                + `You want: ${inner.wants || '-'}. Your own project: ${inner.project.title} (plan: ${inner.project.plan || '-'}, done: ${inner.project.done || 'nothing yet'}). `
                + `Continue it now with !goal if it fits, or do something else you feel like. Only say something if it's worth saying (one short line), otherwise just act.`
            : `You have been standing around doing nothing for a minute and nobody needs you right now (it is ${daytime}, `
                + `health ${Math.round(bot.health)}/20, food ${Math.round(bot.food)}/20). Decide yourself what YOU want to do next `
                + `(your own project, preparing for the night, getting food or better tools, helping your friend's base...) and start it now - `
                + `for a bigger project use !goal. Only say something if it's worth saying (one short line), otherwise just act.`;
        if (!event(text, true)) return;
        lastFree = now; idleSince = 0;
    });

    // Von selbst reden, wenn lange Stille ist und der Freund in der Nähe ist
    every(10e3, () => {
        if (Date.now() - lastTalk < nextIdle || agent.shut_up) return;
        const busy = !agent.isIdle() && agent.actions.currentActionLabel !== 'action:followPlayer';
        if (busy) return; // nicht mitten in eine Aufgabe reinquatschen
        const friend = nearestFriend();
        if (!friend) return;
        const dist = Math.round(friend.position.distanceTo(bot.entity.position));
        if (dist > 32) return;
        const t = bot.time.timeOfDay;
        const daytime = t < 12000 ? 'day' : 'night';
        if (event(`Nobody has said anything for a while. ${friend.username} is ${dist} blocks away, it is ${daytime}`
            + `${bot.isRaining ? ' and raining' : ''}. Say something on your own like a real friend would: a thought, a joke, `
            + `a complaint, a comment about what you see or how you feel, or a question - or just start doing something you feel like. `
            + `Don't repeat earlier topics. Keep it short.`, true)) nextIdle = randIdle();
    });

    // Auf die Welt reagieren wie ein Mensch: Regen, Sonnenauf-/untergang, Freund fast tot, Freund lange AFK.
    // Alles über event(..., true) (normaler Sprechweg) + gemeinsame Bremse; nie während Aufgaben/Kampf.
    let lastWorldReact = 0;
    let wasRaining = null, lastPhase = null, friendLowWarned = false, afkCommentedFor = 0;
    const worldReact = (text, force = false) => {
        exp(text.split(/(?<=[.!])\s/)[0], false, 'world'); // nur der Fakt, ohne Anweisung ans Modell
        if (agent.shut_up || busyNow() || Date.now() - lastTalk < 30e3) return false;
        if (Date.now() - lastWorldReact < WORLD_REACT_COOLDOWN_MS) return false;
        if (!force && Math.random() > WORLD_REACT_CHANCE) return true; // bewusst übersprungen, Ereignis gilt als erledigt
        if (!event(text + ' One short spoken line, no command.', true)) return false;
        lastWorldReact = Date.now();
        return true;
    };
    every(5e3, () => {
        const friend = nearestFriend();
        if (!friend || friend.position.distanceTo(bot.entity.position) > 32) return;
        const t = bot.time.timeOfDay;
        const phase = t >= 12500 && t < 23000 ? 'night' : 'day';
        const raining = !!bot.isRaining;

        // Freund fast tot -> besorgt (unabhängig von der Zufalls-Chance; Gesprächsbremse gilt trotzdem)
        const hp = friend.health ?? friend.metadata?.[9];
        if (typeof hp === 'number' && hp > 0 && hp <= FRIEND_LOW_HP && !friendLowWarned) {
            if (worldReact(`${friend.username} is very low on health (${Math.round(hp)}/20)! Show you are worried and tell them to eat or back off.`, true))
                friendLowWarned = true;
        } else if (typeof hp === 'number' && hp > FRIEND_LOW_HP + 4) friendLowWarned = false;

        // Gebremst/beschäftigt -> Ereignis verfällt (ein Regen-Kommentar 4 min später wirkt falsch)
        if (wasRaining !== null && raining !== wasRaining)
            worldReact(raining ? 'It just started raining.' : 'The rain just stopped.');
        wasRaining = raining;
        if (lastPhase !== null && phase !== lastPhase)
            worldReact(phase === 'night' ? 'The sun is setting and night is coming (monsters soon).' : 'The sun is rising, the night is over.');
        lastPhase = phase;

        const afkSince = bot.friend_afk_since || 0;
        if (afkSince && afkSince !== afkCommentedFor && Date.now() - afkSince > FRIEND_AFK_COMMENT_MS) {
            if (worldReact(`${friend.username} has been standing completely still for ${Math.round((Date.now() - afkSince) / 60e3)} minutes (probably AFK). Tease them or ask if they're still there.`, true))
                afkCommentedFor = afkSince;
        }
    });

    // Klauen: Spieler hebt ein Item auf, das Miku selbst fallen gelassen hat (nicht beim Verschenken)
    const drops = createDropTracker();
    let lastTossAt = 0, lastTossGift = false;
    for (const fn of ['tossStack', 'toss']) {
        const orig = bot[fn]?.bind(bot);
        if (!orig) continue;
        bot[fn] = async (...args) => {
            lastTossAt = Date.now();
            lastTossGift = agent.actions?.currentActionLabel === 'action:givePlayer';
            return orig(...args);
        };
    }
    bot.on('entitySpawn', (e) => {
        if (e?.name !== 'item' || Date.now() - lastTossAt > 1500 || !bot.entity) return;
        if (e.position.distanceTo(bot.entity.position) > 3) return;
        const gift = lastTossGift;
        later(100, () => drops.markOwnDrop(e.id, e.getDroppedItem?.()?.name || 'item', gift));
    });
    bot.on('playerCollect', (collector, collected) => {
        if (!collector || collector === bot.entity || collector.type !== 'player' || !collected) return;
        const d = drops.checkPickup(collected.id);
        if (!d || d.isGift) return;
        exp(`${collector.username} hat mein ${d.itemName} genommen, das ich fallen gelassen hatte - ich hab es ihm NICHT gegeben`, true);
        event(`${collector.username} just picked up your ${d.itemName} that you had dropped (you did not give it to them).`);
    });

    // Kaputtmachen: Spieler baut einen Block ab, den Miku selbst gesetzt hat
    const placed = createPlacedTracker();
    let lastOwnPlace = 0;
    const origPlace = bot.placeBlock?.bind(bot);
    if (origPlace) bot.placeBlock = async (ref, face, ...rest) => {
        lastOwnPlace = Date.now();
        const r = await origPlace(ref, face, ...rest);
        try {
            const pos = ref.position.plus(face);
            placed.markPlaced(pos);
            (bot.placedLog ||= []).push({ pos, t: Date.now() });
            if (bot.placedLog.length > 500) bot.placedLog.splice(0, 100);
        } catch {}
        return r;
    };
    // Eigenes Abbauen merken (targetDigBlock ist beim blockUpdate schon null)
    let ownDig = null;
    const origDig = bot.dig?.bind(bot);
    if (origDig) bot.dig = async (block, ...rest) => {
        try { const p = block.position; ownDig = { key: `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`, at: Date.now() }; } catch {}
        const r = await origDig(block, ...rest);
        if (ownDig) ownDig.at = Date.now();
        return r;
    };
    const swings = {};
    bot.on('entitySwingArm', (e) => { if (e?.type === 'player' && e.username !== bot.username) swings[e.username] = Date.now(); });
    let lastDamageEvent = 0;
    bot.on('blockUpdate', (oldB, newB) => {
        if (!oldB || !newB || !bot.entity || newB.name !== 'air' || oldB.name === 'air') return;
        if (!placed.wasPlaced(oldB.position)) return;
        placed.forget(oldB.position);
        const nearby = Object.values(bot.players).filter(p => p.entity && p.username !== bot.username)
            .map(p => ({ username: p.username, dist: p.entity.position.distanceTo(oldB.position) }));
        const who = findBreaker(oldB.position, nearby, swings, ownDig);
        if (!who) return;
        exp(`${who} hat einen Block abgebaut, den ich gesetzt hatte (${oldB.name})`, true);
        if (Date.now() - lastDamageEvent < DAMAGE_EVENT_COOLDOWN_MS) return;
        lastDamageEvent = Date.now();
        event(`${who} just broke a block that YOU had placed (${oldB.name}).`);
    });

    // ---- Echtes Sehen ----
    const vision = () => agent.vision_interpreter;
    const canLook = () => !agent.shut_up && !busyNow() && !agent.thinking && vision()?.camera;

    // Von selbst umschauen: alle paar Minuten oder an einem neuen Ort; Auffälliges -> Erlebnis + evtl. Kommentar
    let lastLook = Date.now(), lastLookPos = null;
    every(30e3, async () => {
        if (!canLook()) return;
        const pos = bot.entity.position;
        const moved = lastLookPos ? pos.distanceTo(lastLookPos) : 0;
        const since = Date.now() - lastLook;
        if (since < LOOK_AROUND_MIN_GAP_MS || (since < LOOK_AROUND_EVERY_MS && moved < LOOK_AROUND_MOVED)) return;
        lastLook = Date.now(); lastLookPos = pos.clone();
        const seen = await vision().see('You glance around. Is there anything noteworthy here - a nice view, a structure, a cave, a village, '
            + 'interesting animals, danger, something someone built? Answer in ONE short sentence. If nothing is special, answer exactly: BORING',
            b => b.look(b.entity.yaw + (Math.random() - 0.5) * 2.5, -0.15, false));
        if (!seen || /^\W*BORING/i.test(seen)) return;
        worldReact(`I looked around and noticed: ${seen.split(/(?<=[.!?])\s/)[0]} Comment on it only if it is really worth it.`);
    });

    // Bauten des Freundes: Blöcke, die ein Spieler gerade gesetzt hat (Arm geschwungen, nah dran), sammeln
    const buildWatch = createBuildWatcher();
    bot.on('blockUpdate', (oldB, newB) => {
        if (!oldB || !newB || !bot.entity || newB.name === 'air' || !['air', 'cave_air', 'water'].includes(oldB.name)) return;
        if (Date.now() - lastOwnPlace < 1500 && newB.position.distanceTo(bot.entity.position) < 7) return; // war sie selbst
        const now = Date.now();
        for (const p of Object.values(bot.players)) {
            if (!p.entity || p.username === bot.username || now - (swings[p.username] || 0) > 1000) continue;
            if (p.entity.position.distanceTo(newB.position) > 6) continue;
            buildWatch.add(p.username, newB.position, now);
            break;
        }
    });
    every(15e3, async () => {
        for (const b of buildWatch.finished()) {
            const c = new Vec3(b.center.x, b.center.y, b.center.z);
            if (!canLook() || c.distanceTo(bot.entity.position) > BUILD_MAX_LOOK_DIST) continue; // verpasst -> nicht nachtragen
            const seen = await vision().see(`Your friend ${b.name} just built something here (about ${b.blocks} blocks, you are looking at its center). `
                + 'What is it, and what do you honestly think of it (style, size, materials, flaws)?', bb => bb.lookAt(c));
            if (!seen) continue;
            exp(`${b.name} hat etwas gebaut (ca. ${b.blocks} Blöcke bei x:${Math.round(c.x)} z:${Math.round(c.z)}) - ich hab es mir angesehen: ${seen}`, true);
            event(`${b.name} just finished building something (about ${b.blocks} blocks). You looked at it and saw: ${seen} `
                + 'Tell them your honest opinion in one or two short spoken lines like a friend (praise what is good, tease what is odd). No command.', true);
        }
    });

    // Begrüßt den Freund, wenn er (wieder) den Server betritt - "willkommen zurück" statt Stille
    const lastJoinGreet = {};
    const lifeStart = Date.now();
    bot.on('playerJoined', (player) => {
        const name = player?.username;
        if (!name || name === bot.username || agent.shut_up) return;
        if (Date.now() - lifeStart < 15e3) return; // Spielerliste beim eigenen Login nicht als "neu da" werten
        if (Date.now() - (lastJoinGreet[name] || 0) < JOIN_GREET_COOLDOWN_MS) return;
        lastJoinGreet[name] = Date.now();
        exp(`${name} ist auf den Server gekommen`, false, 'join');
        later(3000, () => event(`${name} just joined the server. Greet them in one short, natural line `
            + `(happy to see them, or tease them for being away). Do NOT use a command.`));
    });
}
