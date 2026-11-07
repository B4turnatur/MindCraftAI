// Neue Skills (building). Werden über skills.js re-exportiert → im Code-Modus als skills.<name> verfügbar.
// Nur Funktionen exportieren, keine Top-Level-Aufrufe von skills.* (zirkulärer Import).
import * as skills from './skills.js';
import * as world from './world.js';
import * as mc from '../../utils/mcdata.js';
import Vec3 from 'vec3';

// ───────────────────────── reine Logik (ohne Bot, testbar) ─────────────────────────

const EMPTY = ['air', 'cave_air', 'water', 'lava', 'grass', 'short_grass', 'tall_grass', 'snow', 'dead_bush', 'fern', 'large_fern'];
const CARDINALS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

export const TEMPLATE_NAMES = ['hut', 'tower', 'bridge', 'wall', 'fence'];

function woodOf(material) {
    const m = String(material).match(/^(.*)_(planks|log|wood|fence|slab|stairs)$/);
    return m ? m[1] : 'oak';
}

export function getTemplateBlocks(name, material, opts = {}) {
    /*
     * Pure: returns the block list of a built-in template in LOCAL coordinates (lx = right, ly = up, lz = forward).
     * Entry: {lx, ly, lz, block, fill?, attach?}. block 'air' = clear this cell; fill = only place if the cell is empty (foundation);
     * attach = local direction a ladder/torch hangs on. Templates: hut, tower, bridge, wall, fence.
     * @param {string} name, template name.
     * @param {string} material, main block, e.g. "oak_planks" or "cobblestone".
     * @param {object} opts, optional sizes: {width, depth, height, length, radius}.
     * @returns {object[]} list of block entries, or null for an unknown template.
     * @example
     * let blocks = skills.getTemplateBlocks("hut", "oak_planks");
     */
    const out = [];
    const add = (lx, ly, lz, block, extra = {}) => out.push({ lx, ly, lz, block, ...extra });
    const wood = woodOf(material);
    name = String(name).toLowerCase();

    if (name === 'hut') {
        const w = opts.width || 5, d = opts.depth || 5, h = opts.height || 3;
        const door = Math.floor(w / 2);
        for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
            add(x, -1, z, material, { fill: true });                       // Fundament nur in Löchern
            const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
            for (let y = 0; y < h; y++) {
                if (!edge) add(x, y, z, 'air');                             // Innenraum frei räumen
                else if (x === door && z === 0 && y < 2) { if (y === 0) add(x, y, z, `${wood}_door`); else add(x, y, z, 'air'); }
                else add(x, y, z, material);
            }
            add(x, h, z, material);                                         // Flachdach
        }
        add(1, 1, d - 2, 'torch', { attach: 'forward' });                   // Licht an der Rückwand
        return out;
    }
    if (name === 'tower') {
        const h = opts.height || 7;
        for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
            add(x, -1, z, material, { fill: true });
            for (let y = 0; y < h; y++) {
                if (x === 1 && z === 1) add(x, y, z, 'ladder', { attach: 'forward' }); // Leiter innen an der Rückwand
                else if (x === 1 && z === 0 && y < 2) add(x, y, z, 'air');             // Eingang
                else add(x, y, z, material);
            }
        }
        for (let x = -1; x <= 3; x++) for (let z = -1; z <= 3; z++) {
            if (x === 1 && z === 1) { add(x, h, z, 'ladder', { attach: 'forward' }); continue; } // Ausstieg
            add(x, h, z, material);                                                   // Plattform 5x5
            const edge = x === -1 || z === -1 || x === 3 || z === 3;
            if (edge && (x + z) % 2 === 0) add(x, h + 1, z, material);                // Zinnen
        }
        return out;
    }
    if (name === 'bridge') {
        const len = opts.length || 10;
        for (let z = 0; z < len; z++) {
            for (let x = 0; x < 3; x++) { add(x, -1, z, material); add(x, 0, z, 'air'); add(x, 1, z, 'air'); }
            add(-1, 0, z, material); add(3, 0, z, material);                          // Geländer
        }
        return out;
    }
    if (name === 'wall' || name === 'fence') {
        const r = Math.max(3, opts.radius || 6);
        const block = name === 'fence' ? (material.endsWith('_fence') ? material : `${wood}_fence`) : material;
        const h = opts.height || (name === 'fence' ? 1 : 3);
        for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
            if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue;
            for (let y = 0; y < h; y++) {
                if (x === 0 && z === r && y < 2) { add(x, y, z, 'air'); continue; }   // Durchgang vorne
                add(x, y, z, block);
            }
        }
        return out;
    }
    return null;
}

export function yawToCardinal(yaw) {
    /*
     * Pure: converts a mineflayer yaw (radians) to 'north' | 'south' | 'east' | 'west'.
     * @param {number} yaw, the entity yaw.
     * @returns {string} cardinal direction.
     */
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 'east' : 'west';
    return fz > 0 ? 'south' : 'north';
}

export function localToWorld(entry, origin, facing) {
    /*
     * Pure: local template coords → world coords. origin {x,y,z}; facing = cardinal the build "looks" away from the builder.
     * @returns {object} {x, y, z}
     */
    const [fx, fz] = CARDINALS[facing];
    const rx = -fz, rz = fx;  // rechts von "vorne"
    return {
        x: origin.x + rx * entry.lx + fx * entry.lz,
        y: origin.y + entry.ly,
        z: origin.z + rz * entry.lx + fz * entry.lz,
    };
}

function localDirToCardinal(dir, facing) {
    if (dir !== 'forward') return dir;
    return facing;
}

export function orderForBuild(entries) {
    /*
     * Pure: build order. First all 'air' (clearing, top-down), then solid blocks bottom-up, front-to-back, left-to-right,
     * and attachments (ladder/torch/door) after the solid block of their layer so they have something to hang on.
     */
    const att = b => (b.block === 'ladder' || b.block === 'torch' || b.block.endsWith('_door')) ? 1 : 0;
    const air = entries.filter(e => e.block === 'air').sort((a, b) => b.ly - a.ly || a.lz - b.lz || a.lx - b.lx);
    const solid = entries.filter(e => e.block !== 'air')
        .sort((a, b) => a.ly - b.ly || att(a) - att(b) || a.lz - b.lz || a.lx - b.lx);
    return [...air, ...solid];
}

export function itemForBlock(block) {
    if (block === 'redstone_wire') return 'redstone';
    if (block === 'wall_torch') return 'torch';
    return block;
}

export function countMaterials(entries) {
    /*
     * Pure: counts required items per name (ignores 'air'). Pass only the entries that still need placing.
     * @returns {object} {itemName: count}
     */
    const need = {};
    for (const e of entries) {
        if (e.block === 'air') continue;
        const item = itemForBlock(e.block);
        need[item] = (need[item] || 0) + 1;
    }
    return need;
}

export function missingMaterials(need, inventory) {
    /* Pure: {item: count} still missing compared to inventory counts. */
    const miss = {};
    for (const [item, n] of Object.entries(need)) {
        const have = inventory[item] || 0;
        if (have < n) miss[item] = n - have;
    }
    return miss;
}

export function findBridgeLength(isSolidAt, maxLen = 32) {
    /*
     * Pure: isSolidAt(dist) tells if there is ground at deck level `dist` blocks ahead.
     * Returns how many blocks are needed to cross the first gap (incl. 1 block onto the far side), or 0 if no gap.
     */
    let sawGap = false;
    for (let d = 0; d < maxLen; d++) {
        const solid = isSolidAt(d);
        if (!solid) sawGap = true;
        else if (sawGap) return d + 1;
    }
    return sawGap ? maxLen : 0;
}

const KEEP_RE = /(_pickaxe|_axe|_shovel|_hoe|_sword|^shears|flint_and_steel|fishing_rod|^bow$|crossbow|shield|trident|bucket|_helmet|_chestplate|_leggings|_boots|^elytra|torch$|^arrow$)/;

export function itemCategory(name, isFood = false) {
    /*
     * Pure: storage category of an item. 'keep' = stays in the inventory (tools, weapons, armour, food, torches).
     * Others: 'wood', 'stone', 'ores', 'mobdrops', 'plants', 'redstone', 'misc'.
     */
    if (isFood || KEEP_RE.test(name)) return 'keep';
    if (/(_log|_wood|_planks|stick|_slab|_stairs|_fence|_door|crafting_table|chest|barrel)$|^stripped_/.test(name)) return 'wood';
    if (/(ingot|nugget|^raw_|diamond|emerald|^coal$|charcoal|lapis|quartz|_ore$|amethyst|netherite)/.test(name)) return 'ores';
    if (/(redstone|repeater|comparator|piston|hopper|observer|lever|button|rail)/.test(name)) return 'redstone';
    if (/(stone|cobble|dirt|grass_block|sand|gravel|granite|diorite|andesite|deepslate|tuff|clay|brick|netherrack|basalt|blackstone|glass|terracotta|calcite|mud)/.test(name)) return 'stone';
    if (/(rotten_flesh|bone|string|gunpowder|spider_eye|ender_pearl|slime|feather|leather|ink_sac|blaze|phantom|wool)/.test(name)) return 'mobdrops';
    if (/(seed|sapling|wheat|flower|tulip|poppy|dandelion|leaves|vine|cactus|sugar_cane|bamboo|kelp|mushroom|pumpkin|melon|cocoa|lily|azalea|moss|egg)/.test(name)) return 'plants';
    return 'misc';
}

export function pickChestForCategory(category, chests) {
    /*
     * Pure: chests = [{id, categories:{cat:count}, free}] → id of the best chest:
     * most items of that category first, then an empty chest, then the one with most free slots. null if all full.
     */
    const open = chests.filter(c => c.free > 0);
    if (!open.length) return null;
    const score = c => [(c.categories[category] || 0), Object.keys(c.categories).length === 0 ? 1 : 0, c.free];
    open.sort((a, b) => { const sa = score(a), sb = score(b); return sb[0] - sa[0] || sb[1] - sa[1] || sb[2] - sa[2]; });
    return open[0].id;
}

// ───────────────────────── Bot-Teil ─────────────────────────

function isFoodItem(bot, name) {
    return !!(bot.registry?.foodsByName?.[name]);
}

function playerInCell(bot, p) {
    for (const name in bot.players) {
        const e = bot.players[name].entity;
        if (!e || name === bot.username) continue;
        const ex = Math.floor(e.position.x), ey = Math.floor(e.position.y), ez = Math.floor(e.position.z);
        if (ex === p.x && ez === p.z && (ey === p.y || ey + 1 === p.y)) return name;
    }
    return null;
}

function alreadyThere(current, block) {
    if (!current) return false;
    if (current === block) return true;
    return (current === 'stone' && block === 'cobblestone') || (current === 'grass_block' && block === 'dirt');
}

function anchorFor(bot, username) {
    // Bezugspunkt + Blickrichtung: Spieler (wenn in der Nähe), sonst der Bot.
    const p = username && bot.players[username]?.entity;
    const ent = (p && p.position.distanceTo(bot.entity.position) < 24) ? p : bot.entity;
    return { pos: ent.position.floored(), facing: yawToCardinal(ent.yaw), who: ent === bot.entity ? 'me' : username };
}

async function gatherMaterials(bot, missing) {
    // Versucht fehlende Items zu craften/sammeln. Gibt zurück, was danach noch fehlt.
    const free = bot.game.gameMode === 'creative' || bot.modes?.isOn?.('cheat');
    if (free) return {};
    for (const [item, n] of Object.entries(missing)) {
        if (bot.interrupt_code) return missing;
        const have = () => world.getInventoryCounts(bot)[item] || 0;
        const target = have() + n;
        skills.log(bot, `Need ${n} more ${item}, trying to get it.`);
        if (item.endsWith('_planks')) {
            const log = item.replace('_planks', '_log');
            const logsNeeded = Math.ceil((target - have()) / 4);
            const logsHave = world.getInventoryCounts(bot)[log] || 0;
            if (logsHave < logsNeeded) await skills.collectBlock(bot, log, logsNeeded - logsHave);
            await skills.craftRecipe(bot, item, logsNeeded);
        } else if (mc.getItemCraftingRecipes(item)?.length && !['cobblestone', 'dirt', 'stone'].includes(item)) {
            await skills.craftRecipe(bot, item, n);   // Tür, Leiter, Zaun, Fackel …
        } else {
            await skills.collectBlock(bot, item, n);
        }
        if (have() >= target) delete missing[item];
        else missing[item] = target - have();
    }
    return missing;
}

export async function buildTemplate(bot, name, material = 'oak_planks', username = null, opts = {}) {
    /**
     * Build a built-in structure in front of the player (or the bot): 'hut' (5x5 with door, roof, torch), 'tower' (3x3 watch tower
     * with ladder + platform), 'bridge' (3 wide across the gap ahead), 'wall' (stone ring around you), 'fence' (fence ring).
     * Counts materials first, gathers/crafts what is missing (or reports it), clears obstructions, builds bottom-up.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} name, template name: hut, tower, bridge, wall, fence.
     * @param {string} material, main block like "oak_planks" or "cobblestone". Defaults to oak_planks.
     * @param {string} username, player whose position/facing is used. Defaults to the bot itself.
     * @param {object} opts, optional {width, depth, height, length, radius, gather:true}.
     * @returns {Promise<boolean>} true if all blocks were placed.
     * @example
     * await skills.buildTemplate(bot, "hut", "cobblestone", "Steve");
     **/
    name = String(name).toLowerCase();
    if (!TEMPLATE_NAMES.includes(name)) {
        skills.log(bot, `Unknown template "${name}". Available: ${TEMPLATE_NAMES.join(', ')}.`);
        return false;
    }
    if (!mc.getBlockId(material)) {
        skills.log(bot, `"${material}" is not a valid block name.`);
        return false;
    }
    const a = anchorFor(bot, username);
    const [fx, fz] = CARDINALS[a.facing];
    let origin;
    if (name === 'wall' || name === 'fence') origin = { x: a.pos.x, y: a.pos.y, z: a.pos.z };        // Ring um den Bezugspunkt
    else if (name === 'bridge') {
        const rx = -fz, rz = fx;
        origin = { x: a.pos.x + fx - rx, y: a.pos.y, z: a.pos.z + fz - rz };                          // mittig, ab 1 Block vorne
        if (!opts.length) {
            const deckY = a.pos.y - 1;
            const len = findBridgeLength(d => {
                const b = bot.blockAt(new Vec3(a.pos.x + fx * (d + 1), deckY, a.pos.z + fz * (d + 1)));
                return b && !EMPTY.includes(b.name);
            });
            if (!len) { skills.log(bot, `No gap found ahead (facing ${a.facing}). Look towards the gap or give a length.`); return false; }
            opts = { ...opts, length: len };
        }
    } else {
        const w = name === 'tower' ? 3 : (opts.width || 5);
        const rx = -fz, rz = fx;
        const off = Math.floor(w / 2);
        origin = { x: a.pos.x + fx * 3 - rx * off, y: a.pos.y, z: a.pos.z + fz * 3 - rz * off };     // 3 Blöcke vor dem Spieler, mittig
    }

    const entries = getTemplateBlocks(name, material, opts);
    const placed = orderForBuild(entries).map(e => ({ ...e, pos: localToWorld(e, origin, a.facing) }));

    // Nur zählen, was wirklich noch fehlt.
    const todo = placed.filter(e => {
        const cur = bot.blockAt(new Vec3(e.pos.x, e.pos.y, e.pos.z))?.name;
        if (e.block === 'air') return cur && !EMPTY.includes(cur);
        if (e.fill) return !cur || EMPTY.includes(cur);
        return !alreadyThere(cur, e.block);
    });
    const need = countMaterials(todo);
    let missing = missingMaterials(need, world.getInventoryCounts(bot));
    skills.log(bot, `Building ${name} from ${material} at ${origin.x}, ${origin.y}, ${origin.z} facing ${a.facing}: ${todo.length} steps, needs ${JSON.stringify(need)}.`);
    if (Object.keys(missing).length && opts.gather !== false) missing = await gatherMaterials(bot, missing);
    if (bot.interrupt_code) return false;
    if (Object.keys(missing).length) {
        const main = Object.entries(need).sort((x, y) => y[1] - x[1])[0][0];   // Hauptmaterial = meistgebrauchtes Item
        skills.log(bot, `Still missing: ${Object.entries(missing).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
        if (missing[main]) { skills.log(bot, `Not enough ${main} to build ${name}. Get more and try again.`); return false; }
        skills.log(bot, `Building anyway, skipping the missing extras.`);
    }

    let failed = [];
    const placeOne = async (e) => {
        const { x, y, z } = e.pos;
        if (e.block === 'air') {
            const cur = bot.blockAt(new Vec3(x, y, z))?.name;
            if (cur && !EMPTY.includes(cur)) await skills.breakBlockAt(bot, x, y, z);
            return true;
        }
        const cur = bot.blockAt(new Vec3(x, y, z))?.name;
        if (e.fill && cur && !EMPTY.includes(cur)) return true;
        if (alreadyThere(cur, e.block)) return true;
        if ((world.getInventoryCounts(bot)[itemForBlock(e.block)] || 0) === 0 && bot.game.gameMode !== 'creative' && !bot.modes?.isOn?.('cheat'))
            return true;  // fehlendes Extra (Tür/Fackel) überspringen
        const who = playerInCell(bot, e.pos);
        if (who) { skills.log(bot, `${who} is standing where a block goes, skipping ${x}, ${y}, ${z}.`); return false; }
        const placeOn = e.attach ? localDirToCardinal(e.attach, a.facing) : 'bottom';
        try { return await skills.placeBlock(bot, e.block, x, y, z, placeOn); }
        catch (err) { return false; }
    };

    for (const e of todo) {
        if (bot.interrupt_code) { skills.log(bot, `Building ${name} interrupted.`); return false; }
        if (!await placeOne(e)) failed.push(e);
    }
    // Zweiter Durchgang: inzwischen gibt es oft einen Block zum Dranbauen.
    const retry = failed; failed = [];
    for (const e of retry) {
        if (bot.interrupt_code) return false;
        if (!await placeOne(e)) failed.push(e);
    }
    if (failed.length) {
        skills.log(bot, `Built ${name}, but ${failed.length} blocks could not be placed (e.g. ${failed[0].block} at ${failed[0].pos.x}, ${failed[0].pos.y}, ${failed[0].pos.z}).`);
        return false;
    }
    skills.log(bot, `Finished building ${name} from ${material}.`);
    return true;
}

// ───────────────────────── Lager / Kisten ─────────────────────────

const CHEST_TYPES = ['chest', 'trapped_chest', 'barrel'];

function nearbyChests(bot, range = 16) {
    // Doppelkisten haben zwei Blöcke → nur einen davon behalten (Nachbar mit gleichem Namen überspringen).
    const blocks = world.getNearestBlocks(bot, CHEST_TYPES, range, 64);
    const seen = [];
    return blocks.filter(b => {
        const dup = seen.some(s => s.name === b.name && s.position.y === b.position.y && s.position.distanceTo(b.position) === 1 && b.name !== 'barrel');
        seen.push(b);
        return !dup;
    });
}

async function openChest(bot, block) {
    await skills.goToPosition(bot, block.position.x, block.position.y, block.position.z, 2);
    return await bot.openContainer(block);
}

function freeSlots(container) {
    return container.inventoryStart - container.containerItems().length;
}

async function scanChests(bot, chests) {
    const info = [];
    for (let i = 0; i < chests.length; i++) {
        if (bot.interrupt_code) break;
        try {
            const c = await openChest(bot, chests[i]);
            const categories = {};
            for (const it of c.containerItems()) {
                const cat = itemCategory(it.name, isFoodItem(bot, it.name));
                categories[cat] = (categories[cat] || 0) + it.count;
            }
            info.push({ id: i, block: chests[i], categories, free: freeSlots(c) });
            c.close();
        } catch (err) {
            skills.log(bot, `Could not open chest at ${chests[i].position}: ${err.message}`);
        }
    }
    return info;
}

export async function storeItems(bot, range = 16) {
    /**
     * Put all non-essential inventory items into nearby chests, grouped by category (wood, stone, ores, mobdrops, plants, redstone, misc).
     * Keeps tools, weapons, armour, food, torches and arrows.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} range, chest search radius. Defaults to 16.
     * @returns {Promise<boolean>} true if something was stored.
     * @example
     * await skills.storeItems(bot);
     **/
    const chests = nearbyChests(bot, range);
    if (!chests.length) { skills.log(bot, `No chests within ${range} blocks. Use makeStorage first.`); return false; }
    const byCat = {};
    for (const it of bot.inventory.items()) {
        const cat = itemCategory(it.name, isFoodItem(bot, it.name));
        if (cat === 'keep') continue;
        (byCat[cat] ||= []).push(it.name);
    }
    if (!Object.keys(byCat).length) { skills.log(bot, `Nothing to store, only essentials in inventory.`); return false; }
    const info = await scanChests(bot, chests);
    let stored = 0;
    for (const [cat, names] of Object.entries(byCat)) {
        const tried = new Set();
        let pending = [...new Set(names)];
        while (pending.length) {
            if (bot.interrupt_code) { skills.log(bot, `Storing interrupted after ${stored} items.`); return stored > 0; }
            const id = pickChestForCategory(cat, info.filter(c => !tried.has(c.id)));
            if (id === null) { skills.log(bot, `All chests are full, could not store: ${pending.join(', ')}.`); break; }
            tried.add(id);
            const ch = info.find(c => c.id === id);
            try {
                const c = await openChest(bot, ch.block);
                const left = [];
                for (const name of pending) {
                    const count = world.getInventoryCounts(bot)[name] || 0;
                    if (!count) continue;
                    try { await c.deposit(mc.getItemId(name), null, count); stored += count; ch.categories[cat] = (ch.categories[cat] || 0) + count; }
                    catch (err) { left.push(name); }  // Kiste voll
                }
                ch.free = freeSlots(c);
                c.close();
                pending = left;
            } catch (err) {
                skills.log(bot, `Chest at ${ch.block.position} failed: ${err.message}`);
            }
        }
        skills.log(bot, `Stored ${cat} items.`);
    }
    skills.log(bot, `Stored ${stored} items in ${info.length} chest(s).`);
    return stored > 0;
}

export async function sortChests(bot, range = 16) {
    /**
     * Tidy nearby chests: takes out items that do not match a chest's main category, then stores everything by category
     * (same as storeItems). Limited by free inventory space, run again for big messes.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} range, chest search radius. Defaults to 16.
     * @returns {Promise<boolean>} true if done.
     * @example
     * await skills.sortChests(bot);
     **/
    const chests = nearbyChests(bot, range);
    if (chests.length < 2) { skills.log(bot, `Need at least 2 chests nearby to sort (found ${chests.length}).`); return storeItems(bot, range); }
    let moved = 0;
    for (const block of chests) {
        if (bot.interrupt_code) return false;
        if (bot.inventory.emptySlotCount() < 2) break;
        try {
            const c = await openChest(bot, block);
            const cats = {};
            for (const it of c.containerItems()) {
                const cat = itemCategory(it.name, isFoodItem(bot, it.name));
                cats[cat] = (cats[cat] || 0) + it.count;
            }
            const main = Object.entries(cats).sort((x, y) => y[1] - x[1])[0]?.[0];
            for (const it of c.containerItems()) {
                if (bot.interrupt_code || bot.inventory.emptySlotCount() < 2) break;
                const cat = itemCategory(it.name, isFoodItem(bot, it.name));
                if (cat === main || cat === 'keep') continue;
                try { await c.withdraw(it.type, null, it.count); moved += it.count; } catch (err) { /* Inventar voll */ }
            }
            c.close();
        } catch (err) {
            skills.log(bot, `Could not open chest at ${block.position}: ${err.message}`);
        }
    }
    skills.log(bot, `Took out ${moved} misplaced items, now storing by category.`);
    return storeItems(bot, range);
}

export async function fetchFromChests(bot, itemName, num = 1, range = 16) {
    /**
     * Search all nearby chests (nearest first) and take the given item until num is reached.
     * Partial names work too, e.g. "log" takes any *_log.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, item name or part of it.
     * @param {number} num, how many to take. Defaults to 1.
     * @param {number} range, chest search radius. Defaults to 16.
     * @returns {Promise<boolean>} true if at least one item was taken.
     * @example
     * await skills.fetchFromChests(bot, "iron_ingot", 10);
     **/
    const chests = nearbyChests(bot, range);
    if (!chests.length) { skills.log(bot, `No chests within ${range} blocks.`); return false; }
    const match = n => n === itemName || (!mc.getItemId(itemName) && n.includes(itemName));
    let taken = 0;
    for (const block of chests) {
        if (bot.interrupt_code || taken >= num) break;
        try {
            const c = await openChest(bot, block);
            for (const it of c.containerItems().filter(i => match(i.name))) {
                if (taken >= num || bot.interrupt_code) break;
                const n = Math.min(it.count, num - taken);
                try { await c.withdraw(it.type, null, n); taken += n; } catch (err) { skills.log(bot, `Inventory full.`); break; }
            }
            c.close();
        } catch (err) {
            skills.log(bot, `Could not open chest at ${block.position}: ${err.message}`);
        }
    }
    if (!taken) { skills.log(bot, `No ${itemName} found in ${chests.length} nearby chest(s).`); return false; }
    skills.log(bot, `Fetched ${taken} ${itemName} from chests${taken < num ? ` (only ${taken} of ${num} available)` : ''}.`);
    return true;
}

export async function makeStorage(bot, x = null, y = null, z = null) {
    /**
     * Craft (if needed) and place a double chest. Uses the given position, otherwise the nearest free 2x2 spot.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, y, z, optional position for the first chest (e.g. the base).
     * @returns {Promise<boolean>} true if two chests were placed.
     * @example
     * await skills.makeStorage(bot);
     **/
    const free = bot.game.gameMode === 'creative' || bot.modes?.isOn?.('cheat');
    let have = world.getInventoryCounts(bot)['chest'] || 0;
    if (have < 2 && !free) {
        const inv = world.getInventoryCounts(bot);
        let planks = Object.entries(inv).filter(([k]) => k.endsWith('_planks')).reduce((s, [, v]) => s + v, 0);
        if (planks < 8 * (2 - have)) {
            const log = Object.keys(inv).find(k => k.endsWith('_log'));
            if (log) await skills.craftRecipe(bot, log.replace('_log', '_planks'), Math.ceil((8 * (2 - have) - planks) / 4));
        }
        if (bot.interrupt_code) return false;
        await skills.craftRecipe(bot, 'chest', 2 - have);
        have = world.getInventoryCounts(bot)['chest'] || 0;
        if (have < 2) { skills.log(bot, `Need 2 chests (16 planks), have ${have}.`); if (!have) return false; }
    }
    let pos;
    if (x != null && y != null && z != null) pos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    else pos = world.getNearestFreeSpace(bot, 2, 8);
    if (!pos) { skills.log(bot, `No free spot for a chest nearby.`); return false; }
    // Zweite Kiste quer zur Blickrichtung daneben → wird zur Doppelkiste (Ausrichtung kommt vom Bot-Blick).
    const facing = yawToCardinal(bot.entity.yaw);
    const [fx, fz] = CARDINALS[facing];
    const ok1 = await skills.placeBlock(bot, 'chest', pos.x, pos.y, pos.z);
    if (bot.interrupt_code) return false;
    const ok2 = have >= 2 || free ? await skills.placeBlock(bot, 'chest', pos.x - fz, pos.y, pos.z + fx) : false;
    skills.log(bot, ok1 && ok2 ? `Placed a double chest at ${pos.x}, ${pos.y}, ${pos.z}.` : `Placed ${(ok1 ? 1 : 0) + (ok2 ? 1 : 0)} chest(s) at ${pos.x}, ${pos.y}, ${pos.z}.`);
    return ok1 && ok2;
}
