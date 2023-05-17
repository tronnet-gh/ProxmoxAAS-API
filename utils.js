import { getUsedResources } from "./pve.js";
import { getUserConfig, getResourceConfig } from "./db.js";

export async function getAllocatedResources(req, username) {
	let dbResources = getResourceConfig();
	let used = await getUsedResources(req, dbResources);
	let max = getUserConfig(username).resources.max;
	let avail = {};
	Object.keys(max).forEach((k) => {
		avail[k] = max[k] - used[k];
	});
	return { used: used, max: max, avail: avail, units: dbResources };
}

export async function approveResources(req, username, request) {

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