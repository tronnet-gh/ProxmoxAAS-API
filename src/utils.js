import { createHash } from "crypto";

import { getUsedResources, requestPVE } from "./pve.js";
import db from "./db.js";

/**
 * Check if a user is authorized to access a specified vm, or the cluster in general.
 * @param {Object} cookies user auth cookies.
 * @param {Object} res ProxmoxAAS API response object, used to send auth error responses.
 * @param {string} vmpath vm path to check. Optional, if null then the general /version path is used.
 * @returns {boolean} true if the user is authorized to access the specific vm or cluster in general, false otheriwse.
 */
export async function checkAuth (cookies, res, vmpath = null) {
	let auth = false;

	if (db.getUserConfig(cookies.username) === null) {
		auth = false;
		res.status(401).send({ auth, path: vmpath ? `${vmpath}/config` : "/version", error: `User ${cookies.username} not found in localdb.` });
		res.end();
		return false;
	}

	if (vmpath) {
		const result = await requestPVE(`/${vmpath}/config`, "GET", cookies);
		auth = result.status === 200;
	}
	else { // if no path is specified, then do a simple authentication
		const result = await requestPVE("/version", "GET", cookies);
		auth = result.status === 200;
	}

	if (!auth) {
		res.status(401).send({ auth, path: vmpath ? `${vmpath}/config` : "/version", error: "User token did not pass authentication check." });
		res.end();
	}
	return auth;
}

/**
 * Get user resource data including used, available, and maximum resources.
 * @param {Object} req ProxmoxAAS API request object.
 * @param {string} username of user to get resource data.
 * @returns {{used: Object, avail: Object, max: Object, resources: Object}} used, available, maximum, and resource metadata for the specified user.
 */
export async function getUserResources (req, username) {
	const dbResources = db.getGlobalConfig().resources;
	const used = await getUsedResources(req, dbResources);
	const max = db.getUserConfig(username).resources.max;
	const avail = {};
	Object.keys(max).forEach((k) => {
		if (dbResources[k] && dbResources[k].type === "list") {
			avail[k] = structuredClone(max[k]);
			used[k].forEach((usedDeviceName) => {
				const index = avail[k].findIndex((maxElement) => usedDeviceName.includes(maxElement));
				avail[k].splice(index, 1);
			});
		}
		else {
			avail[k] = max[k] - used[k];
		}
	});
	return { used, max, avail, resources: dbResources };
}

/**
 * Check approval for user requesting additional resources. Generally, subtracts the request from available resources and ensures request can be fulfilled by the available resources.
 * @param {Object} req ProxmoxAAS API request object.
 * @param {string} username of user requesting additional resources.
 * @param {Object} request k-v pairs of resources and requested amounts
 * @returns {boolean} true if the available resources can fullfill the requested resources, false otherwise.
 */
export async function approveResources (req, username, request) {
	const user = await getUserResources(req, username);
	const avail = user.avail;
	const resources = user.resources;
	let approved = true;
	Object.keys(request).forEach((key) => {
		if (!(key in avail)) { // if requested resource is not in avail, block
			approved = false;
		}
		else if (resources[key].type === "list") {
			const inAvail = avail[key].some(availElem => request[key].includes(availElem));
			if (inAvail !== resources[key].whitelist) {
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

export function getObjectHash (object, alg = "sha256", format = "hex") {
	const hash = createHash(alg);
	hash.update(JSON.stringify(object, Object.keys(object).sort()));
	return hash.digest(format);
}

export function getTimeLeft (timeout) {
	return Math.ceil((timeout._idleStart + timeout._idleTimeout - (global.process.uptime() * 1000)));
}
