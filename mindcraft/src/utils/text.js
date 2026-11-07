import { companion } from "../../settings.js";
export function stringifyTurns(turns) {
    let res = '';
    for (let turn of turns) {
        if (turn.role === 'assistant') {
            res += `\nYour output:\n${turn.content}`;
        } else if (turn.role === 'system') {
            res += `\nSystem output: ${turn.content}`;
        } else {
            res += `\nUser input: ${turn.content}`;
        
        }
    }
    return res.trim();
}

export function toSinglePrompt(turns, system=null, stop_seq='***', model_nickname='assistant') {
    let prompt = system ? `${system}${stop_seq}` : '';
    let role = '';
    turns.forEach((message) => {
        role = message.role;
        if (role === 'assistant') role = model_nickname;
        prompt += `${role}: ${message.content}${stop_seq}`;
    });
    if (role !== model_nickname) // if the last message was from the user/system, add a prompt for the model. otherwise, pretend we are extending the model's own message
        prompt += model_nickname + ": ";
    return prompt;
}

function _getWords(text) {
    const STOPWORDS = new Set([
        'the','a','an','to','with','in','on','at','of','for','and','or','is','are','was','be','you','your','me','my','i','it','that','this','some','can','please','hey','ok','okay',
        'ich','du','er','sie','es','wir','ihr','mir','mich','dir','dich','mein','dein','und','oder','der','die','das','ein','eine','einen','in','an','auf','mit','von','zu','für','ist','sind','war','nicht','mal','bitte','ja','nein','ey','boah','ugh', ...companion.names
    ]);
    const DE_EN_MAP = {
        haus: 'house', huette: 'house', hütte: 'house',
        bau: 'build', baue: 'build', bauen: 'build',
        holz: 'wood oak_log', baum: 'wood oak_log', baeume: 'wood oak_log', bäume: 'wood oak_log',
        stein: 'stone cobblestone', steine: 'stone cobblestone',
        sammel: 'collect', sammle: 'collect', sammeln: 'collect', hol: 'collect', hole: 'collect',
        komm: 'come', her: 'here',
        folg: 'follow', folge: 'follow', folgen: 'follow',
        toete: 'kill attack', töte: 'kill attack', greif: 'attack', kaempf: 'attack', kämpf: 'attack',
        schau: 'look', guck: 'look', sieh: 'look',
        crafte: 'craft', craften: 'craft', mach: 'craft',
        spitzhacke: 'pickaxe', axt: 'axe', schwert: 'sword',
        stock: 'stick', stoecke: 'stick', stöcke: 'stick', bretter: 'plank',
        fackel: 'torch', fackeln: 'torch', bett: 'bed',
        warte: 'stop', stopp: 'stop', aufhoeren: 'stop', aufhören: 'stop',
        basis: 'base', zuhause: 'base', ziel: 'goal', plan: 'goal'
    };
    const raw = text.toLowerCase().replace(/[^a-zäöüß0-9_ ]/g, ' ').split(/\s+/).filter(Boolean);
    const expanded = [];
    for (const w of raw) {
        if (STOPWORDS.has(w) || w.length < 2) continue;
        expanded.push(w);
        if (DE_EN_MAP[w]) expanded.push(...DE_EN_MAP[w].split(' '));
    }
    return [...new Set(expanded)];
}

export function wordOverlapScore(text1, text2) {
    const words1 = _getWords(text1);
    const words2 = _getWords(text2);
    const intersection = words1.filter(word => words2.includes(word));
    return intersection.length / (words1.length + words2.length - intersection.length);
}

// ensures stricter turn order and roles:
// - system messages are treated as user messages and prefixed with SYSTEM:
// - combines repeated messages from users
// - separates repeat assistant messages with filler user messages
export function strictFormat(turns) {
    let prev_role = null;
    let messages = [];
    let filler = {role: 'user', content: '_'};
    for (let msg of turns) {
        if (typeof msg.content === 'string')  {
            msg.content = msg.content.trim();
        }
        if (msg.role === 'system') {
            msg.role = 'user';
            msg.content = 'SYSTEM: ' + msg.content;
        }
        if (msg.role === prev_role && msg.role === 'assistant') {
            // insert empty user message to separate assistant messages
            messages.push(filler);
            messages.push(msg);
        }
        else if (msg.role === prev_role) {
            // combine new message with previous message instead of adding a new one
            messages[messages.length-1].content += '\n' + msg.content;
        }
        else {
            messages.push(msg);
        }
        prev_role = msg.role;
        
    }
    if (messages.length > 0 && messages[0].role !== 'user') {
        messages.unshift(filler); // anthropic requires user message to start
    }
    if (messages.length === 0) {
        messages.push(filler);
    }
    return messages;
}