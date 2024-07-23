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

	addUser (user, attributes, params) {
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

	getUser (user, params) {
		const requestedUser = `${user.id}@${user.realm}`;
		const requestingUser = params.username; // assume checkAuth has been run, which already checks that username matches PVE token
		// user can access a user's db data if they are an admin OR are requesting own data
		const authorized = this.#data.users[requestingUser].cluster.admin || requestingUser === requestedUser;
		if (authorized && this.#data.users[requestedUser]) {
			return this.#data.users[requestedUser];
		}
		else {
			return null;
		}
	}

	async getAllUsers (params) {
		const requestingUser = params.username; // assume checkAuth has been run, which already checks that username matches PVE token
		if (this.#data.users[requestingUser].cluster.admin === true) {
			return this.#data.users;
		}
		else {
			return null;
		}
	}

	setUser (user, attributes, params) {
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

	delUser (user, params) {
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
	addGroup (group, atrributes, params) {}
	getGroup (group, params) {}
	getAllGroups (params) {
		return null;
	}
	setGroup (group, attributes, params) {}
	delGroup (group, params) {}

	// assume that adding to group also adds to group's pool
	addUserToGroup (user, group, params) {
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
	delUserFromGroup (user, group, params) {
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
