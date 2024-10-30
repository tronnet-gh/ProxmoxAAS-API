import path from "path";
import url from "url";

export default async () => {
	global.backends = {};
	for (const name in global.config.backends) {
		// get files and config
		const target = global.config.backends[name].import;
		const config = global.config.backends[name].config;
		// get import path
		const thisPath = path.dirname(url.fileURLToPath(import.meta.url));
		const fromPath = path.relative(".", path.dirname(url.fileURLToPath(import.meta.url)));
		const targetPath = path.relative(".", `${fromPath}/${target}`);
		const importPath = `./${path.relative(thisPath, targetPath)}`;
		// import and add to list of imported handlers
		const Backend = (await import(importPath)).default;
		global.backends[name] = new Backend(config);
		console.log(`backends: initialized backend ${name} from ${importPath}`);
	}
	global.pve = global.backends[global.config.handlers.instance.pve];
	global.userManager = new USER_BACKEND_MANAGER(global.config.handlers.users);
};

/**
 * Interface for all backend types. Contains only two methods for opening and closing a session with the backend.
 * Users will recieve tokens from all backends when first authenticating and will delete tokens when logging out.
 */
class BACKEND {
	/**
	 * Opens a session with the backend and creates session tokens if needed
	 * @param {{id: string, realm: string}} user object containing id and realm
	 * @param {string} password
	 * @returns {{ok: boolean, status: number, message: string, cookies: {name: string, value: string}[]}} response like object with list of session token objects with token name and value
	 */
	openSession (user, password) {
		return {
			ok: true,
			status: 200,
			message: "",
			cookies: []
		};
	}

	/**
	 * Closes an opened session with the backend if needed
	 * @param {{name: string, value: string}[]} token list of session token objects with token name and value, may include irrelevant tokens for a specific backend
	 * @returns {boolean} true if session was closed successfully, false otherwise
	 */
	closeSession (tokens) {
		return {
			ok: true,
			status: 200
		};
	}
}

export class AtomicChange {
	constructor (valid, delta, callback, status = { ok: true, status: 200, message: "" }) {
		this.valid = valid;
		this.delta = delta;
		this.callback = callback;
		this.status = status;
	}

	/**
	 * Execute the change using the saved delta using the callback function
	 */
	async commit () {
		const res = await this.callback(this.delta);
		return res;
	}
}

export function doNothingCallback (delta) {
	return { ok: true, status: 200, message: "" };
}

/**
 * Interface for backend types that store/interact with user & group data.
 * Not all backends need to implement all interface methods.
 */
class USER_BACKEND extends BACKEND {
	/**
	 * Validate an add user operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} user
	 * @param {Object} attributes user attributes
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	addUser (user, attributes, params) {}

	/**
	 * Get user from backend
	 * @param {{id: string, realm: string}} user
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {Object} containing user data from this backend, null if user does not exist
	 */
	getUser (user, params) {}

	/**
	 * Get all users from backend
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {Array} containing each user data from this backend
	 */
	getAllUsers (params) {}

	/**
	 * Validate a set user operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} user
	 * @param {Object} attributes new user attributes to modify
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	setUser (user, attributes, params) {}

	/**
	 * Validate a delete user operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} user
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	delUser (user, params) {}

	/**
	 * Validate an add group operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} group
	 * @param {Object} attributes group attributes
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	addGroup (group, attributes, params) {}

	/**
	 * Get group from backend
	 * @param {{id: string}} group
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {Object} containing group data from this backend, null if user does not exist
	 */
	getGroup (group, params) {}

	/**
	 * Get all users from backend
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {Array} containing each group data from this backend
	 */
	getAllGroups (params) {}

	/**
	 * Validate a set group operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} group
	 * @param {Object} attributes group attributes
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	setGroup (group, attributes, params) {}
	/**
	 * Validate a del group operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} group
	 * @param {Object} params authentication params, usually req.cookies
	* @returns {AtomicChange} atomic change object
	 */
	delGroup (group, attributes, params) {}

	/**
	 * Validate an add user to group operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} user
	 * @param {{id: string}} group
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	addUserToGroup (user, group, params) {}

	/**
	 * Validate a remove user from group operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} user
	 * @param {{id: string}} group
	 * @param {Object} params authentication params, usually req.cookies
	* @returns {AtomicChange} atomic change object
	 */
	delUserFromGroup (user, group, params) {}
}

/**
 * Interface for proxmox api backends.
 */
export class PVE_BACKEND extends BACKEND {}

/**
 * Interface for user database backends.
 */
export class DB_BACKEND extends USER_BACKEND {}

/**
 * Interface for user auth backends.
 */
export class AUTH_BACKEND extends USER_BACKEND {}

/**
 * Interface combining all user backends into a single interface
 * Calling methods will also call sub handler methods
 */
class USER_BACKEND_MANAGER extends USER_BACKEND {
	#config = null;

	constructor (config) {
		super();
		this.#config = config;
	}

	getBackendsByUser (user) {
		return this.#config.realm[user.realm];
	}

	addUser (user, attributes, params) {}

	async getUser (user, params) {
		let userData = {};
		for (const backend of this.#config.realm[user.realm]) {
			const backendData = await global.backends[backend].getUser(user, params);
			if (backendData) {
				userData = { ...backendData, ...userData };
			}
		}
		return userData;
	}

	async getAllUsers (params) {
		const userData = {};
		for (const backend of this.#config.any) {
			const backendData = await global.backends[backend].getAllUsers(params);
			if (backendData) {
				for (const user of Object.keys(backendData)) {
					userData[user] = { ...backendData[user], ...userData[user] };
				}
			}
		}
		return userData;
	}

	async setUser (user, attributes, params) {
		const atomicChanges = [];
		for (const backend of this.#config.realm[user.realm]) {
			const atomicChange = await global.backends[backend].setUser(user, attributes, params);
			if (atomicChange.valid === false) { // if any fails, preemptively exit
				return atomicChange.status;
			}
			atomicChanges.push(atomicChange); // queue callback into array
		}
		const response = {
			ok: true,
			status: 200,
			message: "",
			allResponses: []
		};
		for (const atomicChange of atomicChanges) {
			const atomicResponse = await atomicChange.commit();
			if (atomicResponse.ok === false) {
				response.ok = false;
				response.status = atomicResponse.status;
				response.message = atomicResponse.message;
			}
			response.allResponses.push(); // execute callback
		}
		return response;
	}

	delUser (user, params) {}

	addGroup (group, attributes, params) {}

	getGroup (group, params) {}

	async getAllGroups (params) {
		const groupData = {};
		for (const backend of this.#config.any) {
			const backendData = await global.backends[backend].getAllGroups(params);
			if (backendData) {
				for (const group of Object.keys(backendData)) {
					groupData[group] = { ...backendData[group], ...groupData[group] };
				}
			}
		}
		return groupData;
	}

	setGroup (group, attributes, params) {}

	delGroup (group, params) {}

	addUserToGroup (user, group, params) {}

	delUserFromGroup (user, group, params) {}
}
