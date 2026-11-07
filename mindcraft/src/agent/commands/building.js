// Neue Befehle (building). Format wie in actions.js; wird in commands/index.js eingebunden.
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';

// Wie runAsAction in actions.js, aber mit festem Label (das dortige sucht den Namen nur in actionsList).
function runAsAction(label, actionFn, resume = false, timeout = -1) {
    return async function (agent, ...args) {
        const res = await agent.actions.runAction(`action:${label}`, async () => { await actionFn(agent, ...args); }, { timeout, resume });
        if (res.interrupted && !res.timedout) return;
        return res.message;
    };
}

// Freundlicher Spieler für Position/Blickrichtung: der zuletzt sprechende, sonst der nächste Spieler.
function anchorPlayer(agent) {
    const last = agent.last_sender;
    if (last && agent.bot.players[last]?.entity) return last;
    return world.getNearbyPlayerNames(agent.bot)[0] || null;
}

export const buildingActions = [
    {
        name: '!buildTemplate',
        description: 'Build a ready-made structure in front of your friend (uses their position and the direction they look): '
            + '"hut" (5x5 with door, roof and torch), "tower" (watch tower with ladder and platform), "bridge" (across the gap they look at), '
            + '"wall" (stone wall ring around them) or "fence" (fence ring). Counts and gathers/crafts the materials itself. '
            + 'Example: !buildTemplate("hut", "oak_planks")',
        params: {
            'name': { type: 'string', description: 'Template: hut, tower, bridge, wall or fence.' },
            'material': { type: 'BlockName', description: 'Main block, e.g. "oak_planks", "cobblestone", "stone_bricks".' }
        },
        perform: runAsAction('buildTemplate', async (agent, name, material) => {
            await skills.buildTemplate(agent.bot, name, material, anchorPlayer(agent));
        }, false, 15)
    },
    {
        name: '!storeItems',
        description: 'Put all non-essential items (blocks, ores, mob drops, plants…) into nearby chests, sorted by category. Keeps tools, weapons, armour, food and torches.',
        params: {},
        perform: runAsAction('storeItems', async (agent) => {
            await skills.storeItems(agent.bot);
        }, false, 5)
    },
    {
        name: '!sortChests',
        description: 'Tidy up the nearby chests: move misplaced items so each chest holds one category (wood, stone, ores, mob drops, plants, redstone, misc), and store your own extra items too.',
        params: {},
        perform: runAsAction('sortChests', async (agent) => {
            await skills.sortChests(agent.bot);
        }, false, 8)
    },
    {
        name: '!fetchFromChests',
        description: 'Search all nearby chests and take the given item. Partial names work ("log" = any log).',
        params: {
            'item_name': { type: 'string', description: 'Item name, e.g. "iron_ingot" or "log".' },
            'num': { type: 'int', description: 'How many to take.', domain: [1, 2305] }
        },
        perform: runAsAction('fetchFromChests', async (agent, item_name, num) => {
            await skills.fetchFromChests(agent.bot, item_name, num);
        }, false, 5)
    },
    {
        name: '!makeStorage',
        description: 'Craft and place a double chest at the saved "base" (or right here if there is no base).',
        params: {},
        perform: runAsAction('makeStorage', async (agent) => {
            const base = agent.memory_bank?.recallPlace('base');
            if (base && agent.bot.entity.position.distanceTo({ x: base[0], y: base[1], z: base[2] }) > 6) {
                await skills.goToPosition(agent.bot, base[0], base[1], base[2], 2);
                if (agent.bot.interrupt_code) return;
            }
            await skills.makeStorage(agent.bot);
        }, false, 5)
    },
];
