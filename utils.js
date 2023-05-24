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

export async function getUserResources (req, username) {
	let dbResources = db.getResourceConfig();
	let used = await getUsedResources(req, dbResources);
	let max = db.getUserConfig(username).resources.max;
	let avail = {};
	Object.keys(max).forEach((k) => {
		avail[k] = max[k] - used[k];
	});
	return { used: used, max: max, avail: avail, units: dbResources };
}

export async function approveResources(req, username, request) {
	let avail = (await getUserResources(req, username)).avail;
	Object.keys(request).forEach((key) => {
		if (!(key in avail)) { // if requested resource is not in avail, block
			approved = false;
			return false;
		}
		else if (isNaN(avail[key]) || isNaN(request[key])) { // if either the requested or avail resource is NaN, block
			approved = false;
			return false;
		}
		else if (avail[key] - request[key] < 0) { // if the avail resources is less than the requested resources, block
			approved = false;
			return false;
		}		
	});
	return true; // if all requested resources pass, allow
}