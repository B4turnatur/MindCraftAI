const STOPPED = 0
const ACTIVE = 1
const PAUSED = 2
const FAILURE_RE = /fail|error|could not|couldn't|cannot|can't|unable|not enough|don't have|no .{0,30} (found|nearby)|timed out|does not exist|not allowed/i;
const HINT_AFTER = 2;   // so viele Fehlschläge/Wiederholungen in Folge -> Strategiewechsel-Hinweis
const GIVE_UP_AFTER = 5; // so viele Fehlschläge in Folge -> Ziel pausieren und Spieler EINMAL Bescheid sagen

// Bewertet die neuen History-Einträge einer Runde: welcher Befehl, hat er geklappt?
export function judgeTurns(turns) {
    let cmd = null, failed = false;
    for (const t of turns) {
        if (t.role === 'assistant') {
            const m = t.content.match(/!\w+(\([^)]*\))?/);
            if (m) cmd = m[0].replace(/\s+/g, ' ').slice(0, 80);
        } else if (t.role === 'system' && !t.content.startsWith('Recent behaviors log') && FAILURE_RE.test(t.content)) {
            failed = true;
        }
    }
    return { cmd, failed };
}

export class SelfPrompter {
    constructor(agent) {
        this.agent = agent;
        this.state = STOPPED;
        this.loop_active = false;
        this.interrupt = false;
        this.prompt = '';
        this.idle_time = 0;
        this.cooldown = 2000;
        this._resetProgress();
    }

    _resetProgress() {
        this.steps = [];        // letzte Schritte: {cmd, failed}
        this.fail_streak = 0;
        this.repeat_streak = 0;
    }

    _record(step) {
        const prev = this.steps[this.steps.length - 1];
        this.repeat_streak = (prev && step.cmd && prev.cmd === step.cmd) ? this.repeat_streak + 1 : 0;
        this.fail_streak = step.failed ? this.fail_streak + 1 : 0;
        this.steps.push(step);
        if (this.steps.length > 5) this.steps.shift();
    }

    _buildPrompt() {
        let msg = `You are self-prompting with the goal: '${this.prompt}'. Work in small steps: pick the next concrete unfinished step toward the goal and do it with exactly one command (!commandName). If the goal is fully done, use !endGoal.`;
        const recent = this.steps.filter(s => s.cmd).slice(-3);
        if (recent.length)
            msg += `\nRecent steps: ${recent.map(s => `${s.cmd} ${s.failed ? '(failed)' : '(ok)'}`).join(', ')}`;
        const last = this.steps[this.steps.length - 1];
        if (this.fail_streak >= HINT_AFTER || this.repeat_streak >= HINT_AFTER)
            msg += `\nYou are STUCK: ${this.fail_streak >= HINT_AFTER ? `the last ${this.fail_streak} steps failed` : `you repeated ${last?.cmd} ${this.repeat_streak + 1} times without progress`}. Do NOT repeat it. Change strategy: get missing materials/tools first, move somewhere else, use a different command, or choose a smaller sub-step.`;
        return msg + '\nRespond:';
    }

    start(prompt) {
        console.log('Self-prompting started.');
        if (!prompt) {
            if (!this.prompt)
                return 'No prompt specified. Ignoring request.';
            prompt = this.prompt;
        }
        this.state = ACTIVE;
        if (prompt !== this.prompt) this._resetProgress();
        this.prompt = prompt;
        this.startLoop();
    }

    isActive() {
        return this.state === ACTIVE;
    }

    isStopped() {
        return this.state === STOPPED;
    }

    isPaused() {
        return this.state === PAUSED;
    }

    async handleLoad(prompt, state) {
        if (state == undefined)
            state = STOPPED;
        this.state = state;
        this.prompt = prompt;
        if (state !== STOPPED && !prompt)
            throw new Error('No prompt loaded when self-prompting is active');
        if (state === ACTIVE) {
            await this.start(prompt);
        }
    }

    setPromptPaused(prompt) {
        this.prompt = prompt;
        this.state = PAUSED;
    }

    async startLoop() {
        if (this.loop_active) {
            console.warn('Self-prompt loop is already active. Ignoring request.');
            return;
        }
        console.log('starting self-prompt loop')
        this.loop_active = true;
        let no_command_count = 0;
        const MAX_NO_COMMAND = 3;
        let gave_up = false;
        while (!this.interrupt) {
            const msg = this._buildPrompt();
            const turns = this.agent.history.turns;
            const marker = turns[turns.length - 1];

            let used_command = await this.agent.handleMessage('system', msg, -1);
            // neue Einträge seit dem Prompt (History kann zwischendurch zusammengefasst/gekürzt werden)
            const idx = this.agent.history.turns.lastIndexOf(marker);
            const new_turns = idx >= 0 ? this.agent.history.turns.slice(idx + 1) : this.agent.history.turns.slice(-6);
            if (!used_command) {
                no_command_count++;
                if (no_command_count >= MAX_NO_COMMAND) {
                    // leise stoppen statt englischer Systemmeldung im Chat/TTS
                    console.warn(`Agent did not use command in the last ${MAX_NO_COMMAND} auto-prompts. Stopping auto-prompting.`);
                    this.state = STOPPED;
                    break;
                }
            }
            else {
                no_command_count = 0;
                if (this.interrupt) break;
                this._record(judgeTurns(new_turns));
                if (this.fail_streak >= GIVE_UP_AFTER) {
                    console.warn(`Self-prompt stuck: ${this.fail_streak} failed steps in a row. Pausing goal.`);
                    this.state = STOPPED; // Ziel bleibt in this.prompt, !goal ohne neuen Text o. Spieler kann es neu anstoßen
                    gave_up = true;
                    break;
                }
                // bei Problemen etwas länger warten, damit nichts im Sekundentakt gespammt wird
                const wait = this.cooldown * (1 + Math.min(this.fail_streak + this.repeat_streak, 5));
                await new Promise(r => setTimeout(r, wait));
            }
        }
        console.log('self prompt loop stopped')
        this.loop_active = false;
        this.interrupt = false;
        if (gave_up) {
            const goal = this.prompt;
            this._resetProgress();
            // Miku sagt es selbst, EINMAL, in ihrer Sprache
            await this.agent.handleMessage('system',
                `You stopped working on your goal '${goal}' because the last steps kept failing. Tell the player in ONE short sentence that you are stuck and what you need or will try later. Do not use any command.`, 1);
        }
    }

    update(delta) {
        // automatically restarts loop
        if (this.state === ACTIVE && !this.loop_active && !this.interrupt) {
            if (this.agent.isIdle())
                this.idle_time += delta;
            else
                this.idle_time = 0;

            if (this.idle_time >= this.cooldown) {
                console.log('Restarting self-prompting...');
                this.startLoop();
                this.idle_time = 0;
            }
        }
        else {
            this.idle_time = 0;
        }
    }

    async stopLoop() {
        // you can call this without await if you don't need to wait for it to finish
        if (this.interrupt)
            return;
        console.log('stopping self-prompt loop')
        this.interrupt = true;
        while (this.loop_active) {
            await new Promise(r => setTimeout(r, 500));
        }
        this.interrupt = false;
    }

    async stop(stop_action=true) {
        this.interrupt = true;
        if (stop_action)
            await this.agent.actions.stop();
        this.stopLoop();
        this.state = STOPPED;
    }

    async pause() {
        this.interrupt = true;
        await this.agent.actions.stop();
        this.stopLoop();
        this.state = PAUSED;
    }

    shouldInterrupt(is_self_prompt) { // to be called from handleMessage
        return is_self_prompt && (this.state === ACTIVE || this.state === PAUSED) && this.interrupt;
    }

    handleUserPromptedCmd(is_self_prompt, is_action) {
        // if a user messages and the bot responds with an action, stop the self-prompt loop
        if (!is_self_prompt && is_action) {
            this.stopLoop();
            // this stops it from responding from the handlemessage loop and the self-prompt loop at the same time
        }
    }
}