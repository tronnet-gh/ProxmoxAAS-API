const {getUsedResources} = require("./pve.js");
const {getUserConfig, getResourceConfig} = require("./db.js");

async function getUserData (req, username) {
	let resources = await getAllocatedResources(req, username);
	let instances = getUserConfig(req.cookies.username).instances;
	return {resources: resources, instances: instances};
}

async function getAllocatedResources (req, username) {
	let dbResources = getResourceConfig();
	let used = await getUsedResources(req, dbResources);
	let max = getUserConfig(username).resources.max;
	avail = {};
	Object.keys(max).forEach((k) => {
		avail[k] = max[k] - used[k];
	});
	return {used: used, max: max, avail: avail, units: dbResources};
}

async function approveResources (req, username, request) {

	let avail = (await getAllocatedResources(req, username)).avail;

	let approved = true;
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

module.exports = {getUserData, approveResources}