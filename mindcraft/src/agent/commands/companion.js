// Neue Befehle (companion). Format wie in actions.js; wird in commands/index.js eingebunden.
import * as skills from '../library/skills.js';

function runAsAction(label, actionFn, resume = false, timeout = -1) {
    // wie actions.js, aber mit festem Label (actions.js sucht das Label in seiner eigenen Liste)
    return async function (agent, ...args) {
        const code_return = await agent.actions.runAction(`action:${label}`, async () => {
            await actionFn(agent, ...args);
        }, { timeout, resume });
        if (code_return.interrupted && !code_return.timedout) return;
        return code_return.message;
    };
}

export const companionActions = [
    {
        name: '!escort',
        description: 'Escort a player like a bodyguard: keep 2-4 blocks distance, sprint to catch up, swim, step out of their way. Better than !followPlayer for walking together.',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to escort.' }
        },
        perform: runAsAction('escort', async (agent, player_name) => {
            await skills.escortPlayer(agent.bot, player_name, 2, 4);
        }, true)
    },
    {
        name: '!guard',
        description: 'Stand guard at the current spot and fight hostile mobs that come close, then return to the post.',
        params: {
            'seconds': { type: 'int', description: 'How long to guard. -1 for forever.', domain: [-1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction('guard', async (agent, seconds) => {
            await skills.guardArea(agent.bot, seconds, 10);
        })
    },
    {
        name: '!fight',
        description: 'Smart fight against all nearby hostile mobs: best weapon + shield, bow vs ranged mobs, dodge creepers, retreat and eat at low health. Never attacks players or pets.',
        params: {
            'range': { type: 'int', description: 'Fight radius in blocks.', domain: [4, 32] }
        },
        perform: runAsAction('fight', async (agent, range) => {
            await skills.smartCombat(agent.bot, range);
        })
    },
];
