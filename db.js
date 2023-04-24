const fs = require("fs");

template = "localdb.json.template"
filename = "localdb.json";

let db = JSON.parse(fs.readFileSync(template));
try {
	load();
}
catch {
	save();
}

function load () {
	db = JSON.parse(fs.readFileSync(filename));
}

function save () {
	fs.writeFileSync(filename, JSON.stringify(db));
}

function getResourceConfig() {
	return db.resources;
}

function getUserConfig (username) {
	return db.users[username];
}

module.exports = {getUserConfig, getResourceConfig};