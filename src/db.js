import { readFileSync, writeFileSync } from "fs";
import { exit } from "process";

class LocalDB {
	#filename = "config/localdb.json";
	#data = null;
	constructor () {
		try {
			this.load(this.#filename);
		} catch {
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

	getApplicationConfig () {
		return this.#data.application;
	}

	getResourceConfig () {
		return this.#data.resources;
	}

	getUserConfig (username) {
		if (this.#data.users[username]) {
			return this.#data.users[username];
		} else {
			return null;
		}
	}
}

export const db = new LocalDB();
export const pveAPI = db.getApplicationConfig().pveAPI;
export const pveAPIToken = db.getApplicationConfig().pveAPIToken;
export const listenPort = db.getApplicationConfig().listenPort;
export const hostname = db.getApplicationConfig().hostname;
export const domain = db.getApplicationConfig().domain;
