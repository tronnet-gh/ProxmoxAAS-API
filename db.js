const fs = require("fs");

template = "localdb.json.template"
filename = "localdb.json";

let db = JSON.parse(fs.readFileSync(template));

/**
 * called at app startup, can be used to initialize any variables needed for database access
 */
function init () {
	try {
		load();
	}
	catch {
		save();
	}
}

function load () {
	db = JSON.parse(fs.readFileSync(filename));
}

function save () {
	fs.writeFileSync(filename, JSON.stringify(db));
}

function getResources() {
	return db.resources;
}

function getUser (username) {
	return db.users[username];
}

module.exports = {init, getUser, getResources};