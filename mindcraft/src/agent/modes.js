import * as skills from './library/skills.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import settings from './settings.js'
import convoManager from './conversation.js';

async function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    agent.openChat(message);
}

// --- Menschliches Verhalten (idle_staring / idle_fidget) - Stellschrauben ---
const LOOK_SMOOTH = 0.55;              // Anteil der Restdrehung pro Tick (300 ms): 1 = sofort schnappen, kleiner = weicher
const LOOK_MIN_STEP = 0.05;            // rad, darunter direkt aufs Ziel (kein ewiges Zittern)
const GAZE_FOLLOW_CHANCE = 0.25;       // Chance, beim Blickwechsel dahin zu schauen, wo der Spieler hinschaut
const FIDGET_MIN_MS = 25e3;            // Abstand zwischen kleinen Gesten (hüpfen, ducken, Arm schwingen, bummeln)
const FIDGET_MAX_MS = 70e3;
const WANDER_CHANCE = 0.35;            // Anteil der Gesten, die ein kleiner Bummel (2-5 Blöcke) sind
const WANDER_MAX_FRIEND_DIST = 10;     // nur bummeln, wenn der Freund so nah ist
const AFK_SIT_MS = 45e3;               // Freund steht so lange völlig still -> Miku "setzt sich" (Sneak halten)
const AFK_SIT_DIST = 8;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a)); // auf -PI..PI

// Weich hinschauen statt Kopf-Schnappen: dreht pro Aufruf (= pro 300-ms-Tick) nur einen Teil der Strecke
function smoothLookAt(bot, point) {
    const eye = bot.entity.position.offset(0, bot.entity.height ?? 1.62, 0);
    const d = point.minus(eye);
    smoothLook(bot, Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.sqrt(d.x * d.x + d.z * d.z)));
}
function smoothLook(bot, yaw, pitch) {
    const dy = wrapAngle(yaw - bot.entity.yaw), dp = pitch - bot.entity.pitch;
    if (Math.abs(dy) < 0.01 && Math.abs(dp) < 0.01) return;
    const step = (v) => Math.abs(v) < LOOK_MIN_STEP ? v : v * LOOK_SMOOTH;
    bot.look(bot.entity.yaw + step(dy), bot.entity.pitch + step(dp), true).catch(() => {});
}
// Blickrichtung eines Spielers als Vektor (mineflayer-Konvention, gleiche Formel wie bot.lookAt)
function viewDir(e) {
    const c = Math.cos(e.pitch);
    return { x: -Math.sin(e.yaw) * c, y: Math.sin(e.pitch), z: -Math.cos(e.yaw) * c };
}
// life.js setzt bot.lookOverrideUntil für Emotes (nicken, zu Boden schauen) -> Blick-Modi halten dann still
const lookLocked = (bot) => (bot.lookOverrideUntil || 0) > Date.now();

function stopSitting(bot) {
    const m = modes_map.idle_fidget;
    if (m?.sitting) { m.sitting = false; bot.setControlState('sneak', false); }
}

// a mode is a function that is called every tick to respond immediately to the world
// it has the following fields:
// on: whether 'update' is called every tick
// active: whether an action has been triggered by the mode and hasn't yet finished
// paused: whether the mode is paused by another action that overrides the behavior (eg followplayer implements its own self defense)
// update: the function that is called every tick (if on is true)
// when a mode is active, it will trigger an action to be performed but won't wait for it to return output

// the order of this list matters! first modes will be prioritized
// while update functions are async, they should *not* be awaited longer than ~100ms as it will block the update loop
// to perform longer actions, use the execute function which won't block the update loop
const modes_list = [
    {
        name: 'self_preservation',
        description: 'Respond to drowning, burning, and damage at low health. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        fall_blocks: ['sand', 'gravel', 'concrete_powder'], // includes matching substrings like 'sandstone' and 'red_sand'
        update: async function (agent) {
            const bot = agent.bot;
            let block = bot.blockAt(bot.entity.position);
            let blockAbove = bot.blockAt(bot.entity.position.offset(0, 1, 0));
            if (!block) block = {name: 'air'}; // hacky fix when blocks are not loaded
            if (!blockAbove) blockAbove = {name: 'air'};
            if (blockAbove.name === 'water') {
                // does not call execute so does not interrupt other actions
                if (!bot.pathfinder.goal) {
                    bot.setControlState('jump', true);
                }
            }
            else if (this.fall_blocks.some(name => blockAbove.name.includes(name))) {
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 2);
                });
            }
            else if (block.name === 'lava' || block.name === 'fire' ||
                blockAbove.name === 'lava' || blockAbove.name === 'fire') {
                say(agent, 'I\'m on fire!');
                // block may be the {name:'air'} fallback without position -> use own position
                const firePos = block.position || bot.entity.position.floored();
                execute(this, agent, async () => {
                    // if you have a water bucket, use it
                    if (bot.inventory.findInventoryItem('water_bucket')) {
                        let success = await skills.placeBlock(bot, 'water_bucket', firePos.x, firePos.y, firePos.z);
                        if (success) say(agent, 'Placed some water, ahhhh that\'s better!');
                        return;
                    }
                    let nearestWater = world.getNearestBlock(bot, 'water', 20);
                    if (nearestWater) {
                        const pos = nearestWater.position;
                        let success = await skills.goToPosition(bot, pos.x, pos.y, pos.z, 0.2);
                        if (success) say(agent, 'Found some water, ahhhh that\'s better!');
                        return;
                    }
                    await skills.moveAway(bot, 5);
                });
            }
            else if (Date.now() - bot.lastDamageTime < 3000 && (bot.health < 5 || bot.lastDamageTaken >= bot.health)) {
                say(agent, 'I\'m dying!');
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 20);
                });
            }
            else if (agent.isIdle()) {
                // clear jump if not in danger or doing anything else (sneak bleibt, solange idle_fidget "sitzt")
                if (modes_map.idle_fidget?.sitting) {
                    for (const c of ['forward', 'back', 'left', 'right', 'jump', 'sprint']) bot.setControlState(c, false);
                } else bot.clearControlStates();
            }
        }
    },
    {
        name: 'unstuck',
        description: 'Attempt to get unstuck when in the same place for a while. Interrupts some actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        prev_location: null,
        distance: 2,
        stuck_time: 0,
        last_time: Date.now(),
        max_stuck_time: 20,
        prev_dig_block: null,
        update: async function (agent) {
            if (agent.isIdle()) { 
                this.prev_location = null;
                this.stuck_time = 0;
                return; // don't get stuck when idle
            }
            const bot = agent.bot;
            const cur_dig_block = bot.targetDigBlock;
            if (cur_dig_block && !this.prev_dig_block) {
                this.prev_dig_block = cur_dig_block;
            }
            if (this.prev_location && this.prev_location.distanceTo(bot.entity.position) < this.distance && cur_dig_block == this.prev_dig_block) {
                // cap delta: last_time is stale if this mode was skipped (other mode active, paused) -> no false 'stuck'
                this.stuck_time += Math.min(Date.now() - this.last_time, 2000) / 1000;
            }
            else {
                this.prev_location = bot.entity.position.clone();
                this.stuck_time = 0;
                this.prev_dig_block = null;
            }
            const max_stuck_time = cur_dig_block?.name === 'obsidian' ? this.max_stuck_time * 2 : this.max_stuck_time;
            if (this.stuck_time > max_stuck_time) {
                say(agent, 'I\'m stuck!');
                this.stuck_time = 0;
                execute(this, agent, async () => {
                    const crashTimeout = setTimeout(() => { agent.cleanKill("Got stuck and couldn't get unstuck") }, 10000);
                    try {
                        await skills.moveAway(bot, 5);
                    } finally {
                        clearTimeout(crashTimeout); // also on PathStopped/interrupt, else process gets killed 10s later
                    }
                    say(agent, 'I\'m free.');
                });
            }
            this.last_time = Date.now();
        },
        unpause: function () {
            this.prev_location = null;
            this.stuck_time = 0;
            this.prev_dig_block = null;
        }
    },
    {
        name: 'smart_combat',
        description: 'Fight hostile mobs smartly: best weapon + shield, bow vs ranged mobs, dodge creepers, retreat and eat at low health, protect nearby players. Never hits players or pets. Replaces self_defense when on. Interrupts all actions.',
        interrupts: ['all'],
        on: false,
        active: false,
        update: async function (agent) {
            const bot = agent.bot;
            const enemy = skills.pickTarget(bot, 10);
            if (!enemy) return;
            const close = bot.entity.position.distanceTo(enemy.position) < 4;
            if (close || enemy.name === 'creeper' || await world.isClearPath(bot, enemy)) {
                say(agent, `Fighting ${enemy.name.replaceAll('_', ' ')}!`);
                execute(this, agent, async () => {
                    await skills.smartCombat(bot, 12);
                });
            }
        }
    },
    {
        name: 'cowardice',
        description: 'Run away from enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const enemy = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity), 16);
            if (enemy && await world.isClearPath(agent.bot, enemy)) {
                say(agent, `Aaa! A ${enemy.name.replaceAll("_", " ")}!`);
                execute(this, agent, async () => {
                    await skills.avoidEnemies(agent.bot, 24);
                });
            }
        }
    },
    {
        name: 'self_defense',
        description: 'Attack nearby enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const enemy = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity), 8);
            if (enemy && await world.isClearPath(agent.bot, enemy)) {
                say(agent, `Fighting ${enemy.name}!`);
                execute(this, agent, async () => {
                    await skills.defendSelf(agent.bot, 8);
                });
            }
        }
    },
    {
        name: 'hunting',
        description: 'Hunt nearby animals when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        update: async function (agent) {
            const huntable = world.getNearestEntityWhere(agent.bot, entity => mc.isHuntable(entity), 8);
            if (huntable && await world.isClearPath(agent.bot, huntable)) {
                execute(this, agent, async () => {
                    say(agent, `Hunting ${huntable.name}!`);
                    await skills.attackEntity(agent.bot, huntable);
                });
            }
        }
    },
    {
        name: 'item_collecting',
        description: 'Collect nearby items when idle.',
        interrupts: ['action:followPlayer', 'action:escort'],
        on: true,
        active: false,

        wait: 2, // number of seconds to wait after noticing an item to pick it up
        prev_item: null,
        noticed_at: -1,
        update: async function (agent) {
            let item = world.getNearestEntityWhere(agent.bot, entity => entity.name === 'item', 8);
            let empty_inv_slots = agent.bot.inventory.emptySlotCount();
            if (item && item !== this.prev_item && await world.isClearPath(agent.bot, item) && empty_inv_slots > 1) {
                if (this.noticed_at === -1) {
                    this.noticed_at = Date.now();
                }
                if (Date.now() - this.noticed_at > this.wait * 1000) {
                    say(agent, `Picking up item!`);
                    this.prev_item = item;
                    execute(this, agent, async () => {
                        await skills.pickupNearbyItems(agent.bot);
                    });
                    this.noticed_at = -1;
                }
            }
            else {
                this.noticed_at = -1;
            }
        }
    },
    {
        name: 'night_routine',
        description: 'Eat when hungry; at night place torches in dark spots near the player and sleep in a nearby bed when the player sleeps or nobody is around.',
        interrupts: ['action:followPlayer', 'action:escort'],
        on: false,
        active: false,
        last_check: 0,
        last_torch: 0,
        last_sleep: 0,
        update: function (agent) {
            if (Date.now() - this.last_check < 2000) return;
            this.last_check = Date.now();
            const bot = agent.bot;
            if (bot.food <= 14 && skills.hasFood(bot)) {
                say(agent, 'Snack time!');
                execute(this, agent, async () => { await skills.eatBest(bot); });
                return;
            }
            if (!skills.isNightTime(bot.time.timeOfDay)) return;
            const player = world.getNearestEntityWhere(bot, e => e.type === 'player' && e !== bot.entity, 32);
            const playerSleeping = player?.metadata?.[6] === 2; // Pose SLEEPING
            if ((playerSleeping || !player) && Date.now() - this.last_sleep > 30000 &&
                bot.findBlock({ matching: b => b.name.endsWith('_bed'), maxDistance: 16 })) {
                this.last_sleep = Date.now(); // Schlafen kann scheitern (Monster in der Nähe) -> nicht spammen
                say(agent, 'Good night!');
                execute(this, agent, async () => { await skills.goToBed(bot); });
                return;
            }
            if (Date.now() - this.last_torch > 8000 && bot.inventory.findInventoryItem('torch')) {
                const center = (player || bot.entity).position;
                if (skills.findDarkSpot(bot, center)) {
                    this.last_torch = Date.now();
                    execute(this, agent, async () => { await skills.placeTorchNear(bot, center); });
                }
            }
        }
    },
    {
        name: 'torch_placing',
        description: 'Place torches when idle and there are no torches nearby.',
        interrupts: ['action:followPlayer', 'action:escort'],
        on: true,
        active: false,
        cooldown: 5,
        last_place: Date.now(),
        update: function (agent) {
            if (world.shouldPlaceTorch(agent.bot)) {
                if (Date.now() - this.last_place < this.cooldown * 1000) return;
                execute(this, agent, async () => {
                    const pos = agent.bot.entity.position;
                    await skills.placeBlock(agent.bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
                });
                this.last_place = Date.now();
            }
        }
    },
    {
        name: 'elbow_room',
        description: 'Move away from nearby players when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        distance: 0.5,
        update: async function (agent) {
            const player = world.getNearestEntityWhere(agent.bot, entity => entity.type === 'player', this.distance);
            if (player) {
                execute(this, agent, async () => {
                    // wait a random amount of time to avoid identical movements with other bots
                    const wait_time = Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, wait_time));
                    if (agent.bot.entities[player.id] && player.position.distanceTo(agent.bot.entity.position) < this.distance) {
                        await skills.moveAwayFromEntity(agent.bot, player, this.distance);
                    }
                });
            }
        }
    },
    {
        name: 'idle_staring',
        description: 'Animation to look around at entities when idle.',
        interrupts: [],
        on: true,
        active: false,

        staring: false,
        last_entity: null,
        next_change: 0,
        target: null, // {yaw, pitch} oder {point} - wird über mehrere Ticks weich angesteuert
        update: function (agent) {
            const bot = agent.bot;
            if (lookLocked(bot)) return;
            const entity = bot.nearestEntity(e => e.type === 'player' && e.username !== agent.name && e.position.distanceTo(bot.entity.position) < 10)
                || bot.nearestEntity(e => e.name !== 'item' && e.name !== 'bat' && e.name !== 'experience_orb');
            let entity_in_view = entity && entity.position.distanceTo(bot.entity.position) < 10 && entity.name !== 'enderman';
            if (entity_in_view && entity !== this.last_entity) {
                this.staring = true;
                this.last_entity = entity;
                this.next_change = Date.now() + Math.random() * 1200 + 1500;
            }
            if (entity_in_view && this.staring) {
                let isbaby = entity.type !== 'player' && entity.metadata?.[16];
                let height = (isbaby ? entity.height/2 : entity.height) || 0;
                if (entity.type === 'player') height = (entity.height || 1.8) * 0.9; // in die Augen, nicht auf den Scheitel
                smoothLookAt(bot, entity.position.offset(0, height, 0));
            }
            else if (this.target?.point) smoothLookAt(bot, this.target.point);
            else if (this.target) smoothLook(bot, this.target.yaw, this.target.pitch);
            if (!entity_in_view)
                this.last_entity = null;
            if (Date.now() > this.next_change) {
                this.staring = Math.random() < 0.3;
                this.target = null;
                if (!this.staring) {
                    const friend = entity_in_view && entity.type === 'player' ? entity : null;
                    if (friend && Math.random() < GAZE_FOLLOW_CHANCE) {
                        // neugierig dahin schauen, wo der Freund hinschaut (~6 Blöcke vor ihm)
                        const v = viewDir(friend), eyeH = (friend.height || 1.8) * 0.9;
                        this.target = { point: friend.position.offset(v.x * 6, eyeH + v.y * 6, v.z * 6) };
                    } else { // look in random direction
                        this.target = { yaw: bot.entity.yaw + (Math.random() - 0.5) * 1.2, pitch: (Math.random() - 0.5) * 0.25 };
                    }
                }
                this.next_change = Date.now() + Math.random() * 10000 + 2000;
            }
        }
    },
    {
        name: 'idle_fidget',
        description: 'Small human gestures when idle: hop, sneak-tap, swing arm, stroll a few blocks near the player (never into their view), sit (hold sneak) while the player is AFK.',
        interrupts: [],
        on: true,
        active: false,

        sitting: false,
        next_fidget: Date.now() + FIDGET_MIN_MS,
        friend_pos: null,
        friend_yaw: 0,
        friend_still_since: 0,
        update: function (agent) {
            const bot = agent.bot;
            const now = Date.now();
            const friend = bot.nearestEntity(e => e.type === 'player' && e.username !== agent.name);
            const dist = friend ? friend.position.distanceTo(bot.entity.position) : Infinity;

            // AFK-Erkennung: Position UND Blickrichtung unverändert
            if (friend && this.friend_pos && friend.position.distanceTo(this.friend_pos) < 0.1 && Math.abs(wrapAngle(friend.yaw - this.friend_yaw)) < 0.02) {
                this.friend_still_since ||= now;
            } else {
                this.friend_still_since = 0;
            }
            if (friend) { this.friend_pos = friend.position.clone(); this.friend_yaw = friend.yaw; }
            const afk = this.friend_still_since > 0 && now - this.friend_still_since > AFK_SIT_MS && dist < AFK_SIT_DIST;
            bot.friend_afk_since = afk ? this.friend_still_since : 0; // für life.js (Kommentar bei langem AFK)
            if (afk && !this.sitting) { this.sitting = true; bot.setControlState('sneak', true); }
            else if (!afk && this.sitting) stopSitting(bot);

            // Nie in einen Gedanken / ein !goal reinzappeln
            if (agent.self_prompter.isActive() || agent.thinking > 0) { this.next_fidget = Math.max(this.next_fidget, now + 5000); return; }
            if (this.sitting || now < this.next_fidget) return;
            this.next_fidget = now + FIDGET_MIN_MS + Math.random() * (FIDGET_MAX_MS - FIDGET_MIN_MS);

            if (friend && dist < WANDER_MAX_FRIEND_DIST && Math.random() < WANDER_CHANCE) {
                // kleiner Bummel in der Nähe des Freundes, aber nicht vor seine Nase
                const v = viewDir(friend);
                for (let i = 0; i < 6; i++) {
                    const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 3;
                    if (Math.cos(a) * v.x + Math.sin(a) * v.z > 0.6) continue; // läge in seinem Blickfeld
                    const tx = friend.position.x + Math.cos(a) * r, ty = friend.position.y, tz = friend.position.z + Math.sin(a) * r;
                    execute(this, agent, async () => {
                        await sleep(300 + Math.random() * 900); // kurz zögern wie ein Mensch
                        await skills.goToPosition(bot, tx, ty, tz, 1);
                    });
                    return;
                }
            }
            const g = Math.random();
            if (g < 0.35) { // kleiner Hüpfer
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 250);
            } else if (g < 0.65) { // kurz ducken
                bot.setControlState('sneak', true);
                setTimeout(() => { if (!this.sitting) bot.setControlState('sneak', false); }, 400 + Math.random() * 500);
            } else { // Arm schwingen / in die Luft boxen
                bot.swingArm();
            }
        }
    },
    {
        name: 'cheat',
        description: 'Use cheats to instantly place blocks and teleport.',
        interrupts: [],
        on: false,
        active: false,
        update: function (agent) { /* do nothing */ }
    }
];

async function execute(mode, agent, func, timeout=-1) {
    if (agent.self_prompter.isActive())
        agent.self_prompter.stopLoop();
    let interrupted_action = agent.actions.currentActionLabel;
    mode.active = true;
    let code_return = await agent.actions.runAction(`mode:${mode.name}`, async () => {
        // Mode actions are reflexes: errors (mostly PathStopped/GoalChanged/NoPath from pathfinder.goto when another
        // action interrupts or the path is reset) must not surface as '!!Code threw exception!!' - that path in
        // action_manager also calls cancelResume() and would wipe the resume (e.g. followPlayer) of the interrupter.
        try {
            await func();
        } catch (err) {
            if (!agent.bot.interrupt_code)
                agent.bot.modes.behavior_log += `${mode.name} failed: ${err?.name || 'Error'}: ${err?.message || err}\n`;
            console.log(`Mode ${mode.name} action stopped: ${err?.name || err}`);
        }
    }, { timeout });
    mode.active = false;
    console.log(`Mode ${mode.name} finished executing, code_return: ${code_return.message}`);

    let should_reprompt = 
        interrupted_action && // it interrupted a previous action
        !agent.actions.resume_func && // there is no resume function
        !agent.self_prompter.isActive() && // self prompting is not on
        !code_return.interrupted; // this mode action was not interrupted by something else

    if (should_reprompt) {
        // auto prompt to respond to the interruption
        let role = convoManager.inConversation() ? agent.last_sender : 'system';
        let logs = agent.bot.modes.flushBehaviorLog();
        agent.handleMessage(role, `(AUTO MESSAGE)Your previous action '${interrupted_action}' was interrupted by ${mode.name}.
        Your behavior log: ${logs}\nRespond accordingly.`);
    }
}

let _agent = null;
const modes_map = {};
for (let mode of modes_list) {
    modes_map[mode.name] = mode;
}

class ModeController {
    /*
    SECURITY WARNING:
    ModesController must be reference isolated. Do not store references to external objects like `agent`.
    This object is accessible by LLM generated code, so any stored references are also accessible.
    This can be used to expose sensitive information by malicious prompters.
    */
    constructor() {
        this.behavior_log = '';
    }

    exists(mode_name) {
        return modes_map[mode_name] != null;
    }

    setOn(mode_name, on) {
        modes_map[mode_name].on = on;
    }

    isOn(mode_name) {
        return modes_map[mode_name].on;
    }

    pause(mode_name) {
        modes_map[mode_name].paused = true;
    }

    unpause(mode_name) {
        const mode = modes_map[mode_name];
        //if  unpause func is defined and mode is currently paused
        if (mode.unpause && mode.paused) {
            mode.unpause();
        }
        mode.paused = false;
    }

    unPauseAll() {
        for (let mode of modes_list) {
            if (mode.paused) console.log(`Unpausing mode ${mode.name}`);
            this.unpause(mode.name);
        }
    }

    getMiniDocs() { // no descriptions
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on})`;
        }
        return res;
    }

    getDocs() {
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on}): ${mode.description}`;
        }
        return res;
    }

    async update() {
        if (_agent.isIdle()) {
            this.unPauseAll();
        } else {
            stopSitting(_agent.bot); // Aktion gestartet -> sofort aufstehen, sonst schleicht sie die ganze Aufgabe
        }
        for (let mode of modes_list) {
            let interruptible = mode.interrupts.some(i => i === 'all') || mode.interrupts.some(i => i === _agent.actions.currentActionLabel);
            if (mode.on && !mode.paused && !mode.active && (_agent.isIdle() || interruptible)) {
                try {
                    await mode.update(_agent);
                } catch (err) {
                    // an exception here would end agent.js' update while-loop for good (all modes dead)
                    console.warn(`Mode ${mode.name} update error:`, err?.message || err);
                }
            }
            if (mode.active) break;
        }
    }

    flushBehaviorLog() {
        const log = this.behavior_log;
        this.behavior_log = '';
        return log;
    }

    getJson() {
        let res = {};
        for (let mode of modes_list) {
            res[mode.name] = mode.on;
        }
        return res;
    }

    loadJson(json) {
        for (let mode of modes_list) {
            if (json[mode.name] != undefined) {
                mode.on = json[mode.name];
            }
        }
    }
}

export function initModes(agent) {
    _agent = agent;
    // the mode controller is added to the bot object so it is accessible from anywhere the bot is used
    agent.bot.modes = new ModeController();
    if (agent.task) {
        agent.bot.restrict_to_inventory = agent.task.restrict_to_inventory;
    }
    let modes_json = agent.prompter.getInitModes();
    if (modes_json) {
        agent.bot.modes.loadJson(modes_json);
    }
}
