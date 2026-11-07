export class MemoryBank {
	constructor() {
		this.memory = {};
	}

	rememberPlace(name, x, y, z) {
		delete this.memory[name]; // neu setzen = ans Ende (zuletzt benutzt)
		this.memory[name] = [x, y, z].map(Math.round);
	}

	recallPlace(name) {
		return this.memory[name];
	}

	getJson() {
		return this.memory
	}

	loadJson(json) {
		this.memory = (json && typeof json === 'object' && !Array.isArray(json)) ? json : {};
	}

	getKeys() {
		return Object.keys(this.memory).join(', ')
	}

	// Kurzer Prompt-Text: die zuletzt gespeicherten Orte mit Koordinaten
	getPlacesText(limit = 12) {
		return Object.entries(this.memory).slice(-limit)
			.map(([name, p]) => `${name}(${p.join(',')})`).join(', ');
	}
}
