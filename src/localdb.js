import { readFileSync, writeFileSync } from "fs";
import { exit } from "process";

class LocalDB {
	#path = null;
	#data = null;
	constructor (path) {
		try {
			this.#path = path;
			this.#load();
			this.pveAPI = this.getGlobal().application.pveAPI;
			this.pveAPIToken = this.getGlobal().application.pveAPIToken;
			this.listenPort = this.getGlobal().application.listenPort;
			this.hostname = this.getGlobal().application.hostname;
			this.domain = this.getGlobal().application.domain;
		}
		catch {
			console.log(`Error: ${path} was not found. Please follow the directions in the README to initialize localdb.json.`);
			exit(1);
		}
	}

	/**
	 * Load db from local file system. Reads from file path store in path.
	 */
	#load () {
		this.#data = JSON.parse(readFileSync(this.#path));
	}

	/**
	 * Save db to local file system. Saves to file path stored in path.
	 */
	#save () {
		writeFileSync(this.#path, JSON.stringify(this.#data));
	}

	getStatic () {
		return this.#data.static;
	}

	getGlobal () {
		return this.#data.global;
	}

	setGloal (config) {
		this.#data.global = config;
		this.#save();
	}

	addUser (username, config = null) {
		config = config || this.#data.global.defaultuser;
		this.#data.users[username] = config;
		this.#save();
	}

	getUser (username) {
		if (this.#data.users[username]) {
			return this.#data.users[username];
		}
		else {
			return null;
		}
	}

	setUser (username, config) {
		if (this.#data.users[username]) {
			this.#data.users[username] = config;
			this.#save();
			return true;
		}
		else {
			return false;
		}
	}

	delUser (username) {
		if (this.#data.users[username]) {
			delete this.#data.users[username];
			this.#save();
			return true;
		}
		else {
			return false;
		}
	}
}

export default LocalDB;
