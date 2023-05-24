import { readFileSync, writeFileSync } from "fs";

class localdb {
	#template = "localdb.json.template";
	#filename = "localdb.json";
	#data = null;
	constructor () {
		try {
			this.load(this.#filename);
		}
		catch {
			this.load(this.#template);
			this.save(this.#filename);
		}
	}
	load(path) {
		this.#data = JSON.parse(readFileSync(path));
	}	
	save(path) {
		writeFileSync(path, JSON.stringify(this.#data));
	}
	getResourceConfig () {
		return this.#data.resources;
	}
	getUserConfig (username) {
		if (this.#data.users[username]) {
			return this.#data.users[username];
		}
		else {
			return null;
		}
	}
}

export const db = new localdb();