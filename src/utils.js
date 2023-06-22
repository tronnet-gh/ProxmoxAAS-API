import { getUsedResources, requestPVE } from "./pve.js";
import { db } from "./db.js";

export async function checkAuth(cookies, res, vmpath = null) {
	let auth = false;

	if (db.getUserConfig(cookies.username) === null) {
		auth = false;
		res.status(401).send({ auth: auth, path: vmpath ? `${vmpath}/config` : "/version", error: `user ${cookies.username} not found in localdb` });
		res.end();
		return false;
	}

	if (vmpath) {
		let result = await requestPVE(`/${vmpath}/config`, "GET", cookies);
		auth = result.status === 200;
	}
	else { // if no path is specified, then do a simple authentication
		let result = await requestPVE("/version", "GET", cookies);
		auth = result.status === 200;
	}

	if (!auth) {
		res.status(401).send({ auth: auth, path: vmpath ? `${vmpath}/config` : "/version", error: `user token did not pass authentication check` });
		res.end();
	}
	return auth;
}

export async function getUserResources(req, username) {
	let dbResources = db.getResourceConfig();
	let used = await getUsedResources(req, dbResources);
	let max = db.getUserConfig(username).resources.max;
	let avail = {};
	Object.keys(max).forEach((k) => {
		if (dbResources[k] && dbResources[k].type === "list") {
			avail[k] = structuredClone(max[k]);
			used[k].forEach((usedDeviceName) => {
				let index = avail[k].findIndex((maxElement) => usedDeviceName.includes(maxElement));
				avail[k].splice(index, 1);
			});
		}
		else {
			avail[k] = max[k] - used[k];
		}
	});
	return { used: used, max: max, avail: avail, resources: dbResources };
}

export async function approveResources(req, username, request) {
	let user = await getUserResources(req, username)
	let avail = user.avail;
	let resources = user.resources;
	let max = user.max;
	let approved = true;
	Object.keys(request).forEach((key) => {
		if (!(key in avail)) { // if requested resource is not in avail, block
			approved = false;
		}
		else if (resources[key].type === "list") {
			let inAvail = avail[key].some(availElem => request[key].includes(availElem));
			if (inAvail != resources[key].whitelist) {
				approved = false;
			}
		}
		else if (isNaN(avail[key]) || isNaN(request[key])) { // if either the requested or avail resource is NaN, block
			approved = false;
		}
		else if (avail[key] - request[key] < 0) { // if the avail resources is less than the requested resources, block
			approved = false;
		}
	});
	return approved; // if all requested resources pass, allow
}