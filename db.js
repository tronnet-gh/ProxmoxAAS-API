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
	Object.keys(db[user]).forEach((element) => {
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
	let newdb = {};
	Object.assign(newdb, db);
	Object.keys(db[user]).forEach((element) => {
		newdb[user][element] -= resource[element];
	});
	try {
		fs.writeFileSync(filename, newdb);
		Object.assign(db, newdb);
		return true;
	}
	catch {
		fs.writeFileSync(filename, db)
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
	let newdb = {};
	Object.assign(newdb, db);
	Object.keys(db[user]).forEach((element) => {
		newdb[user][element] += resource[element];
	});
	try {
		fs.writeFileSync(filename, newdb);
		Object.assign(db, newdb);
		return true;
	}
	catch {
		fs.writeFileSync(filename, db)
		return false;
	}
}

module.exports = {init, requestResources, releaseResources};