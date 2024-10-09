import { readFileSync, writeFileSync } from "fs";
import { exit } from "process";
import { AtomicChange, DB_BACKEND, doNothingCallback } from "./backends.js";

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

	addUser (user, attributes, params) {}

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
		if (attributes.resources && attributes.cluster && attributes.templates) {
			const username = `${user.id}@${user.realm}`;
			if (this.#data.users[username]) {
				if (this.#data.users[params.username] && this.#data.users[params.username].cluster.admin) {
					return new AtomicChange(false,
						{
							username,
							attributes: {
								resources: attributes.resources,
								cluster: attributes.cluster,
								templates: attributes.templates
							}
						},
						(delta) => {
							this.#data.users[delta.username] = delta.attributes;
							this.#save();
							return { ok: true, status: 200, message: "" };
						},
						{ ok: true, status: 200, message: "" }
					);
				}
				else {
					return new AtomicChange(false, {}, doNothingCallback, { ok: false, status: 401, message: `${params.username} is not an admin user in localdb` });
				}
			}
			else {
				// return false;
				return new AtomicChange(false, {}, doNothingCallback, { ok: false, status: 400, message: `${username} was not found in localdb` });
			}
		}
		else {
			return new AtomicChange(true, {}, doNothingCallback, null);
		}
	}

	delUser (user, params) {}

	// group methods not implemented because db backend does not store groups
	addGroup (group, atrributes, params) {}
	getGroup (group, params) {}
	getAllGroups (params) {
		return null;
	}

	setGroup (group, attributes, params) {}
	delGroup (group, params) {}

	// assume that adding to group also adds to group's pool
	addUserToGroup (user, group, params) {}

	// assume that adding to group also adds to group's pool
	delUserFromGroup (user, group, params) {}
}
