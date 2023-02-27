const fs = require("fs");

filename = "localdb.json";

let db = {};

/**
 * called at app startup, can be used to initialize any variables needed for database access
 */
function init () {
	try {
		db = fs.readFileSync(filename);
	}
	catch {
		fs.writeFileSync(filename, JSON.stringify(db));
	}
}

/**
 * user requests additional resources specified in k-v pairs
 * @param {string} user user's proxmox username in the form username@authrealm
 * @param {Object} resources k-v pairs with resource name as keys and resource ammount as values
 * @returns {boolean} whether the user is approved to allocate requested resources
 */
function requestResources (user, resources) {
	Object.keys(resources).forEach((element) => {
		if (db[user][element] < resources[element]) {
			return false;
		}
	});
	return true;
}

/**
 * user allocates additional resources specified in k-v pairs
 * @param {string} user user's proxmox username in the form username@authrealm
 * @param {Object} resources k-v pairs with resource name as keys and resource ammount as values
 * @returns {boolean} true if resources were successfully allocated, false otherwise
 */
function allocateResources (user, resources) {
	Object.keys(resources).forEach((element) => {
		db[user][element] -= resource[element];
	});
	try {
		fs.writeFileSync(filename, db);
		return true;
	}
	catch {
		return false;
	}
}

/**
 * user releases allocated resources specified in k-v pairs
 * @param {string} user user's proxmox username in the form username@authrealm
 * @param {Object} resources k-v pairs with resource name as keys and resource ammount as values
 * @returns {boolean} true if resources were successfully deallocated, false otherwise
 */
function releaseResources (user, resources) {
	Object.keys(resources).forEach((element) => {
		db[user][element] += resource[element];
	});
	try {
		fs.writeFileSync(filename, db);
		return true;
	}
	catch {
		return false;
	}
}

module.exports = {init, requestResources, releaseResources};