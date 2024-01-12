import { readFileSync, writeFileSync } from "fs";
import { exit } from "process";
import { DB_BACKEND } from "./backends.js";

export default class LocalDB extends DB_BACKEND {
	#path = null;
	#data = null;
	#defaultuser = null;

	constructor (config) {
		super();
		const path = config.dbfile;
		try {
			this.#path = path;
			this.#load();
			this.#defaultuser = global.config.defaultuser;
		}
		catch {
			console.log(`error: ${path} was not found. Please follow the directions in the README to initialize localdb.json.`);
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

	openSession (credentials) {
		return [];
	}

	closeSesssion (tokens) {
		return true;
	}

	addUser (username, config = null) {
		config = config || this.#defaultuser;
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
