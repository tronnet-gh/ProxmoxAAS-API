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
	global.pve = global.backends[global.config.handlers.instance];
	global.access = global.backends[global.config.handlers.users];
};

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
 * Interface for all backend types. Contains only two methods for opening and closing a session with the backend.
 * Users will recieve tokens from all backends when first authenticating and will delete tokens when logging out.
 */
export class BACKEND {
	/**
	 * Opens a session with the backend and creates session tokens if needed
	 * @param {{id: string, realm: string}} user object containing id and realm
	 * @param {string} password
	 * @returns {{ok: boolean, status: number, message: string, cookies: {name: string, value: string}[]}} response like object with list of session token objects with token name and value
	 */
	async openSession (user, password) {
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
	async closeSession (tokens) {
		return {
			ok: true,
			status: 200
		};
	}
}

/**
 * Interface for backend types that store/interact with user, group, and pool data.
 * Not all backends need to implement all interface methods.
 */
export class ACCESS_BACKEND extends BACKEND {
	/**
	 * Validate an add user operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} user
	 * @param {Object} attributes user attributes
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async addUser (user, attributes, params) {}

	/**
	 * Get user from backend
	 * @param {{id: string, realm: string}} user
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {Object} containing user data from this backend, null if user does not exist
	 */
	async getUser (user, params) {}

	/**
	 * Validate a set user operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} user
	 * @param {Object} attributes new user attributes to modify
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async setUser (user, attributes, params) {}

	/**
	 * Validate a delete user operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} user
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async delUser (user, params) {}

	/**
	 * Validate an add group operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} group
	 * @param {Object} attributes group attributes
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async addGroup (group, attributes, params) {}

	/**
	 * Get group from backend
	 * @param {{id: string, realm: string}} group
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {Object} containing group data from this backend, null if user does not exist
	 */
	async getGroup (group, params) {}

	/**
	 * Validate a set group operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} group
	 * @param {Object} attributes group attributes
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async setGroup (group, attributes, params) {}

	/**
	 * Validate a del group operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} group
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async delGroup (group, attributes, params) {}

	/**
	 * Validate an add user to group operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} user
	 * @param {{id: string, realm: string}} group
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async addUserToGroup (user, group, params) {}

	/**
	 * Validate a remove user from group operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} user
	 * @param {{id: string, realm: string}} group
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async delUserFromGroup (user, group, params) {}

	/**
	 * Validate an add pool operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} pool
	 * @param {Object} attributes pool attributes
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async addPool (pool, attributes, params) {}
	
	/**
	 * Get pool from backend
	 * @param {string} pool
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {Object} containing pool data from this backend, null if poll does not exist
	 */
	async getPool (pool, params) {}

	/**
	 * Validate a set pool operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {string} pool
	 * @param {Object} attributes pool attributes
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async setPool (pool, attributes, params) {}

	/**
	 * Validate a del pool operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {string} pool
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async delPool (pool, params) {}

	/**
	 * Validate an add group to pool operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} group
	 * @param {string} pool
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async addGroupToPool (group, pool, params) {}
	
	/**
	 * Validate a remove group from pool operation with the following parameters.
	 * Returns whether the change is valid and a delta object to be used in the operation.
	 * @param {{id: string, realm: string}} group
	 * @param {string} pool
	 * @param {Object} params authentication params, usually req.cookies
	 * @returns {AtomicChange} atomic change object
	 */
	async delGroupFromPool (group, pool, params) {}
}

/**
 * Interface for proxmox api backends.
 */
export class PVE_BACKEND extends BACKEND {
	/**
	 * Get and return node data.
	 * Returns the node data or null if the node does not exist.
	 * @param {string} node node id
	 * @returns {}
	 */
	async getNode (node) {}

	/**
	 * Send a signal to synchronize a node after some change has been made.
	 * * @param {string} node node id
	 */
	async syncNode (node) {}

	/**
	 * Get and return instance data.
	 * Returns the instance data or null if the instance does not exist.
	 * @param {string} node node id
	 * @param {string} type instance type
	 * @param {string} vmid instance id
	 */
	async getInstance (node, type, instance) {}

	/**
	 * Send a signal to synchronize an instance after some change has been made.
	 * @param {string} node node id
	 * @param {string} instance instance id
	 */
	async syncInstance (node, instance) {}

	/**
	 * Get meta data for a specific disk. Adds info that is not normally available in a instance's config.
	 * @param {string} node containing the query disk.
	 * @param {string} instance with query disk.
	 * @param {string} disk name of the query disk, ie. sata0.
	 * @returns {Objetc} k-v pairs of specific disk data, including storage and size of unused disks.
	 */
	async getDisk (node, instance, disk) {}

	/**
	 * Get meta data for a specific net. Adds info that is not normally available in a instance's config.
	 * @param {string} node containing the query net.
	 * @param {string} instance with query net.
	 * @param {string} netid id number of the query net, ie. 0 -> net0.
	 * @returns {Objetc} k-v pairs of specific net data, including rate and vlan.
	 */
	async getNet (node, instance, netid) {}

	/**
	 * Get meta data for a specific device. Adds info that is not normally available in a instance's config.
	 * @param {string} node containing the query device.
	 * @param {string} instance with query device.
	 * @param {string} deviceid id number of the query device, ie. 0 -> pci0.
	 * @returns {Objetc} k-v pairs of specific device data, including name and manfacturer.
	 */
	async getDevice (node, instance, deviceid) {}

	/**
	 * Get pool resource data including used, available, and maximum resources.
	 * @param {string} pool 
	 * @param {Object} cookies object containing k-v store of cookies
	 * @returns {{used: Object, avail: Object, max: Object, resources: Object}} used, available, maximum, and resource metadata for the specified user.
	 */
	async getPoolResources (user, cookies) {}
}
