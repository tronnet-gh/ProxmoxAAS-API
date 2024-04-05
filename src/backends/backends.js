import path from "path";
import url from "url";

export default async () => {
	const backends = {};
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
		backends[name] = new Backend(config);
		console.log(`backends: initialized backend ${name} from ${importPath}`);
	}
	// assign backends to handlers by type
	const handlers = global.config.handlers;
	global.pve = backends[handlers.pve];
	global.db = backends[handlers.db];
	global.auth = handlers.auth;
	Object.keys(global.auth).forEach((e) => {
		global.auth[e] = backends[global.auth[e]];
	});
};

/**
 * Interface for all backend types. Contains only two methods for opening and closing a session with the backend.
 * Users will recieve tokens from all backends when first authenticating and will delete tokens when logging out.
 */
class BACKEND {
	/**
	 * Opens a session with the backend and creates session tokens if needed
	 * @param {{username: string, password: string}} credentials object containing username and password fields
	 * @returns {{ok: boolean, status: number, cookies: {name: string, value: string}[]}} response like object with list of session token objects with token name and value
	 */
	openSession (credentials) {
		return {
			ok: true,
			status: 200,
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

/**
 * Interface for backend types that store/interact with user & group data.
 * Not all backends need to implement all interface methods.
 */
class USER_BACKEND extends BACKEND {
	/**
	 * Add user to backend
	 * @param {{id: string, realm: string}} user
	 * @param {Object} attributes user attributes
	 * @param {Object} params authentication params, usually req.cookies
	 */
	addUser (user, attributes, params = null) {}
	/**
	 * Get user from backend
	 * @param {{id: string, realm: string}} user
	 * @param {Object} params authentication params, usually req.cookies
	 */
	getUser (user, params = null) {}
	/**
	 * Modify user in backend
	 * @param {{id: string, realm: string}} user
	 * @param {Object} attributes new user attributes to modify
	 * @param {Object} params authentication params, usually req.cookies
	 */
	setUser (user, attributes, params = null) {}
	/**
	 * Delete user from backend
	 * @param {{id: string, realm: string}} user
	 * @param {Object} params authentication params, usually req.cookies
	 */
	deluser (user, params = null) {}

	/**
	 * Add group to backend
	 * @param {{id: string}} group 
	 * @param {Object} attributes group attributes
	 * @param {Object} params authentication params, usually req.cookies
	 */
	addGroup (group, attributes, params = null) {}
	/**
	 * Get group from backend
	 * @param {{id: string}} group 
	 * @param {Object} params authentication params, usually req.cookies
	 */
	getGroup (group, params = null) {}
	/**
	 * Modify group in backend
	 * @param {{id: string}} group 
	 * @param {Object} attributes new group attributes to modify
	 * @param {Object} params authentication params, usually req.cookies
	 */
	setGroup (group, attributes, params = null) {}
	/**
	 * Delete group from backend
	 * @param {{id: string}} group 
	 * @param {Object} params authentication params, usually req.cookies
	 */
	delGroup (group, params = null) {}

	/**
	 * Add user to group
	 * @param {{id: string, realm: string}} user 
	 * @param {{id: string}} group 
	 * @param {Object} params authentication params, usually req.cookies
	 */
	addUserToGroup (user, group, params = null) {}
	/**
	 * Remove user from group
	 * @param {{id: string, realm: string}} user 
	 * @param {{id: string}} group 
	 * @param {Object} params authentication params, usually req.cookies
	 */
	delUserFromGroup (user, group, params = null) {}
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