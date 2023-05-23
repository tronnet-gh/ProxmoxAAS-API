import { readFileSync, writeFileSync } from "fs";

let template = "localdb.json.template"
let filename = "localdb.json";

let db = JSON.parse(readFileSync(template));
try {
	load();
}
catch {
	save();
}

function load() {
	db = JSON.parse(readFileSync(filename));
}

function save() {
	writeFileSync(filename, JSON.stringify(db));
}

export function getResourceConfig() {
	return db.resources;
}

export function getUserConfig(username) {
	if (db.users[username]) {
		return db.users[username];
	}
	else {
		return null;
	}
}