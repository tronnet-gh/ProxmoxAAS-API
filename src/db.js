import { readFileSync, writeFileSync } from "fs";
import { exit } from "process";

class LocalDB {
	#filename = "config/localdb.json";
	#data = null;
	constructor () {
		try {
			this.load(this.#filename);
		}
		catch {
			console.log("Error: localdb.json was not found. Please follow the directions in the README to initialize localdb.json.");
			exit(1);
		}
	}

	load (path) {
		this.#data = JSON.parse(readFileSync(path));
	}

	save (path) {
		writeFileSync(path, JSON.stringify(this.#data));
	}

	getGlobalConfig () {
		return this.#data.global;
	}

	getUserConfig (username) {
		return this.#data.users[username];
	}
}

export const db = new LocalDB();
export const pveAPI = db.getGlobalConfig().application.pveAPI;
export const pveAPIToken = db.getGlobalConfig().application.pveAPIToken;
export const listenPort = db.getGlobalConfig().application.listenPort;
export const hostname = db.getGlobalConfig().application.hostname;
export const domain = db.getGlobalConfig().application.domain;
