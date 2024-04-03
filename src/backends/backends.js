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
	// assign backends to handlers depending
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
	 * @param {Object} credentials object containing username and password fields
	 * @returns {Object} response like object with ok, status, and list of session token objects with token name and value
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
	 * @param {Object[]} token list of session token objects with token name and value, may include irrelevant tokens for a specific backend
	 * @returns {Boolean} true if session was closed successfully, false otherwise
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
	addUser (username, attributes, params = null) {}
	getUser (username, params = null) {}
	setUser (username, attributes, params = null) {}
	deluser (username, params = null) {}

	addGroup (groupname, attributes, params = null) {}
	getGroup (groupname, params = null) {}
	setGroup (groupname, attributes, params = null) {}
	delGroup (groupname, params = null) {}

	addUserToGroup (username, groupname, params = null) {}
	delUserFromGroup (username, groupname, params = null) {}
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
