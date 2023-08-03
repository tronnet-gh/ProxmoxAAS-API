import { readFileSync, writeFileSync } from "fs";
import { exit } from "process";

class LocalDB {
	#path = null;
	#data = null;
	constructor (path) {
		try {
			this.#path = path;
			this.load();
			this.pveAPI = this.getGlobalConfig().application.pveAPI;
			this.pveAPIToken = this.getGlobalConfig().application.pveAPIToken;
			this.listenPort = this.getGlobalConfig().application.listenPort;
			this.hostname = this.getGlobalConfig().application.hostname;
			this.domain = this.getGlobalConfig().application.domain;
		}
		catch {
			console.log(`Error: ${path} was not found. Please follow the directions in the README to initialize localdb.json.`);
			exit(1);
		}
	}

	/**
	 * Load db from local file system. Reads from file path store in filename.
	 */
	load () {
		this.#data = JSON.parse(readFileSync(this.#path));
	}

	/**
	 * Save db to local file system. Saves to file path stored in filename.
	 */
	save () {
		writeFileSync(this.#path, JSON.stringify(this.#data));
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

export default LocalDB;
