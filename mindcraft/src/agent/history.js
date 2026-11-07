import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { NPCData } from './npc/data.js';
import settings from './settings.js';


export class History {
    constructor(agent) {
        this.agent = agent;
        this.name = agent.name;
        this.memory_fp = `./bots/${this.name}/memory.json`;
        this.full_history_fp = undefined;

        mkdirSync(`./bots/${this.name}/histories`, { recursive: true });

        this.turns = [];

        // Natural language memory as a summary of recent messages + previous memory
        this.memory = '';

        // Dauerhafte Fakten (Spielername, Vorlieben, Versprechen, Basis …) – getrennt von der rollierenden
        // Zusammenfassung, damit sie beim Komprimieren nicht verloren gehen
        this.facts = [];

        // Maximum number of messages to keep in context before saving chunk to memory
        this.max_messages = settings.max_messages;

        // Number of messages to remove from current history and save into memory
        this.summary_chunk_size = 5; 
        // chunking reduces expensive calls to promptMemSaving and appendFullHistory
        // and improves the quality of the memory summary
    }

    getHistory() { // expects an Examples object
        return JSON.parse(JSON.stringify(this.turns));
    }

    async summarizeMemories(turns) {
        console.log("Storing memories...");
        const nextMem = (await this.agent.prompter.promptMemSaving(turns))?.trim() || '';
        // Schutz gegen kaputte oder In-Character-Antworten (z. B. CLI-Fehler oder Rollenspiel-Verweigerung)
        const refused = !nextMem
            || nextMem.startsWith('My brain disconnected')
            || /not (doing|talking about) memory|apologize first|say sorry/i.test(nextMem);
        if (refused) {
            console.warn("Memory update rejected (invalid/in-character output), keeping old memory:", nextMem);
            return;
        }
        const { facts, summary } = History.parseMemSaving(nextMem);
        if (facts.length) this.facts = facts; // keine FACTS-Zeilen geliefert → alte Fakten behalten
        if (summary) this.memory = summary;

        if (this.memory.length > 500) {
            this.memory = this.memory.slice(0, 500);
            this.memory += '...(Memory truncated to 500 chars. Compress it more next time)';
        }

        console.log("Memory updated to: ", this.memory);
        console.log("Facts: ", this.facts);
    }

    // Antwort im Format "FACTS:\n- …\nSUMMARY:\n…" zerlegen; altes Format (nur Text) = komplette Zusammenfassung
    static parseMemSaving(text) {
        const m = text.match(/^\s*FACTS:\s*([\s\S]*?)\n\s*SUMMARY:\s*([\s\S]*)$/i);
        if (!m) return { facts: [], summary: text.trim() };
        const facts = m[1].split('\n')
            .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
            .filter(l => l && !/^(none|n\/a|-)$/i.test(l))
            .map(l => l.slice(0, 140))
            .slice(0, 15);
        return { facts, summary: m[2].trim() };
    }

    // Für den Gesprächs-Prompt: Zusammenfassung + Fakten + gespeicherte Orte (kompakt)
    getMemoryForPrompt() {
        let text = this.memory;
        if (this.facts.length) text += '\nKey facts: ' + this.facts.join(' | ');
        const places = this.agent.memory_bank?.getPlacesText();
        if (places) text += '\nSaved places (!goToRememberedPlace): ' + places;
        return text;
    }

    async appendFullHistory(to_store) {
        if (this.full_history_fp === undefined) {
            const string_timestamp = new Date().toLocaleString().replace(/[/:]/g, '-').replace(/ /g, '').replace(/,/g, '_');
            this.full_history_fp = `./bots/${this.name}/histories/${string_timestamp}.json`;
            writeFileSync(this.full_history_fp, '[]', 'utf8');
        }
        try {
            const data = readFileSync(this.full_history_fp, 'utf8');
            let full_history = JSON.parse(data);
            full_history.push(...to_store);
            writeFileSync(this.full_history_fp, JSON.stringify(full_history, null, 4), 'utf8');
        } catch (err) {
            console.error(`Error reading ${this.name}'s full history file: ${err.message}`);
        }
    }

    async add(name, content) {
        let role = 'assistant';
        if (name === 'system') {
            role = 'system';
        }
        else if (name !== this.name) {
            role = 'user';
            content = `${name}: ${content}`;
        }
        this.turns.push({role, content});

        if (this.turns.length >= this.max_messages) {
            let chunk = this.turns.splice(0, this.summary_chunk_size);
            while (this.turns.length > 0 && this.turns[0].role === 'assistant')
                chunk.push(this.turns.shift()); // remove until turns starts with system/user message

            // Im Hintergrund (kann ~1 min dauern) – nicht auf die Antwort warten lassen; Kette verhindert Überholen
            this._memQueue = (this._memQueue || Promise.resolve())
                .then(() => this.summarizeMemories(chunk))
                .then(() => this.appendFullHistory(chunk))
                .catch(err => console.error('Memory summarization failed:', err));
        }
    }

    async save() {
        try {
            const data = {
                memory: this.memory,
                facts: this.facts,
                places: this.agent.memory_bank?.getJson() ?? this._places ?? {},
                turns: this.turns,
                self_prompting_state: this.agent.self_prompter.state,
                self_prompt: this.agent.self_prompter.isStopped() ? null : this.agent.self_prompter.prompt,
                taskStart: this.agent.task.taskStartTime,
                last_sender: this.agent.last_sender
            };
            writeFileSync(this.memory_fp, JSON.stringify(data, null, 2));
            console.log('Saved memory to:', this.memory_fp);
        } catch (error) {
            console.error('Failed to save history:', error);
            throw error;
        }
    }

    load() {
        try {
            if (!existsSync(this.memory_fp)) {
                console.log('No memory file found.');
                return null;
            }
            const data = JSON.parse(readFileSync(this.memory_fp, 'utf8'));
            this.memory = data.memory || '';
            this.turns = data.turns || [];
            this.facts = Array.isArray(data.facts) ? data.facts : [];
            this._places = data.places || {};
            this.agent.memory_bank?.loadJson(this._places);
            console.log('Loaded memory:', this.memory, '| facts:', this.facts.length, '| places:', Object.keys(this._places).length);
            return data;
        } catch (error) {
            console.error('Failed to load history:', error);
            throw error;
        }
    }

    clear() {
        this.turns = [];
        this.memory = '';
        this.facts = [];
    }
}