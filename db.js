const fs = require("fs");

filename = "localdb.json";

let db = {};

/**
 * called at app startup, can be used to initialize any variables needed for database access
 */
function init () {
	try {
		db = JSON.parse(fs.readFileSync(filename));
	}
	catch {
		fs.writeFileSync(filename, JSON.stringify(db));
	}
}

function getResourceMeta () {
	return db.resources;
}

function getUserMax (username) {
	return db.users[username].maximum;
}

function getResourceUnits () {
	return db.units;
}

function putUserResources (username, used) {
	let userEntry = db.users[username];
	userEntry.used = used;
	userEntry.avail = {};
	Object.keys(max).forEach((k) => {
		userEntry.avail[k] = max[k] - used[k];
	});
}

module.exports = {init, getResourceMeta, getUserMax, getResourceUnits, putUserResources};