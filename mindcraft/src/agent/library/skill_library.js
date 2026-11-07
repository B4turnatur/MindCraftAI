import { cosineSimilarity } from '../../utils/math.js';
import { getSkillDocs } from './index.js';
import { wordOverlapScore } from '../../utils/text.js';

// Wort (EN/DE, auch Wortanfang) -> Teile von Skill-Namen. Damit findet "sammle Holz" collectBlock,
// "iss was" consume usw. – auch wenn das Embedding schwächelt oder fehlt.
// ponytail: handgepflegte Liste, bei neuen Skills/Wörtern einfach ergänzen
const KEYWORDS = {
    // englisch
    mine: 'collect break dig', chop: 'collect', gather: 'collect pickup', get: 'collect', harvest: 'collect till',
    build: 'place', put: 'place put', eat: 'consume', food: 'consume', drink: 'consume', kill: 'attack', fight: 'attack defend',
    hunt: 'attack', drop: 'discard', throw: 'discard', toss: 'discard', give: 'give', sleep: 'bed', cook: 'smelt furnace',
    store: 'put chest', deposit: 'put chest', farm: 'till sow', plant: 'till sow', walk: 'go', come: 'go player', move: 'go move',
    find: 'nearest', search: 'nearest', locate: 'nearest', open: 'door activate chest', hold: 'equip', wield: 'equip',
    flee: 'avoid move away', run: 'avoid move', escape: 'avoid move', home: 'go position', surface: 'surface',
    down: 'dig down', pick: 'pickup', items: 'pickup', loot: 'pickup take chest', torch: 'place', wood: 'collect', log: 'collect',
    // deutsch (Wortanfänge, längster Treffer gewinnt)
    samm: 'collect pickup', hol: 'collect', hole: 'collect', besorg: 'collect', abbau: 'collect break', grab: 'dig collect',
    fäll: 'collect', fael: 'collect', bau: 'place', setz: 'place', leg: 'place', platzier: 'place', stell: 'place',
    ess: 'consume', iss: 'consume', trink: 'consume', hunger: 'consume', nahrung: 'consume', schlaf: 'bed', bett: 'bed',
    schmelz: 'smelt furnace', koch: 'smelt furnace', brat: 'smelt furnace', ofen: 'furnace smelt', truhe: 'chest', kiste: 'chest',
    verstau: 'put chest', einlager: 'put chest', nimm: 'take pickup', pflanz: 'till sow', säe: 'till sow', saee: 'till sow',
    feld: 'till sow', acker: 'till sow', gib: 'give', geb: 'give', folg: 'follow', angriff: 'attack', greif: 'attack',
    kämpf: 'attack defend', kaempf: 'attack defend', töt: 'attack', toet: 'attack', jag: 'attack', verteidig: 'defend',
    lauf: 'go', geh: 'go', komm: 'go player', flieh: 'avoid move', renn: 'go move', such: 'nearest', find: 'nearest',
    wirf: 'discard', werf: 'discard', wegwerf: 'discard', öffn: 'door activate', oeffn: 'door activate', tür: 'door', tuer: 'door',
    rüst: 'equip', ruest: 'equip', ausrüst: 'equip', nimmin: 'equip', holz: 'collect', baum: 'collect', stein: 'collect',
    erz: 'collect', grabe: 'dig', runter: 'dig down', hoch: 'surface', oberfläche: 'surface', warte: 'wait', bleib: 'stay',
    hier: 'stay', craft: 'craft', herstell: 'craft', mach: 'craft', inventar: 'inventory', werkbank: 'craft',
};
const KEY_LIST = Object.keys(KEYWORDS).sort((a, b) => b.length - a.length);
const KEYWORD_WEIGHT = 0.25; // Anteil Stichwort-Score neben Embedding-Ähnlichkeit (cosine ~0.5–0.8)

export function messageTokens(message) {
    const out = new Set();
    for (const w of message.toLowerCase().split(/[^a-zäöüß]+/).filter(w => w.length >= 2)) {
        out.add(w);
        if (w.endsWith('s')) out.add(w.slice(0, -1));
        const key = KEY_LIST.find(k => w.startsWith(k));
        if (key) KEYWORDS[key].split(' ').forEach(t => out.add(t));
    }
    return out;
}

const STOP_TOKENS = new Set(['at', 'to', 'on', 'from', 'get', 'is', 'nearest', 'nearby']);
export function nameTokens(doc) {
    const name = doc.split('\n')[0].split('.').pop();
    return name.split(/(?=[A-Z])/).map(t => t.toLowerCase()).filter(t => t.length >= 2 && !STOP_TOKENS.has(t));
}

// 0..1: Anteil der Skill-Namensteile, die (direkt oder übersetzt) in der Anfrage vorkommen
export function keywordScore(tokens, doc) {
    const parts = nameTokens(doc);
    if (parts.length === 0) return 0;
    return parts.filter(p => tokens.has(p) || tokens.has(p + 's') || tokens.has(p.replace(/s$/, ''))).length / parts.length;
}

export class SkillLibrary {
    constructor(agent,embedding_model) {
        this.agent = agent;
        this.embedding_model = embedding_model;
        this.skill_docs_embeddings = {};
        this.skill_docs = null;
        this.always_show_skills = ['skills.placeBlock', 'skills.wait', 'skills.breakBlockAt']
    }
    async initSkillLibrary() {
        const skillDocs = getSkillDocs();
        this.skill_docs = skillDocs;
        if (this.embedding_model) {
            try {
                const embeddingPromises = skillDocs.map((doc) => {
                    return (async () => {
                        let func_name_desc = doc.split('\n').slice(0, 2).join('');
                        this.skill_docs_embeddings[doc] = await this.embedding_model.embed(func_name_desc);
                    })();
                });
                await Promise.all(embeddingPromises);
            } catch (error) {
                console.warn('Error with embedding model, using word-overlap instead.');
                this.embedding_model = null;
            }
        }
        this.always_show_skills_docs = {};
        for (const skillName of this.always_show_skills) {
            this.always_show_skills_docs[skillName] = this.skill_docs.find(doc => doc.split('\n')[0] === skillName);
        }
    }

    async getAllSkillDocs() {
        return this.skill_docs;
    }

    async _scoreDocs(message) {
        const tokens = messageTokens(message);
        let msg_embedding = null;
        if (this.embedding_model) {
            try { msg_embedding = await this.embedding_model.embed(message); }
            catch (e) { console.warn('Skill-doc embedding failed, using keywords only: ' + e.message); }
        }
        return this.skill_docs.map(doc_key => {
            const doc_emb = this.skill_docs_embeddings[doc_key];
            let base = (msg_embedding && doc_emb)
                ? cosineSimilarity(msg_embedding, doc_emb)
                : wordOverlapScore(message, doc_key.split('\n').slice(0, 2).join(' '));
            if (!Number.isFinite(base)) base = 0;
            return { doc_key, similarity_score: base + KEYWORD_WEIGHT * keywordScore(tokens, doc_key) };
        }).sort((a, b) => b.similarity_score - a.similarity_score);
    }

    async getRelevantSkillDocs(message, select_num) {
        if(!message) // use filler message if none is provided
            message = '(no message)';
        // Fix: früher wurde über skill_docs_embeddings iteriert – ohne Embedding-Modell war das leer => keine Docs
        let skill_doc_similarities = select_num === -1
            ? this.skill_docs.map(doc_key => ({ doc_key, similarity_score: 0 }))
            : await this._scoreDocs(message);

        let length = skill_doc_similarities.length;
        if (select_num === -1 || select_num > length) {
            select_num = length;
        }
        // Get initial docs from similarity scores
        let selected_docs = new Set(skill_doc_similarities.slice(0, select_num).map(doc => doc.doc_key));

        // Add always show docs
        Object.values(this.always_show_skills_docs).forEach(doc => {
            if (doc) {
                selected_docs.add(doc);
            }
        });

        let relevant_skill_docs = '#### RELEVANT CODE DOCS ###\nThe following functions are available to use:\n';
        relevant_skill_docs += Array.from(selected_docs).join('\n### ');

        console.log('Selected skill docs:', Array.from(selected_docs).map(doc => {
            const first_line_break = doc.indexOf('\n');
            return first_line_break > 0 ? doc.substring(0, first_line_break) : doc;
        }));
        return relevant_skill_docs;
    }
}
