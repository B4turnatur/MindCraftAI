// Neue Skills (farming). Werden über skills.js re-exportiert → im Code-Modus als skills.<name> verfügbar.
// Nur Funktionen exportieren, keine Top-Level-Aufrufe von skills.* (zirkulärer Import).
import * as skills from './skills.js';
import * as world from './world.js';
import * as mc from '../../utils/mcdata.js';
import Vec3 from 'vec3';

// Crop-Block -> [maximales age, Saat-Item]. Werte aus minecraft-data 26.1 (wheat/carrots/potatoes 0-7, beetroots 0-3).
const CROPS = {
    wheat: [7, 'wheat_seeds'],
    carrots: [7, 'carrot'],
    potatoes: [7, 'potato'],
    beetroots: [3, 'beetroot_seeds'],
};
const SEED_TO_CROP = Object.fromEntries(Object.entries(CROPS).map(([crop, [, seed]]) => [seed, crop]));

// Was !smeltAll anfasst: rohe Erze + rohes Essen. Kartoffeln/Logs/Sand absichtlich nicht (Saatgut / Baumaterial).
const SMELT_ALL_ITEMS = ['raw_iron', 'raw_gold', 'raw_copper', 'beef', 'porkchop', 'chicken', 'mutton', 'rabbit', 'cod', 'salmon'];

const BREED_FOOD = {
    cow: ['wheat'], mooshroom: ['wheat'], sheep: ['wheat'], goat: ['wheat'],
    pig: ['carrot', 'potato', 'beetroot'],
    chicken: ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'torchflower_seeds'],
    rabbit: ['carrot', 'golden_carrot', 'dandelion'],
    horse: ['golden_carrot', 'golden_apple'], donkey: ['golden_carrot', 'golden_apple'],
    llama: ['hay_block'], fox: ['sweet_berries', 'glow_berries'], cat: ['cod', 'salmon'],
    wolf: ['beef', 'porkchop', 'chicken', 'mutton', 'rabbit', 'cooked_beef', 'cooked_porkchop'],
    turtle: ['seagrass'], panda: ['bamboo'], camel: ['cactus'], frog: ['slime_ball'],
    armadillo: ['spider_eye'], sniffer: ['torchflower_seeds'], strider: ['warped_fungus'], hoglin: ['crimson_fungus'],
};
const BREED_COOLDOWN_MS = 5 * 60 * 1000; // Vanilla: 5 min Liebes-Cooldown nach dem Züchten
const lastFed = new Map(); // entity.id -> Zeitpunkt des Fütterns (überlebt keinen Neustart, reicht für eine Session)

export function isCropMature(block) {
    /**
     * Returns true if the block is a fully grown crop (wheat, carrots, potatoes, beetroots).
     * @param {Block} block, the block to check.
     * @returns {boolean} true if the crop can be harvested.
     * @example
     * let mature = skills.isCropMature(bot.blockAt(pos));
     **/
    const crop = block && CROPS[block.name];
    if (!crop) return false;
    const props = typeof block.getProperties === 'function' ? block.getProperties() : null;
    const age = props?.age ?? block.metadata; // bei Crops ist age der einzige State -> metadata == age
    return Number(age) >= crop[0];
}

export function seedForCrop(cropOrSeed) {
    // 'wheat'/'wheat_seeds'/'carrots'/'carrot' -> Saat-Item-Name, sonst null
    if (!cropOrSeed) return null;
    if (CROPS[cropOrSeed]) return CROPS[cropOrSeed][1];
    if (SEED_TO_CROP[cropOrSeed]) return cropOrSeed;
    if (CROPS[cropOrSeed + 's']) return CROPS[cropOrSeed + 's'][1]; // 'carrot' -> carrots, 'beetroot' -> beetroots
    if (cropOrSeed === 'potato') return 'potato';
    return null;
}

export function pickSmeltables(inventoryCounts) {
    // Inventar-Zählung -> [[item, anzahl], ...] in fester Reihenfolge (Erze zuerst)
    return SMELT_ALL_ITEMS.filter(n => inventoryCounts[n] > 0).map(n => [n, inventoryCounts[n]]);
}

export function isBabyEntity(entity, registry) {
    const keys = registry?.entitiesByName?.[entity.name]?.metadataKeys;
    const idx = keys ? keys.indexOf('baby') : -1;
    return idx >= 0 && entity.metadata?.[idx] === true;
}

function availableSeeds(bot, preferred = null) {
    const inv = world.getInventoryCounts(bot);
    const seeds = preferred ? [preferred] : Object.keys(SEED_TO_CROP);
    return seeds.filter(s => inv[s] > 0);
}

async function plantAt(bot, farmland, seed) {
    if (bot.entity.position.distanceTo(farmland.position) > 4.5)
        await skills.goToPosition(bot, farmland.position.x, farmland.position.y + 1, farmland.position.z, 2);
    if (bot.interrupt_code) return false;
    const item = bot.inventory.items().find(i => i.name === seed);
    if (!item) return false;
    try {
        await bot.equip(item, 'hand');
        await bot.activateBlock(bot.blockAt(farmland.position), new Vec3(0, 1, 0));
        return true;
    } catch (err) {
        console.log(`Planting ${seed} failed: ${err.message}`);
        return false;
    }
}

async function ensureHoe(bot) {
    if (bot.inventory.items().some(i => i.name.endsWith('_hoe'))) return true;
    for (const hoe of ['iron_hoe', 'stone_hoe', 'wooden_hoe']) {
        const before = bot.output;
        if (await skills.craftRecipe(bot, hoe, 1)) return true;
        bot.output = before; // Fehlschläge der schlechteren Varianten nicht ins Log kippen
    }
    skills.log(bot, 'No hoe and cannot craft one (need sticks + planks/cobblestone/iron and a crafting table).');
    return false;
}

export async function harvestCrops(bot, radius = 16, replant = true) {
    /**
     * Harvests only fully grown crops (wheat, carrots, potatoes, beetroots) nearby, replants the same crop and picks up the drops.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} radius, search radius. Defaults to 16.
     * @param {boolean} replant, whether to replant after harvesting. Defaults to true.
     * @returns {Promise<number>} number of crops harvested.
     * @example
     * await skills.harvestCrops(bot, 16);
     **/
    const ripe = world.getNearestBlocksWhere(bot, b => isCropMature(b), radius);
    let harvested = 0, replanted = 0;
    for (const crop of ripe) {
        if (bot.interrupt_code) break;
        const pos = crop.position;
        const current = bot.blockAt(pos);
        if (!isCropMature(current)) continue; // inzwischen verändert
        try {
            if (bot.entity.position.distanceTo(pos) > 4.5)
                await skills.goToPosition(bot, pos.x, pos.y, pos.z, 2);
            if (bot.interrupt_code) break;
            await bot.dig(bot.blockAt(pos));
            harvested++;
        } catch (err) {
            console.log(`Harvest at ${pos} failed: ${err.message}`);
            continue;
        }
        if (!replant) continue;
        await skills.wait(bot, 150); // Drops landen lassen, Saat kommt sofort ins Inventar wenn nah genug
        const soil = bot.blockAt(pos.offset(0, -1, 0));
        if (soil?.name === 'farmland' && bot.blockAt(pos)?.name === 'air' && await plantAt(bot, soil, CROPS[current.name][1]))
            replanted++;
    }
    if (harvested > 0) await skills.pickupNearbyItems(bot);
    skills.log(bot, ripe.length === 0 ? 'No fully grown crops nearby.' : `Harvested ${harvested} crops, replanted ${replanted}.`);
    return harvested;
}

export async function plantEmptyFarmland(bot, seedType = null, radius = 16) {
    /**
     * Plants seeds on all empty farmland nearby. Uses any available seeds (wheat_seeds, carrot, potato, beetroot_seeds) unless seedType is given.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} seedType, optional seed item or crop name, e.g. "wheat_seeds" or "carrot". Defaults to any.
     * @param {number} radius, search radius. Defaults to 16.
     * @returns {Promise<number>} number of seeds planted.
     * @example
     * await skills.plantEmptyFarmland(bot, "carrot");
     **/
    const preferred = seedType ? seedForCrop(seedType) : null;
    if (seedType && !preferred) {
        skills.log(bot, `${seedType} is not a plantable crop. Use wheat_seeds, carrot, potato or beetroot_seeds.`);
        return 0;
    }
    const empty = world.getNearestBlocksWhere(bot, b => b.name === 'farmland' && bot.blockAt(b.position.offset(0, 1, 0))?.name === 'air', radius);
    let planted = 0;
    for (const soil of empty) {
        if (bot.interrupt_code) break;
        const seeds = availableSeeds(bot, preferred);
        if (seeds.length === 0) { skills.log(bot, 'Out of seeds.'); break; }
        if (await plantAt(bot, soil, seeds[0])) planted++;
    }
    if (empty.length) skills.log(bot, `Planted ${planted} of ${empty.length} empty farmland.`);
    return planted;
}

export async function farm(bot, seedType = null, radius = 16, maxNewPlots = 16) {
    /**
     * Full farming cycle: harvest fully grown crops and replant, plant empty farmland, then till new dirt/grass next to water and sow it (crafts a hoe if needed).
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} seedType, optional seed or crop, e.g. "wheat_seeds", "carrot", "potato", "beetroot_seeds". Defaults to any seeds in inventory.
     * @param {number} radius, search radius. Defaults to 16.
     * @param {number} maxNewPlots, max number of new blocks to till. Defaults to 16.
     * @returns {Promise<boolean>} true if anything was harvested or planted.
     * @example
     * await skills.farm(bot, "wheat_seeds");
     **/
    const preferred = seedType ? seedForCrop(seedType) : null;
    if (seedType && !preferred) {
        skills.log(bot, `${seedType} is not a plantable crop. Use wheat_seeds, carrot, potato or beetroot_seeds.`);
        return false;
    }
    let done = await harvestCrops(bot, radius, true);
    if (bot.interrupt_code) return done > 0;
    done += await plantEmptyFarmland(bot, preferred, radius);
    if (bot.interrupt_code || availableSeeds(bot, preferred).length === 0) {
        if (done === 0) skills.log(bot, 'No seeds to plant. Collect some: break grass for wheat_seeds, or harvest crops.');
        return done > 0;
    }

    // Neues Feld: Erde/Gras mit Luft darüber, max. 4 Blöcke (horizontal) von Wasser auf gleicher Höhe -> bleibt feucht.
    const water = world.getNearestBlocks(bot, ['water'], radius, 200).filter(w => w.metadata === 0);
    if (water.length === 0) {
        skills.log(bot, 'No water nearby to start a new field. Go near water or place a water bucket.');
        return done > 0;
    }
    const soft = ['air', 'short_grass', 'grass', 'tall_grass', 'fern', 'dandelion', 'poppy'];
    const candidates = world.getNearestBlocksWhere(bot, b => {
        if (b.name !== 'grass_block' && b.name !== 'dirt') return false;
        if (!soft.includes(bot.blockAt(b.position.offset(0, 1, 0))?.name)) return false;
        return water.some(w => w.position.y === b.position.y &&
            Math.abs(w.position.x - b.position.x) <= 4 && Math.abs(w.position.z - b.position.z) <= 4);
    }, radius, maxNewPlots);
    if (candidates.length === 0) {
        skills.log(bot, 'No tillable dirt/grass next to water nearby.');
        return done > 0;
    }
    if (!await ensureHoe(bot)) return done > 0;
    let tilled = 0;
    for (const b of candidates) {
        if (bot.interrupt_code) break;
        const seeds = availableSeeds(bot, preferred);
        if (seeds.length === 0) break;
        const before = bot.output; // tillAndSow loggt pro Block 2-3 Zeilen -> nur Zusammenfassung behalten
        const ok = await skills.tillAndSow(bot, b.position.x, b.position.y, b.position.z, seeds[0]);
        if (ok) { bot.output = before; tilled++; }
    }
    skills.log(bot, `Tilled and planted ${tilled} new plots near water.`);
    return done + tilled > 0;
}

export async function tendFarm(bot, x, y, z, radius = 12) {
    /**
     * Walks to a farm at the given position, harvests fully grown crops, replants and fills empty farmland. Does not till new land.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, farm center x.
     * @param {number} y, farm center y.
     * @param {number} z, farm center z.
     * @param {number} radius, farm radius. Defaults to 12.
     * @returns {Promise<boolean>} true if anything was harvested or planted.
     * @example
     * await skills.tendFarm(bot, 100, 64, -20);
     **/
    if (bot.entity.position.distanceTo(new Vec3(x, y, z)) > 6)
        await skills.goToPosition(bot, x, y, z, 3);
    if (bot.interrupt_code) return false;
    const harvested = await harvestCrops(bot, radius, true);
    if (bot.interrupt_code) return harvested > 0;
    const planted = await plantEmptyFarmland(bot, null, radius);
    return harvested + planted > 0;
}

async function getOrPlaceFurnace(bot) {
    let block = world.getNearestBlock(bot, 'furnace', 16);
    if (block) return { block, placed: false };
    if (!world.getInventoryCounts(bot)['furnace']) {
        const before = bot.output;
        if (!await skills.craftRecipe(bot, 'furnace', 1)) {
            bot.output = before;
            skills.log(bot, 'No furnace nearby and cannot craft one (need 8 cobblestone and a crafting table).');
            return null;
        }
    }
    const pos = world.getNearestFreeSpace(bot, 1, 8);
    if (!pos || !await skills.placeBlock(bot, 'furnace', pos.x, pos.y, pos.z)) {
        skills.log(bot, 'Could not place a furnace.');
        return null;
    }
    block = world.getNearestBlock(bot, 'furnace', 16);
    return block ? { block, placed: true } : null;
}

export async function smeltAll(bot) {
    /**
     * Smelts ALL raw ores (raw_iron, raw_gold, raw_copper) and raw meat/fish in the inventory in one furnace session. Uses a nearby furnace or places/crafts one, picks fuel automatically and collects the results.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if anything was smelted.
     * @example
     * await skills.smeltAll(bot);
     **/
    const todo = pickSmeltables(world.getInventoryCounts(bot));
    if (todo.length === 0) {
        skills.log(bot, 'Nothing to smelt: no raw ores or raw meat/fish in inventory.');
        return false;
    }
    const fuel = mc.getSmeltingFuel(bot);
    if (!fuel) {
        skills.log(bot, 'No fuel: need coal, charcoal, logs, planks or a lava bucket.');
        return false;
    }
    const furnaceInfo = await getOrPlaceFurnace(bot);
    if (!furnaceInfo || bot.interrupt_code) return false;
    const { block, placed } = furnaceInfo;
    if (bot.entity.position.distanceTo(block.position) > 4)
        await skills.goToPosition(bot, block.position.x, block.position.y, block.position.z, 3);
    if (bot.interrupt_code) return false;

    bot.modes.pause('unstuck');
    const results = {};
    let furnace;
    try {
        await bot.lookAt(block.position);
        furnace = await bot.openFurnace(bot.blockAt(block.position));
        // Fremde Reste raus, damit Input/Fuel-Slot frei sind
        if (furnace.outputItem()) await furnace.takeOutput();
        if (furnace.inputItem()) await furnace.takeInput();
        if (furnace.fuelItem() && furnace.fuelItem().type !== fuel.type) await furnace.takeFuel();

        const total = todo.reduce((s, [, n]) => s + n, 0);
        const perFuel = mc.getFuelSmeltOutput(fuel.name);
        const fuelHave = bot.inventory.items().filter(i => i.type === fuel.type).reduce((s, i) => s + i.count, 0);
        const fuelPut = Math.min(fuelHave, 64, Math.ceil(total / perFuel));
        let capacity = Math.floor(fuelPut * perFuel);
        await furnace.putFuel(fuel.type, null, fuelPut);
        skills.log(bot, `Smelting up to ${Math.min(total, capacity)} of ${total} items with ${fuelPut} ${fuel.name}.`);

        outer: for (const [name, count] of todo) {
            let left = Math.min(count, capacity);
            while (left > 0) {
                if (bot.interrupt_code) break outer;
                const batch = Math.min(left, 64);
                await furnace.putInput(mc.getItemId(name), null, batch);
                let lastProgress = Date.now();
                // Warten bis Input leer ist; ~10 s pro Item, abbrechen wenn 15 s nichts passiert
                while (furnace.inputItem() || furnace.outputItem()) {
                    if (bot.interrupt_code) break outer;
                    await new Promise(r => setTimeout(r, 1000));
                    if (furnace.outputItem()) {
                        const out = await furnace.takeOutput();
                        if (out) { results[out.name] = (results[out.name] || 0) + out.count; lastProgress = Date.now(); }
                    }
                    if (Date.now() - lastProgress > 15000) {
                        skills.log(bot, `Furnace stopped making progress on ${name} (out of fuel?).`);
                        break outer;
                    }
                }
                left -= batch;
                capacity -= batch;
            }
        }
    } catch (err) {
        skills.log(bot, `Smelting failed: ${err.message}`);
    } finally {
        if (furnace) {
            try {
                if (furnace.outputItem()) {
                    const out = await furnace.takeOutput();
                    if (out) results[out.name] = (results[out.name] || 0) + out.count;
                }
                if (furnace.inputItem()) await furnace.takeInput();
                if (furnace.fuelItem()) await furnace.takeFuel();
            } catch (err) { console.log('Furnace cleanup failed:', err.message); }
            bot.closeWindow(furnace);
        }
        bot.modes.unpause('unstuck');
    }
    if (placed && !bot.interrupt_code) await skills.collectBlock(bot, 'furnace', 1);
    const summary = Object.entries(results).map(([n, c]) => `${c} ${n}`).join(', ');
    skills.log(bot, summary ? `Smelted: ${summary}.` : 'Nothing was smelted.');
    return !!summary;
}

export async function breedAnimals(bot, animalType, pairs = 1) {
    /**
     * Breeds animals: finds two adult animals of the type nearby, lures them with the correct food (wheat for cows/sheep, seeds for chickens, carrots for pigs, ...) and feeds both.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} animalType, e.g. "cow", "sheep", "pig", "chicken", "rabbit".
     * @param {number} pairs, number of pairs to breed. Defaults to 1.
     * @returns {Promise<boolean>} true if at least one pair was fed.
     * @example
     * await skills.breedAnimals(bot, "cow");
     **/
    const foods = BREED_FOOD[animalType];
    if (!foods) {
        skills.log(bot, `Don't know how to breed ${animalType}. Known: ${Object.keys(BREED_FOOD).join(', ')}.`);
        return false;
    }
    const inv = world.getInventoryCounts(bot);
    const food = foods.find(f => inv[f] > 0);
    if (!food) {
        skills.log(bot, `Need ${foods.join(' or ')} to breed ${animalType}.`);
        return false;
    }
    const now = Date.now();
    const candidates = world.getNearbyEntities(bot, 24).filter(e =>
        e.name === animalType && !isBabyEntity(e, bot.registry) && !(now - (lastFed.get(e.id) || 0) < BREED_COOLDOWN_MS));
    const want = Math.min(pairs * 2, candidates.length - (candidates.length % 2));
    if (want < 2) {
        skills.log(bot, `Need 2 adult ${animalType} nearby that weren't bred in the last 5 min, found ${candidates.length}.`);
        return false;
    }
    let fed = 0;
    for (const animal of candidates.slice(0, want)) {
        if (bot.interrupt_code) break;
        if (!animal.isValid) continue;
        if (!bot.inventory.items().some(i => i.name === food)) { skills.log(bot, `Ran out of ${food}.`); break; }
        try {
            await skills.equip(bot, food); // Futter in der Hand lockt die Tiere an
            await skills.goToPosition(bot, animal.position.x, animal.position.y, animal.position.z, 2);
            if (bot.interrupt_code) break;
            await skills.equip(bot, food); // Pathfinder kann Werkzeug gewechselt haben
            await bot.lookAt(animal.position.offset(0, animal.height / 2, 0));
            await bot.activateEntity(animal);
            lastFed.set(animal.id, Date.now());
            fed++;
            await skills.wait(bot, 300);
        } catch (err) {
            console.log(`Feeding ${animalType} failed: ${err.message}`);
        }
    }
    const pairsFed = Math.floor(fed / 2);
    skills.log(bot, pairsFed > 0 ? `Fed ${fed} ${animalType} with ${food}: ${pairsFed} pair(s) should breed now.` : `Could not feed two ${animalType}.`);
    return pairsFed > 0;
}
