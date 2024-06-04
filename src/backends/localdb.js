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

	addUser (user, attributes, params = null) {
		const username = `${user.id}@${user.realm}`;
		if (this.#data.users[username]) { // user already exists
			return {
				ok: false,
				status: 1,
				message: "User already exists"
			};
		}
		else {
			attributes = attributes || this.#defaultuser;
			this.#data.users[username] = attributes;
			this.#save();
			return null;
		}
	}

	getUser (user, params = null) {
		const username = `${user.id}@${user.realm}`;
		if (this.#data.users[username]) {
			return this.#data.users[username];
		}
		else {
			return null;
		}
	}

	setUser (user, attributes, params = null) {
		if (attributes.resources && attributes.cluster && attributes.templates) { // localdb should only deal with these attributes
			const username = `${user.id}@${user.realm}`;
			if (this.#data.users[username]) {
				this.#data.users[username] = attributes;
				this.#save();
				return true;
			}
			else {
				return false;
			}
		}
		else { // if request is not setting these attributes, then assume its fine but do nothing
			return true;
		}
	}

	delUser (user, params = null) {
		const username = `${user.id}@${user.realm}`;
		if (this.#data.users[username]) {
			delete this.#data.users[username];
			this.#save();
			return true;
		}
		else {
			return false;
		}
	}

	// group methods not implemented because db backend does not store groups
	addGroup (group, atrributes, params = null) {}
	getGroup (group, params = null) {}
	setGroup (group, attributes, params = null) {}
	delGroup (group, params = null) {}

	// assume that adding to group also adds to group's pool
	addUserToGroup (user, group, params = null) {
		const username = `${user.id}@${user.realm}`;
		if (this.#data.users[username]) {
			this.#data.users[username].cluster.pools[group.id] = true;
			return true;
		}
		else {
			return false;
		}
	}

	// assume that adding to group also adds to group's pool
	delUserFromGroup (user, group, params = null) {
		const username = `${user.id}@${user.realm}`;
		if (this.#data.users[username] && this.#data.users[username].cluster.pools[group.id]) {
			delete this.#data.users[username].cluster.pools[group.id];
			return true;
		}
		else {
			return false;
		}
	}
}
