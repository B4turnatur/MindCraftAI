import { writeFile, readFile, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeCompartment, lockdown } from './library/lockdown.js';
import * as skills from './library/skills.js';
import * as world from './library/world.js';
import { Vec3 } from 'vec3';
import {ESLint} from "eslint";
import { wordOverlapScore } from '../utils/text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class Coder {
    constructor(agent) {
        this.agent = agent;
        this.file_counter = 0;
        this.fp = '/bots/'+agent.name+'/action-code/';
        this.code_template = '';
        this.code_lint_template = '';

        readFile(path.join(__dirname, '../../bots/execTemplate.js'), 'utf8', (err, data) => {
            if (err) throw err;
            this.code_template = data;
        });
        readFile(path.join(__dirname, '../../bots/lintTemplate.js'), 'utf8', (err, data) => {
            if (err) throw err;
            this.code_lint_template = data;
        });
        mkdirSync('.' + this.fp, { recursive: true });
        // Gelernter Code: Aufgabe -> Code, der ohne Fehler lief (klein gehalten, max LEARNED_MAX)
        this.learned_fp = './bots/' + agent.name + '/learned_code.json';
        this.learned = [];
        try {
            if (existsSync(this.learned_fp)) this.learned = JSON.parse(readFileSync(this.learned_fp, 'utf8'));
        } catch (e) { console.warn('learned_code.json unreadable, starting empty.'); this.learned = []; }
    }

    _currentTask(messages) {
        // wie prompter.js ($CODE_DOCS), aber greedy bis zur letzten ')' (Text nach dem Befehl wird eh abgeschnitten)
        return messages.slice().reverse().find(m => m.role !== 'system' && m.content.includes('!newAction('))
            ?.content?.match(/!newAction\((.*)\)/s)?.[1]?.replace(/^["'`]|["'`]$/g, '').trim() || '';
    }

    _findLearned(task) {
        if (!task) return null;
        let best = null, bestScore = 0;
        for (const e of this.learned) {
            const score = wordOverlapScore(task, e.task);
            if (score > bestScore) { best = e; bestScore = score; }
        }
        // ponytail: Wort-Overlap reicht für ~30 Einträge, Embeddings erst wenn das zu oft danebenliegt
        return bestScore >= 0.5 ? best : null;
    }

    _rememberSuccess(task, code, output) {
        if (!task || code.length > 2000) return;
        if (FAILURE_RE.test(output)) return; // Skills melden Fehlschläge oft nur per log, ohne throw
        const LEARNED_MAX = 30;
        this.learned = this.learned.filter(e => wordOverlapScore(task, e.task) < 0.8); // ähnliche ersetzen
        this.learned.push({ task, code, time: Date.now() });
        if (this.learned.length > LEARNED_MAX) this.learned = this.learned.slice(-LEARNED_MAX);
        try { writeFileSync(this.learned_fp, JSON.stringify(this.learned, null, 1)); }
        catch (e) { console.warn('Could not save learned code: ' + e.message); }
    }

    _stateInfo() {
        const bot = this.agent.bot;
        try {
            const p = bot.entity.position;
            const inv = world.getInventoryCounts(bot);
            const invStr = Object.entries(inv).map(([k, v]) => `${k}:${v}`).join(', ') || 'empty';
            return `Position: x=${p.x.toFixed(1)}, y=${p.y.toFixed(1)}, z=${p.z.toFixed(1)}\nInventory: ${invStr}`;
        } catch (e) { return ''; }
    }

    // kurze, nützliche Fehlermeldung: Meldung + Zeile im generierten Code
    _describeError(e, code) {
        return describeError(e, code, this.code_template.split('/* CODE HERE */')[0].split('\n').length - 1);
    }

    async generateCode(agent_history) {
        this.agent.bot.modes.pause('unstuck');
        lockdown();
        // this message history is transient and only maintained in this function
        let messages = agent_history.getHistory(); 
        const task = this._currentTask(messages);
        const learned = this._findLearned(task);
        if (learned)
            messages.push({role: 'system', content: `This code worked before for the similar task "${learned.task}". Reuse or adapt it if it fits:\n\`\`\`${learned.code}\`\`\``});
        messages.push({role: 'system', content: 'Code generation started. Write code in codeblock in your response:'});

        const MAX_ATTEMPTS = 5;
        const MAX_NO_CODE = 3;

        let code = null;
        let no_code_failures = 0;
        let last_error = null, same_error_count = 0;
        const tried_code = new Set();
        for (let i=0; i<MAX_ATTEMPTS; i++) {
            if (this.agent.bot.interrupt_code)
                return null;
            const messages_copy = JSON.parse(JSON.stringify(messages));
            let res = await this.agent.prompter.promptCoding(messages_copy);
            if (this.agent.bot.interrupt_code)
                return null;
            let contains_code = res.indexOf('```') !== -1;
            if (!contains_code) {
                if (res.indexOf('!newAction') !== -1) {
                    messages.push({
                        role: 'assistant', 
                        content: res.substring(0, res.indexOf('!newAction'))
                    });
                    continue; // using newaction will continue the loop
                }
                
                if (no_code_failures >= MAX_NO_CODE) {
                    console.warn("Action failed, agent would not write code.");
                    return 'Action failed, agent would not write code.';
                }
                messages.push({
                    role: 'system', 
                    content: 'Error: no code provided. Write code in codeblock in your response. ``` // example ```'}
                );
                console.warn("No code block generated. Trying again.");
                no_code_failures++;
                continue;
            }
            code = res.substring(res.indexOf('```')+3, res.lastIndexOf('```'));
            const code_key = this._sanitizeCode(code).replace(/\s+/g, ' ');
            if (tried_code.has(code_key)) {
                messages.push({ role: 'assistant', content: res });
                messages.push({ role: 'system', content: 'Error: this exact code was already tried and failed. Write DIFFERENT code with another approach.' });
                continue;
            }
            tried_code.add(code_key);
            const result = await this._stageCode(code);
            const executionModule = result.func;
            const lintResult = await this._lintCode(result.src_lint_copy);
            if (lintResult) {
                const message = 'Error: Code lint error:'+'\n'+lintResult+'\nPlease try again.';
                console.warn("Linting error:"+'\n'+lintResult+'\n');
                messages.push({ role: 'assistant', content: res }); // Modell soll seinen kaputten Code sehen
                messages.push({ role: 'system', content: message });
                continue;
            }
            if (!executionModule) {
                console.warn("Failed to stage code, something is wrong.");
                return 'Failed to stage code, something is wrong.';
            }

            try {
                console.log('Executing code...');
                await executionModule.main(this.agent.bot);

                const code_output = this.agent.actions.getBotOutputSummary();
                this._rememberSuccess(task, this._sanitizeCode(code), code_output);
                const summary = "Agent wrote this code: \n```" + this._sanitizeCode(code) + "```\nCode Output:\n" + code_output;
                return summary;
            } catch (e) {
                if (this.agent.bot.interrupt_code)
                    return null;
                
                const err_desc = this._describeError(e, this._sanitizeCode(code));
                console.warn('Generated code threw error: ' + err_desc);

                const code_output = this.agent.actions.getBotOutputSummary();
                same_error_count = (e?.message === last_error) ? same_error_count + 1 : 1;
                last_error = e?.message;
                if (same_error_count >= 3) {
                    console.warn('Same error 3 times, giving up.');
                    return `Code failed 3 times with the same error: ${err_desc}\n${this._stateInfo()}\nDo not retry the same way; use a different command or ask the player.`;
                }
                const hint = same_error_count === 2
                    ? 'Same error as last time! Use a completely different approach (other skills, simpler steps).'
                    : 'Fix the cause and try again.';
                messages.push({
                    role: 'assistant',
                    content: res
                });
                messages.push({
                    role: 'system',
                    content: `Code Output:\n${code_output}\nCODE EXECUTION THREW ERROR: ${err_desc}\n${this._stateInfo()}\n${hint}`
                });
            }
        }
        return `Code generation failed after ${MAX_ATTEMPTS} attempts.`;
    }
    
    async  _lintCode(code) {
        let result = '#### CODE ERROR INFO ###\n';
        const codeNoComments = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const skillRegex = /((?:skills|world)\.(.*?))\(/g;
        const skills = [];
        let match;
        while ((match = skillRegex.exec(codeNoComments)) !== null) {
            skills.push(match[1]);
        }
        const allDocs = await this.agent.prompter.skill_libary.getAllSkillDocs();
        const knownSkills = new Set(allDocs.map(doc => doc.split('\n')[0]));
        const missingSkills = [...new Set(skills.filter(skill => !knownSkills.has(skill)))];
        if (missingSkills.length > 0) {
            result += 'These functions do not exist:\n';
            result += missingSkills.map(s => {
                const guess = closestName(s, [...knownSkills]);
                return guess ? `${s} (did you mean ${guess}?)` : s;
            }).join('\n');
            console.log(result)
            return result;
        }
        // Template-Imports stehen in Spalte 0, generierter Code ist eingerückt -> nur Template-Zeilen entfernen
        const problems = findStaticProblems(codeNoComments.replace(/^import .*$/gm, ''));
        if (problems.length > 0) {
            result += problems.join('\n');
            console.log(result);
            return result;
        }

        const eslint = new ESLint();
        const results = await eslint.lintText(code);
        const codeLines = code.split('\n');
        const exceptions = results.map(r => r.messages).flat();

        if (exceptions.length > 0) {
            exceptions.forEach((exc, index) => {
                if (exc.line && exc.column ) {
                    const errorLine = codeLines[exc.line - 1]?.trim() || 'Unable to retrieve error line content';
                    result += `#ERROR ${index + 1}\n`;
                    result += `Message: ${exc.message}\n`;
                    result += `Location: Line ${exc.line}, Column ${exc.column}\n`;
                    result += `Related Code Line: ${errorLine}\n`;
                }
            });
            result += 'The code contains exceptions and cannot continue execution.';
        } else {
            return null;//no error
        }

        return result ;
    }
    // write custom code to file and import it
    // write custom code to file and prepare for evaluation
    async _stageCode(code) {
        code = this._sanitizeCode(code);
        let src = '';
        code = code.replaceAll('console.log(', 'log(bot,');
        code = code.replaceAll('log("', 'log(bot,"');

        console.log(`Generated code: """${code}"""`);

        // this may cause problems in callback functions
        code = code.replaceAll(';\n', '; if(bot.interrupt_code) {log(bot, "Code interrupted.");return;}\n');
        for (let line of code.split('\n')) {
            src += `    ${line}\n`;
        }
        let src_lint_copy = this.code_lint_template.replace('/* CODE HERE */', src);
        src = this.code_template.replace('/* CODE HERE */', src);

        let filename = this.file_counter + '.js';
        // if (this.file_counter > 0) {
        //     let prev_filename = this.fp + (this.file_counter-1) + '.js';
        //     unlink(prev_filename, (err) => {
        //         console.log("deleted file " + prev_filename);
        //         if (err) console.error(err);
        //     });
        // } commented for now, useful to keep files for debugging
        this.file_counter++;
        
        let write_result = await this._writeFilePromise('.' + this.fp + filename, src);
        // This is where we determine the environment the agent's code should be exposed to.
        // It will only have access to these things, (in addition to basic javascript objects like Array, Object, etc.)
        // Note that the code may be able to modify the exposed objects.
        const compartment = makeCompartment({
            skills,
            log: skills.log,
            world,
            Vec3,
        });
        const mainFn = compartment.evaluate(src);
        
        if (write_result) {
            console.error('Error writing code execution file: ' + write_result);
            return null;
        }
        return { func:{main: mainFn}, src_lint_copy: src_lint_copy };
    }

    _sanitizeCode(code) {
        code = code.trim();
        const remove_strs = ['Javascript', 'javascript', 'js']
        for (let r of remove_strs) {
            if (code.startsWith(r)) {
                code = code.slice(r.length);
                return code;
            }
        }
        return code;
    }

    _writeFilePromise(filename, src) {
        // makes it so we can await this function
        return new Promise((resolve, reject) => {
            writeFile(filename, src, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}

// Text im Skill-Output, der trotz fehlerfreiem Lauf auf Misserfolg hindeutet
const FAILURE_RE = /fail|error|could not|couldn't|cannot|can't|unable|not enough|don't have|no .{0,30} (found|nearby)|interrupted|timed out/i;

// Async-Skills/World-Funktionen ohne await laufen parallel weiter und gehen fast immer schief.
const ASYNC_FUNCS = new Set([
    ...Object.entries(skills).filter(([, f]) => f?.constructor?.name === 'AsyncFunction').map(([n]) => 'skills.' + n),
    ...Object.entries(world).filter(([, f]) => f?.constructor?.name === 'AsyncFunction').map(([n]) => 'world.' + n),
]);

export function findStaticProblems(code) {
    const problems = [];
    if (!/Promise\./.test(code)) { // Promise.all & Co. = bewusst parallel, dann nicht meckern
        const re = /(^|[^\w.])((?:skills|world)\.\w+)\s*\(/g;
        const seen = new Set();
        let m;
        while ((m = re.exec(code)) !== null) {
            const name = m[2];
            if (!ASYNC_FUNCS.has(name) || seen.has(name)) continue;
            const before = code.slice(Math.max(0, m.index - 12), m.index + m[1].length);
            if (!/(await|return)\s*\(?\s*$/.test(before)) {
                seen.add(name);
                problems.push(`Missing await: ${name}(...) is async, write "await ${name}(...)".`);
            }
        }
    }
    if (/\brequire\s*\(|^\s*import\s/m.test(code))
        problems.push('Do not use require/import. Only bot, skills, world, Vec3 and log are available.');
    if (/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/.test(code) && !/\bbreak\b|\breturn\b/.test(code))
        problems.push('Endless loop without break/return. Use a bounded loop.');
    return problems;
}

export function describeError(e, code, line_offset) {
    let msg = (e && e.message) ? `${e.name || 'Error'}: ${e.message}` : String(e);
    const m = ((e && e.stack) || '').match(/<anonymous>:(\d+):(\d+)/);
    if (m) {
        const line = parseInt(m[1]) - line_offset;
        const src = code.split('\n')[line - 1];
        if (src !== undefined) msg += `\nAt line ${line}: ${src.trim()}`;
    }
    return msg;
}

export function closestName(name, candidates) {
    const short = s => s.split('.').pop().toLowerCase();
    const a = short(name);
    let best = null, bestD = Infinity;
    for (const c of candidates) {
        const b = short(c);
        const d = (b.includes(a) || a.includes(b)) ? 1 : levenshtein(a, b);
        if (d < bestD) { bestD = d; best = c; }
    }
    return bestD <= Math.max(2, Math.floor(a.length / 3)) ? best : null;
}

function levenshtein(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++)
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}
