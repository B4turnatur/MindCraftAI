import { Vec3 } from 'vec3';
import { Camera } from "./camera.js";
import fs from 'fs';
import * as skills from '../library/skills.js';

const MIN_BUILD_REVIEW = 15; // erst ab so vielen gesetzten Blöcken lohnt ein Kontrollblick

export class VisionInterpreter {
    constructor(agent, allow_vision) {
        this.agent = agent;
        this.allow_vision = allow_vision;
        this.fp = './bots/'+agent.name+'/screenshots/';
        if (allow_vision) {
            this.camera = new Camera(agent.bot, this.fp);
        }
    }

    async lookAtPlayer(player_name, direction) {
        if (!this.allow_vision || !this.agent.prompter.vision_model.sendVisionRequest) {
            return "Vision is disabled. Use other methods to describe the environment.";
        }
        let result = "";
        const bot = this.agent.bot;
        const player = bot.players[player_name]?.entity;
        if (!player) {
            return `Could not find player ${player_name}`;
        }

        let filename;
        if (direction === 'with') {
            await bot.look(player.yaw, player.pitch);
            result = `Looking in the same direction as ${player_name}\n`;
            filename = await this.camera.capture();
        } else {
            await bot.lookAt(new Vec3(player.position.x, player.position.y + player.height, player.position.z));
            result = `Looking at player ${player_name}\n`;
            filename = await this.camera.capture();

        }

        return result + `Image analysis: "${await this.analyzeImage(filename)}"`;
    }

    async lookAtPosition(x, y, z) {
        if (!this.allow_vision || !this.agent.prompter.vision_model.sendVisionRequest) {
            return "Vision is disabled. Use other methods to describe the environment.";
        }
        let result = "";
        const bot = this.agent.bot;
        await bot.lookAt(new Vec3(x, y + 2, z));
        result = `Looking at coordinate ${x}, ${y}, ${z}\n`;

        let filename = await this.camera.capture();

        return result + `Image analysis: "${await this.analyzeImage(filename)}"`;
    }

    getCenterBlockInfo() {
        const bot = this.agent.bot;
        const maxDistance = 128; // Maximum distance to check for blocks
        const targetBlock = bot.blockAtCursor(maxDistance);
        
        if (targetBlock) {
            return `Block at center view: ${targetBlock.name} at (${targetBlock.position.x}, ${targetBlock.position.y}, ${targetBlock.position.z})`;
        } else {
            return "No block in center view";
        }
    }

    async analyzeImage(filename) {
        try {
            const imageBuffer = fs.readFileSync(`${this.fp}/${filename}.jpg`);
            const messages = this.agent.history.getHistory();

            const blockInfo = this.getCenterBlockInfo();
            const result = await this.agent.prompter.promptVision(messages, imageBuffer);
            return result + `\n${blockInfo}`;

        } catch (error) {
            console.warn('Error reading image:', error);
            return `Error reading image: ${error.message}`;
        }
    }

    // ---- "Echtes Sehen": kurze Blicke mit eigener Frage (ohne Chatverlauf, Bild wird danach gelöscht) ----
    // aim(bot) dreht den Kopf vorher. Liefert kurzen Text oder null (Vision aus, schon beim Gucken, Fehler).
    async see(question, aim = null) {
        const model = this.agent.prompter.vision_model;
        if (!this.allow_vision || !this.camera || !model?.sendVisionRequest || this.seeing) return null;
        this.seeing = true;
        const bot = this.agent.bot;
        try {
            bot.lookOverrideUntil = Date.now() + 3000; // idle_staring dreht den Kopf nicht weg
            if (aim) await aim(bot);
            await new Promise(r => setTimeout(r, 150)); // Kopfdrehung kommt beim Server an
            const file = await this.camera.capture();
            const path = `${this.fp}/${file}.jpg`;
            const buf = fs.readFileSync(path);
            fs.unlink(path, () => {});
            const prompt = `You are ${this.agent.name}, a player in Minecraft, looking at a screenshot of your own first-person view. ${question} `
                + 'Notes: the sky is always rendered blue regardless of weather/time, dropped items are small pink cubes, players and mobs may be missing or look odd. '
                + 'Answer in English, at most 2 short sentences, concrete facts only.';
            const txt = String(await model.sendVisionRequest([], prompt, buf) || '').trim();
            return txt || null;
        } catch (err) {
            console.warn('[vision] see failed:', err?.message || err);
            return null;
        } finally {
            this.seeing = false;
        }
    }

    // Kopf dorthin, wo der Spieler hinschaut (angeschauter Block bis 24 Blöcke), sonst in seine Blickrichtung.
    async aimLikePlayer(bot, player_name) {
        const ent = bot.players[player_name]?.entity;
        if (!ent) return;
        const lx = -Math.sin(ent.yaw) * Math.cos(ent.pitch), ly = Math.sin(ent.pitch), lz = -Math.cos(ent.yaw) * Math.cos(ent.pitch);
        const eye = ent.position.offset(0, 1.62, 0);
        for (let s = 1; s <= 24; s += 0.5) {
            const b = bot.blockAt(eye.offset(lx * s, ly * s, lz * s));
            if (b && !['air', 'cave_air', 'void_air'].includes(b.name)) return bot.lookAt(b.position.offset(0.5, 0.5, 0.5));
        }
        return bot.look(ent.yaw, ent.pitch);
    }

    // Selbstkontrolle nach eigenem Bauen: schaut auf die seit `since` gesetzten Blöcke (bot.placedLog aus life.js).
    async reviewOwnBuild(since, what = 'something') {
        const bot = this.agent.bot;
        const pts = (bot.placedLog || []).filter(p => p.t >= since).map(p => p.pos);
        if (pts.length < MIN_BUILD_REVIEW) return '';
        const c = pts.reduce((a, p) => a.offset(p.x / pts.length, p.y / pts.length, p.z / pts.length), new Vec3(0, 0, 0));
        if (bot.entity.position.distanceTo(c) < 4) { // steht mittendrin -> paar Schritte zurück für den Überblick
            try { await skills.moveAway(bot, 6); } catch {}
        }
        const seen = await this.see(`You just built ${what} here (${pts.length} blocks placed, you are looking at its center). `
            + 'Check it critically like a builder: does it look complete and as intended? Mention holes, missing or floating blocks, or anything ugly.',
            b => b.lookAt(c));
        return seen ? `\nYou stepped back and looked at your build: "${seen}" - if something is wrong, fix it.` : '';
    }
}
