// Neue Befehle (farming). Format wie in actions.js; wird in commands/index.js eingebunden.
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';

const FARM_PLACE = 'farm'; // Name im memory_bank, gleicher Speicher wie !rememberHere

// Wie runAsAction in actions.js, aber mit festem Label (das Original sucht nur in actionsList).
function runAsAction(label, actionFn, resume = false, timeout = -1) {
    return async function (agent, ...args) {
        const code_return = await agent.actions.runAction(`action:${label}`, () => actionFn(agent, ...args), { timeout, resume });
        if (code_return.interrupted && !code_return.timedout)
            return;
        return code_return.message;
    };
}

export const farmingActions = [
    {
        name: '!farm',
        description: 'Farm near your position: harvest only fully grown crops and replant, sow empty farmland, then till dirt/grass next to water and plant it (crafts a hoe if needed). Remembers the spot as "farm" for !tendFarm.',
        params: {
            'seed_type': { type: 'string', description: 'Seed or crop to plant: wheat_seeds, carrot, potato, beetroot_seeds, or "any" for all seeds in inventory.' },
        },
        perform: runAsAction('farm', async (agent, seed_type) => {
            const pos = world.getPosition(agent.bot);
            const seed = !seed_type || seed_type === 'any' ? null : seed_type;
            if (await skills.farm(agent.bot, seed, 16)) {
                agent.memory_bank.rememberPlace(FARM_PLACE, pos.x, pos.y, pos.z);
                skills.log(agent.bot, `Remembered this farm as "${FARM_PLACE}".`);
            }
        })
    },
    {
        name: '!tendFarm',
        description: 'Go back to the remembered farm (set by !farm or !rememberHere("farm")), harvest fully grown crops, replant and fill empty farmland.',
        params: {},
        perform: runAsAction('tendFarm', async (agent) => {
            const pos = agent.memory_bank.recallPlace(FARM_PLACE);
            if (!pos) {
                skills.log(agent.bot, 'No farm remembered yet. Use !farm first or !rememberHere("farm").');
                return;
            }
            await skills.tendFarm(agent.bot, pos[0], pos[1], pos[2], 12);
        })
    },
    {
        name: '!smeltAll',
        description: 'Smelt ALL raw ores (raw_iron/gold/copper) and raw meat/fish in your inventory in one go. Uses a nearby furnace or places/crafts one, picks fuel automatically and collects the results.',
        params: {},
        perform: runAsAction('smeltAll', async (agent) => {
            await skills.smeltAll(agent.bot);
        })
    },
    {
        name: '!breedAnimals',
        description: 'Breed two adult animals of a type nearby by luring and feeding them the right food (wheat: cow/sheep/goat, seeds: chicken, carrot: pig/rabbit, ...).',
        params: {
            'animal_type': { type: 'string', description: 'Animal to breed, e.g. cow, sheep, pig, chicken, rabbit.' },
            'pairs': { type: 'int', description: 'Number of pairs to breed.', domain: [1, 6] }, // [1,6) = 1..5
        },
        perform: runAsAction('breedAnimals', async (agent, animal_type, pairs) => {
            await skills.breedAnimals(agent.bot, animal_type, pairs);
        })
    },
];
