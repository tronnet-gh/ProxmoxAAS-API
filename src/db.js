import { readFileSync, writeFileSync } from "fs";
import { exit } from "process";

class LocalDB {
	#filename = "config/localdb.json";
	#data = null;
	constructor () {
		try {
			this.load();
		}
		catch {
			console.log("Error: localdb.json was not found. Please follow the directions in the README to initialize localdb.json.");
			exit(1);
		}
	}

	/**
	 * Load db from local file system. Reads from file path store in filename.
	 */
	load () {
		this.#data = JSON.parse(readFileSync(this.#filename));
	}

	/**
	 * Save db to local file system. Saves to file path stored in filename.
	 */
	save () {
		writeFileSync(this.#filename, JSON.stringify(this.#data));
	}

	/**
	 * Gets the global config object from db.
	 * @returns {Object} global config data.
	 */
	getGlobalConfig () {
		return this.#data.global;
	}

	/**
	 * Gets a specific user's config from db.
	 * @param {string} username of user to get config.
	 * @returns {Object} specific user config data.
	 */
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
