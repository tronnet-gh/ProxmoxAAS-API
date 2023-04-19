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

function load () {
	db = JSON.parse(fs.readFileSync(filename));
}

function save () {
	fs.writeFileSync(filename, JSON.stringify(db));
}

function getResourceMeta () {
	return db["resource-metadata"];
}

function getResourceUnits () {
	return db["resource-units"];
}

function getUser (username) {
	return db.users[username];
}

function setUsedResources (username, used) {
	let userEntry = db.users[username];
	userEntry.used = used;
	userEntry.avail = {};
	Object.keys(userEntry.max).forEach((k) => {
		userEntry.avail[k] = userEntry.max[k] - userEntry.used[k];
	});
	save();
}

async function approveResources (username, request) {
	let approved = true;
	let avail = db.users[username].avail;
	Object.keys(request).forEach((key) => {
		if (!(key in avail)) {
			approved = false;
		}
		else if (avail[key] - request[key] < 0) {
			approved = false;
		}
	});
	return approved;
}

module.exports = {init, getResourceMeta, getResourceUnits, getUser, setUsedResources, approveResources};