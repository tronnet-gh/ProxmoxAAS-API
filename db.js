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

module.exports = {init, getResourceMeta, getResourceUnits, getUser};