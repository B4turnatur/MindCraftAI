// Neue Skills (companion). Werden über skills.js re-exportiert → im Code-Modus als skills.<name> verfügbar.
// Nur Funktionen exportieren, keine Top-Level-Aufrufe von skills.* (zirkulärer Import).
import * as skills from './skills.js';
import * as world from './world.js';
import * as mc from '../../utils/mcdata.js';
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';

const RANGED_MOBS = ['skeleton', 'stray', 'bogged', 'pillager', 'witch', 'blaze', 'ghast', 'breeze', 'drowned'];
// neutrale Mobs nicht von selbst angreifen (würde sie wütend machen), Haustiere/Freunde nie
const NEVER_TARGET = ['enderman', 'zombified_piglin', 'piglin', 'wolf', 'cat', 'parrot', 'horse', 'donkey', 'mule',
    'llama', 'fox', 'axolotl', 'iron_golem', 'snow_golem', 'villager', 'wandering_trader', 'allay'];
const BAD_FOOD = ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken', 'suspicious_stew'];
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- reine Logik (ohne bot, testbar) ----------

export function isCombatTarget(entity) {
    /** true wenn das Entity ein Feind ist, den Miku bekämpfen darf (nie Spieler, Haustiere, neutrale Mobs). */
    if (!entity || entity.type === 'player' || NEVER_TARGET.includes(entity.name)) return false;
    return mc.isHostile(entity);
}

export function isCreeperFusing(entity) {
    // Creeper-Metadaten (1.21-Layout: 16 = Zustand -1/1, 18 = gezündet); Index kann sich ändern -> Distanz als Fallback
    return entity?.name === 'creeper' && (entity.metadata?.[16] === 1 || entity.metadata?.[18] === true);
}

export function threatScore(entity, botPos, playerPositions = []) {
    /** Je höher, desto dringender. Creeper > Fernkämpfer > Rest, näher = gefährlicher, nahe am Spieler = Bonus. */
    const d = entity.position.distanceTo(botPos);
    let score = entity.name === 'creeper' ? 100 : RANGED_MOBS.includes(entity.name) ? 60 : 40;
    if (isCreeperFusing(entity)) score += 100;
    score -= d * 3;
    if (playerPositions.some(p => entity.position.distanceTo(p) < 5)) score += 20; // Spieler beschützen
    return score;
}

export function rankThreats(entities, botPos, center = null, range = 12, playerPositions = []) {
    /** Feinde im Umkreis `range` um `center` (sonst um den Bot), sortiert nach Bedrohung. */
    const c = center || botPos;
    return entities
        .filter(e => isCombatTarget(e) && e.position.distanceTo(c) < range)
        .sort((a, b) => threatScore(b, botPos, playerPositions) - threatScore(a, botPos, playerPositions));
}

export function chooseCombatAction({ name, dist, fusing = false, health = 20, hasBow = false }) {
    /** Entscheidet: 'retreat' | 'evade' | 'shoot' | 'melee'. */
    if (health <= 8) return 'retreat';
    if (name === 'creeper') {
        if (fusing || dist < 3.5) return 'evade';
        return hasBow ? 'shoot' : 'melee';
    }
    if (RANGED_MOBS.includes(name) && hasBow && dist > 6) return 'shoot';
    return 'melee';
}

export function isInPlayerPath(playerPos, playerYaw, botPos, ahead = 3, width = 1) {
    /** Steht der Bot vor dem Spieler in Blickrichtung (bis `ahead` Blöcke, ±`width` seitlich)? */
    const fx = -Math.sin(playerYaw), fz = -Math.cos(playerYaw); // mineflayer: yaw 0 = Norden (-z)
    const dx = botPos.x - playerPos.x, dz = botPos.z - playerPos.z;
    const along = dx * fx + dz * fz;
    const side = Math.abs(dx * fz - dz * fx);
    return along > 0 && along < ahead && side < width;
}

export function escortDecision({ dist, minDist = 2, maxDist = 4, inPath = false, playerMoving = false }) {
    /** Abstand halten: 'follow' | 'back_off' | 'sidestep' | 'hold', plus sprint. */
    if (dist > maxDist) return { move: 'follow', sprint: dist > 8 };
    if (playerMoving && inPath) return { move: 'sidestep', sprint: false };
    if (dist < minDist) return { move: 'back_off', sprint: false };
    return { move: 'hold', sprint: false };
}

export function isNightTime(timeOfDay) {
    return timeOfDay >= 12542 && timeOfDay <= 23460; // ab hier kann man schlafen
}

// ---------- Skills mit bot ----------

function playerPositions(bot) {
    return Object.values(bot.players).map(p => p.entity).filter(e => e && e !== bot.entity).map(e => e.position);
}

export function pickTarget(bot, range = 12, center = null) {
    /**
     * Gefährlichster Feind im Umkreis (nie Spieler oder Haustiere).
     * @param {MinecraftBot} bot
     * @param {number} range, Suchradius. @param {Vec3} center, Mittelpunkt (Standard: Bot).
     * @returns {Entity|null}
     * @example
     * const enemy = skills.pickTarget(bot, 12);
     **/
    return rankThreats(Object.values(bot.entities), bot.entity.position, center, range, playerPositions(bot))[0] || null;
}

export async function equipCombatGear(bot) {
    /**
     * Beste Nahkampfwaffe in die Hand, Schild in die Nebenhand (falls vorhanden).
     * @example
     * await skills.equipCombatGear(bot);
     **/
    const items = bot.inventory.items();
    let weapons = items.filter(i => i.name.includes('sword') || i.name.endsWith('_axe') || i.name === 'mace' || i.name === 'trident');
    if (weapons.length === 0) weapons = items.filter(i => i.name.includes('pickaxe') || i.name.includes('shovel'));
    weapons.sort((a, b) => (b.attackDamage || 0) - (a.attackDamage || 0));
    if (weapons[0] && bot.heldItem?.name !== weapons[0].name) await bot.equip(weapons[0], 'hand');
    const offhand = bot.inventory.slots[45];
    const shield = items.find(i => i.name === 'shield');
    if (shield && offhand?.name !== 'shield') await bot.equip(shield, 'off-hand');
}

function hasShield(bot) {
    return bot.inventory.slots[45]?.name === 'shield';
}

function hasBowAndArrows(bot) {
    const items = bot.inventory.items();
    return items.some(i => i.name === 'bow') && items.some(i => i.name.includes('arrow'));
}

export async function eatBest(bot) {
    /**
     * Isst das nahrhafteste Essen im Inventar (kein Gammelfleisch o. ä.).
     * @returns {Promise<boolean>} true wenn gegessen wurde.
     * @example
     * await skills.eatBest(bot);
     **/
    const foods = bot.registry.foodsByName || {};
    const best = bot.inventory.items()
        .filter(i => foods[i.name] && !BAD_FOOD.includes(i.name))
        .sort((a, b) => foods[b.name].foodPoints - foods[a.name].foodPoints)[0];
    if (!best) { skills.log(bot, 'No good food to eat.'); return false; }
    if (bot.food >= 20 && !best.name.includes('golden_apple')) return false; // satt -> geht nicht
    return await skills.consume(bot, best.name);
}

export function hasFood(bot) {
    const foods = bot.registry.foodsByName || {};
    return bot.inventory.items().some(i => foods[i.name] && !BAD_FOOD.includes(i.name));
}

async function shootBow(bot, target) {
    await bot.pvp.stop();
    const bow = bot.inventory.items().find(i => i.name === 'bow');
    await bot.equip(bow, 'hand');
    const aim = () => {
        const d = bot.entity.position.distanceTo(target.position);
        return bot.lookAt(target.position.offset(0, (target.height || 1.6) * 0.8 + d * 0.04, 0), true);
    };
    await aim();
    bot.activateItem();
    for (let t = 0; t < 11 && !bot.interrupt_code; t++) { await wait(100); await aim(); } // 1,1 s = voll gespannt
    bot.deactivateItem();
}

export async function retreatAndHeal(bot) {
    /**
     * Bei wenig Leben: weg von Feinden und etwas essen.
     * @example
     * await skills.retreatAndHeal(bot);
     **/
    await bot.pvp.stop();
    bot.deactivateItem();
    skills.log(bot, `Low health (${Math.round(bot.health)}), retreating.`);
    await skills.avoidEnemies(bot, 14);
    if (!bot.interrupt_code) await eatBest(bot);
}

export async function smartCombat(bot, range = 12, center = null) {
    /**
     * Kluger Kampf gegen alle Feinde im Umkreis: beste Waffe + Schild, Bogen gegen Fernkämpfer,
     * Abstand zu (zischenden) Creepern, Rückzug + Essen bei wenig Leben. Greift nie Spieler/Haustiere an.
     * @param {MinecraftBot} bot
     * @param {number} range, Kampfradius. @param {Vec3} center, Mittelpunkt (Standard: Bot).
     * @returns {Promise<boolean>} true wenn gekämpft wurde.
     * @example
     * await skills.smartCombat(bot, 12);
     **/
    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    bot.modes.pause('smart_combat');
    let fought = false, retreats = 0;
    try {
        while (!bot.interrupt_code) {
            const target = pickTarget(bot, range, center);
            if (!target) break;
            fought = true;
            const dist = bot.entity.position.distanceTo(target.position);
            const action = chooseCombatAction({ name: target.name, dist, fusing: isCreeperFusing(target),
                health: bot.health, hasBow: hasBowAndArrows(bot) });
            if (action === 'retreat') {
                if (++retreats > 2) { skills.log(bot, 'Still low on health, giving up the fight.'); break; }
                await retreatAndHeal(bot);
                continue;
            }
            if (action === 'shoot') {
                await shootBow(bot, target);
                continue;
            }
            await equipCombatGear(bot);
            if (action === 'evade') {
                await bot.pvp.stop();
                if (hasShield(bot)) bot.activateItem(true); // Schild hoch gegen Explosion
                bot.pathfinder.setMovements(new pf.Movements(bot));
                bot.pathfinder.setGoal(new pf.goals.GoalInvert(new pf.goals.GoalFollow(target, 7)), true);
                await wait(700);
                bot.deactivateItem();
                continue;
            }
            // melee; Schild hoch, solange der Gegner (v. a. Fernkämpfer) noch nicht in Reichweite ist
            bot.pvp.attack(target);
            if (hasShield(bot) && dist > 3.5 && RANGED_MOBS.includes(target.name)) bot.activateItem(true);
            else bot.deactivateItem();
            await wait(400);
        }
    } finally {
        await bot.pvp.stop();
        bot.deactivateItem();
    }
    skills.log(bot, fought ? 'Fight over.' : 'No enemies nearby.');
    return fought;
}

export async function escortPlayer(bot, username, minDist = 2, maxDist = 4) {
    /**
     * Begleitet einen Spieler endlos mit 2–4 Blöcken Abstand: holt sprintend auf, schwimmt, macht Platz,
     * wenn sie im Weg steht. Kein Teleport. Läuft bis zum Abbruch.
     * @param {MinecraftBot} bot @param {string} username @param {number} minDist @param {number} maxDist
     * @returns {Promise<boolean>} false wenn der Spieler nicht gefunden wurde.
     * @example
     * await skills.escortPlayer(bot, "Steve", 2, 4);
     **/
    if (!bot.players[username]?.entity) { skills.log(bot, `Could not find player ${username}.`); return false; }
    const move = new pf.Movements(bot);
    move.allowSprinting = true;
    move.digCost = 10;
    bot.pathfinder.setMovements(move);
    skills.log(bot, `Escorting ${username} (distance ${minDist}-${maxDist}).`);
    let last = null, lastPos = null, missingSince = 0, paused = false;
    try {
        while (!bot.interrupt_code) {
            const player = bot.players[username]?.entity;
            if (!player) {
                missingSince ||= Date.now();
                if (Date.now() - missingSince > 30000) { skills.log(bot, `Lost ${username}.`); return false; }
                await wait(500);
                continue;
            }
            missingSince = 0;
            const dist = bot.entity.position.distanceTo(player.position);
            const moving = lastPos ? lastPos.distanceTo(player.position) > 0.15 : false;
            lastPos = player.position.clone();
            const d = escortDecision({ dist, minDist, maxDist, playerMoving: moving,
                inPath: isInPlayerPath(player.position, player.yaw, bot.entity.position) });

            bot.setControlState('jump', !!bot.entity.isInWater); // schwimmen statt sinken
            const far = dist > 24; // aufholen: Modi, die bremsen, pausieren
            if (far !== paused) {
                for (const m of ['item_collecting', 'hunting', 'torch_placing'])
                    far ? bot.modes.pause(m) : bot.modes.unpause(m);
                paused = far;
            }
            if (d.move !== last || d.move === 'sidestep') {
                if (d.move === 'follow') bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, (minDist + maxDist) / 2), true);
                else if (d.move === 'back_off') bot.pathfinder.setGoal(new pf.goals.GoalInvert(new pf.goals.GoalFollow(player, minDist + 0.5)), true);
                else if (d.move === 'sidestep') {
                    const s = Math.sign(Math.random() - 0.5) * 2; // 2 Blöcke quer zur Blickrichtung
                    const p = bot.entity.position.plus(new Vec3(Math.cos(player.yaw) * s, 0, -Math.sin(player.yaw) * s));
                    bot.pathfinder.setGoal(new pf.goals.GoalNear(p.x, p.y, p.z, 0.5));
                }
                else bot.pathfinder.setGoal(null);
                last = d.move;
            }
            await wait(d.move === 'sidestep' ? 800 : 300);
        }
    } finally {
        bot.setControlState('jump', false);
        bot.pathfinder.setGoal(null);
        if (paused) for (const m of ['item_collecting', 'hunting', 'torch_placing']) bot.modes.unpause(m);
    }
    return true;
}

export async function guardArea(bot, seconds = 60, radius = 10) {
    /**
     * Wache halten an der aktuellen Stelle: Feinde im Radius bekämpfen, danach zurück auf den Posten.
     * @param {MinecraftBot} bot @param {number} seconds, -1 = endlos @param {number} radius
     * @example
     * await skills.guardArea(bot, 120, 10);
     **/
    const post = bot.entity.position.clone();
    const end = seconds < 0 ? Infinity : Date.now() + seconds * 1000;
    skills.log(bot, `Guarding ${post.floored()} for ${seconds < 0 ? 'ever' : seconds + 's'}.`);
    let kills = 0;
    while (!bot.interrupt_code && Date.now() < end) {
        bot.modes.pause('self_defense');
        bot.modes.pause('cowardice');
        bot.modes.pause('smart_combat');
        bot.modes.pause('hunting');
        if (pickTarget(bot, radius, post)) {
            if (await smartCombat(bot, radius, post)) kills++;
        }
        else if (bot.entity.position.distanceTo(post) > 1.5) {
            try { await skills.goToPosition(bot, post.x, post.y, post.z, 1); } catch (e) { /* neu versuchen */ }
        }
        await wait(500);
    }
    skills.log(bot, `Guard duty over (${kills} fights).`);
    return true;
}

export function findDarkSpot(bot, center, radius = 3) {
    /** Freier Platz (Luft auf festem Block) nahe `center` ohne Fackel im Umkreis 6. Licht-Werte sind unzuverlässig -> Fackel-Abstand. */
    const c = center.floored();
    const torch = bot.findBlock({ point: c, maxDistance: 6, matching: b => b.name === 'torch' || b.name === 'wall_torch' });
    if (torch) return null;
    let best = null, bestD = Infinity;
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -1; dy <= 1; dy++) {
        if (Math.abs(dx) + Math.abs(dz) < 2) continue; // nicht direkt unter die Füße des Spielers
        const p = c.offset(dx, dy, dz);
        const b = bot.blockAt(p), below = bot.blockAt(p.offset(0, -1, 0));
        if (b?.name !== 'air' || below?.boundingBox !== 'block') continue;
        const d = Math.abs(dx) + Math.abs(dz) + Math.abs(dy);
        if (d < bestD) { best = p; bestD = d; }
    }
    return best;
}

export async function placeTorchNear(bot, center) {
    /**
     * Stellt eine Fackel an eine dunkle Stelle nahe `center`.
     * @example
     * await skills.placeTorchNear(bot, bot.entity.position);
     **/
    if (!bot.inventory.findInventoryItem('torch')) return false;
    const spot = findDarkSpot(bot, center);
    if (!spot) return false;
    return await skills.placeBlock(bot, 'torch', spot.x, spot.y, spot.z, 'bottom', true);
}
