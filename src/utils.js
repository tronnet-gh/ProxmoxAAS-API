import { createHash } from "crypto";
import path from "path";
import url from "url";
import * as fs from "fs";
import { readFileSync } from "fs";
import { exit } from "process";

/**
 * Check if a user is authorized to access a specified vm, or the cluster in general.
 * @param {Object} cookies user auth cookies.
 * @param {Object} res ProxmoxAAS API response object, used to send auth error responses.
 * @param {string} vmpath vm path to check. Optional, if null then the general /version path is used.
 * @returns {boolean} true if the user is authorized to access the specific vm or cluster in general, false otheriwse.
 */
export async function checkAuth (cookies, res, vmpath = null) {
	let auth = false;

	const userObj = getUserObjFromUsername(cookies.username); // check if username exists and is valid
	if (!userObj) {
		res.status(401).send({ auth, path: vmpath ? `${vmpath}/config` : "/version", error: "Username was missing or invalid." });
		res.end();
		return false;
	}

	if (!cookies.PVEAuthCookie) { // check if PVE token exists
		res.status(401).send({ auth, path: vmpath ? `${vmpath}/config` : "/version", error: "Token was missing or invalid." });
		res.end();
		return false;
	}

	const pveTicket = cookies.PVEAuthCookie;
	const result = await global.pve.requestPVE("/access/ticket", "POST", null, { username: cookies.username, password: pveTicket });
	if (result.status !== 200) { // check if PVE token is valid by using /access/ticket to validate ticket with Proxmox
		res.status(401).send({ auth, path: vmpath ? `${vmpath}/config` : "/version", error: "Username did not match token." });
		res.end();
		return false;
	}

	if ((await global.access.getUser(userObj, cookies)) === null) { // check if user exists in database
		res.status(401).send({ auth, path: vmpath ? `${vmpath}/config` : "/version", error: `User ${cookies.username} not found in database.` });
		res.end();
		return false;
	}

	if (vmpath) { // if a path is specified, check the permissions on the path
		const result = await global.pve.requestPVE(`/${vmpath}/config`, "GET", { cookies });
		auth = result.status === 200;
	}
	else { // if no path is specified, then do a simple authentication
		const result = await global.pve.requestPVE("/version", "GET", { cookies });
		auth = result.status === 200;
	}

	if (!auth) {
		res.status(401).send({ auth, path: vmpath ? `${vmpath}/config` : "/version", error: "User token did not pass authentication check." });
		res.end();
	}

	return auth;
}

/**
 * Get pool resource data including used, available, and maximum resources.
 * @param {Object} req ProxmoxAAS API request object.
 * @param {{id: string, realm: string}} user object of user to get resource data.
 * @returns {{used: Object, avail: Object, max: Object, resources: Object}} used, available, maximum, and resource metadata for the specified user.
 */
export async function getPoolResources (req, pool) {
	const configResources = global.config.resources;
	const poolConfig = await global.access.getPool(pool, req.cookies);
	const poolResources = poolConfig.pool.resources;

	// setup the pool resource object with used and avail for each resource and each resource pool
	// also add a total counter for each resource (only used for display, not used to check requests)
	for (const resourceName of Object.keys(poolResources)) {
		if (configResources[resourceName].type === "list") {
			poolResources[resourceName].total = [];
			poolResources[resourceName].global.forEach((e) => {
				e.used = 0;
				e.avail = e.max;
				const index = poolResources[resourceName].total.findIndex((availEelement) => e.match === availEelement.match);
				if (index === -1) {
					poolResources[resourceName].total.push(structuredClone(e));
				}
				else {
					poolResources[resourceName].total[index].max += e.max;
					poolResources[resourceName].total[index].avail += e.avail;
				}
			});
			for (const nodeName of Object.keys(poolResources[resourceName].nodes)) {
				poolResources[resourceName].nodes[nodeName].forEach((e) => {
					e.used = 0;
					e.avail = e.max;
					const index = poolResources[resourceName].total.findIndex((availEelement) => e.match === availEelement.match);
					if (index === -1) {
						poolResources[resourceName].total.push(structuredClone(e));
					}
					else {
						poolResources[resourceName].total[index].max += e.max;
						poolResources[resourceName].total[index].avail += e.avail;
					}
				});
			}
		}
		else {
			const total = {
				max: 0,
				used: 0,
				avail: 0
			};
			poolResources[resourceName].global.used = 0;
			poolResources[resourceName].global.avail = poolResources[resourceName].global.max;
			total.max += poolResources[resourceName].global.max;
			total.avail += poolResources[resourceName].global.avail;
			for (const nodeName of Object.keys(poolResources[resourceName].nodes)) {
				poolResources[resourceName].nodes[nodeName].used = 0;
				poolResources[resourceName].nodes[nodeName].avail = poolResources[resourceName].nodes[nodeName].max;
				total.max += poolResources[resourceName].nodes[nodeName].max;
				total.avail += poolResources[resourceName].nodes[nodeName].avail;
			}
			poolResources[resourceName].total = total;
		}
	}

	const configs = await global.pve.getPoolResources(req.cookies, pool);

	for (const vmid in configs) {
		const config = configs[vmid];
		const nodeName = config.node;
		// count basic numeric resources
		for (const resourceName of Object.keys(config)) {
			// numeric resource type
			if (resourceName in configResources && configResources[resourceName].type === "numeric") {
				const val = Number(config[resourceName]);
				// if the instance's node is restricted by this resource, add it to the instance's used value
				if (nodeName in poolResources[resourceName].nodes) {
					poolResources[resourceName].nodes[nodeName].used += val;
					poolResources[resourceName].nodes[nodeName].avail -= val;
				}
				// otherwise add the resource to the global pool
				else {
					poolResources[resourceName].global.used += val;
					poolResources[resourceName].global.avail -= val;
				}
				poolResources[resourceName].total.used += val;
				poolResources[resourceName].total.avail -= val;
			}
		}
		// count disk resources in volumes
		for (const diskid in config.volumes) {
			const disk = config.volumes[diskid];
			const storage = disk.storage;
			const size = disk.size;
			// only process disk if its storage is in the user resources to be counted
			if (storage in poolResources) {
				// if the instance's node is restricted by this resource, add it to the instance's used value
				if (nodeName in poolResources[storage].nodes) {
					poolResources[storage].nodes[nodeName].used += size;
					poolResources[storage].nodes[nodeName].avail -= size;
				}
				// otherwise add the resource to the global pool
				else {
					poolResources[storage].global.used += size;
					poolResources[storage].global.avail -= size;
				}
				poolResources[storage].total.used += size;
				poolResources[storage].total.avail -= size;
			}
		}
		// count net resources in nets
		for (const netid in config.nets) {
			const net = config.nets[netid];
			const rate = net.rate;
			if (poolResources.network) {
				// if the instance's node is restricted by this resource, add it to the instance's used value
				if (nodeName in poolResources.network.nodes) {
					poolResources.network.nodes[nodeName].used += rate;
					poolResources.network.nodes[nodeName].avail -= rate;
				}
				// otherwise add the resource to the global pool
				else {
					poolResources.network.global.used += rate;
					poolResources.network.global.avail -= rate;
				}
				poolResources.network.total.used += rate;
				poolResources.network.total.avail -= rate;
			}
		}
		// count pci device resources in devices
		for (const deviceid in config.devices) {
			const device = config.devices[deviceid];
			const name = device.device_name;
			// if the node has a node specific rule, add it there
			if (nodeName in poolResources.pci.nodes) {
				const index = poolResources.pci.nodes[nodeName].findIndex((availEelement) => name.includes(availEelement.match));
				if (index >= 0) {
					poolResources.pci.nodes[nodeName][index].used++;
					poolResources.pci.nodes[nodeName][index].avail--;
				}
			}
			// otherwise try to add the resource to the global pool
			else {
				const index = poolResources.pci.global.findIndex((availEelement) => name.includes(availEelement.match));
				if (index >= 0) { // device resource is in the user's global list then increment it by 1
					poolResources.pci.global[index].used++;
					poolResources.pci.global[index].avail--;
				}
			}
			// finally, add the device to the total map
			const index = poolResources.pci.total.findIndex((availEelement) => name.includes(availEelement.match));
			if (index >= 0) {
				poolResources.pci.total[index].used++;
				poolResources.pci.total[index].avail--;
			}
		}
	}

	return poolResources;
}

/**
 * Check approval for user requesting additional resources. Generally, subtracts the request from available resources and ensures request can be fulfilled by the available resources.
 * @param {Object} req ProxmoxAAS API request object.
 * @param {{id: string, realm: string}} user object of user requesting additional resources.
 * @param {string} node name of node hosting requested resource(s)
 * @param {string} pool name of pool hosting requested resource(s)
 * @param {Object} request k-v pairs of resources and requested amounts
 * @returns {boolean, Object} true if the available resources can fullfill the requested resources, false otherwise.
 */
export async function approveResources (req, user, node, pool, request) {
	const configResources = global.config.resources;
	const poolResources = await getPoolResources(req, pool);
	const reason = {};

	for (const key in request) {
		// if requested resource is not specified in user resources, assume it's not allowed
		if (!(key in poolResources)) {
			reason[key] = { approved: false, reason: `${key} not allowed` };
			continue;
		}

		// use node specific quota if there is one available, otherwise use the global resource quota
		const inNode = node in poolResources[key].nodes;
		const resourceData = inNode ? poolResources[key].nodes[node] : poolResources[key].global;

		// if the resource type is list, check if the requested resource exists in the list
		if (configResources[key].type === "list") {
			const index = resourceData.findIndex((availElement) => request[key].includes(availElement.match));
			// if no matching resource when index == -1, then remaining is -1 otherwise use the remaining value
			const avail = index === -1 ? false : resourceData[index].avail > 0;
			if (avail !== configResources[key].whitelist) {
				reason[key] = { approved: false, reason: `${key} ${configResources[key].whitelist ? "not in whitelist" : "in blacklist"}` };
				continue;
			}
		}

		// if either the requested or avail resource is not strictly a number, block
		if (typeof (resourceData.avail) !== "number" || typeof (request[key]) !== "number") {
			reason[key] = { approved: false, reason: `expected ${key} to be a number but got ${request[key]}` };
			continue;
		}

		// if the avail resources is less than the requested resources, block
		if (resourceData.avail - request[key] < 0) {
			reason[key] = { approved: false, reason: `${key} requested ${request[key]} which is more than ${resourceData.avail} available` };
			continue;
		}

		reason[key] = { approved: true, reason: "ok" };
	}

	const approved = Object.values(reason).every((element) => {
		return element.approved === true;
	});
	return { approved, reason }; // if all requested resources pass, allow
}

/**
 * Get the hash value of an object with data values.
 * @param {Object} object to be hashed.
 * @param {string} alg algorithm used to get digest.
 * @param {string} format format of digest.
 * @returns {string} digest of hash function.
 */
export function getObjectHash (object, alg = "sha256", format = "hex") {
	const hash = createHash(alg);
	hash.update(JSON.stringify(object, Object.keys(object).sort()));
	return hash.digest(format);
}

/**
 * Get the time remaining of scheduler timeout object.
 * @param {Object} timeout object to get time reamining.
 * @returns {number} milliseconds remaining until next event.
 */
export function getTimeLeft (timeout) {
	return Math.ceil((timeout._idleStart + timeout._idleTimeout - (global.process.uptime() * 1000)));
}

/**
 * Recursively import routes from target folder.
 * @param {Object} router or app object.
 * @param {string} baseroute base route of imported modules starting from the current path.
 * @param {string} target folder to import modules.
 * @param {string} from source folder of calling module, optional for imports from the same base directory.
 */
export function recursiveImportRoutes (router, baseroute, target, from = import.meta.url) {
	const thisPath = path.dirname(url.fileURLToPath(import.meta.url));
	const fromPath = path.relative(".", path.dirname(url.fileURLToPath(from)));
	const targetPath = path.relative(".", `${fromPath}/${target}`);
	const baseImportPath = path.relative(thisPath, targetPath);
	const files = fs.readdirSync(targetPath);
	files.forEach((file) => {
		if (file.endsWith(".js")) {
			const path = `./${baseImportPath}/${file}`;
			const route = `${baseroute}/${file.replace(".js", "")}`;
			import(path).then((module) => {
				router.use(route, module.router);
			});
			console.log(`routes: loaded ${path} as ${route}`);
		}
	});
}

export function readJSONFile (path) {
	try {
		return JSON.parse(readFileSync(path));
	}
	catch (e) {
		console.log(`json: error opening ${path}: ${e}`);
		exit(1);
	}
};

/**
 * Parse username into user object using the uid@realm format.
 * @param {*} username
 * @returns {Object | null} user object containing userid and realm or null if username format was invalid
 */
export function getUserObjFromUsername (username) {
	if (username) {
		const userRealm = username.split("@").at(-1);
		const userID = username.replace(`@${userRealm}`, "");
		const userObj = { id: userID, realm: userRealm };
		return userObj;
	}
	else {
		return null;
	}
}

/**
 * Parse groupname into group object using the gid-realm format.
 * @param {*} groupname
 * @returns {Object | null} user object containing groupid and realm or null if groupname format was invalid
 */
export function getGroupObjFromGroupname (groupname) {
	if (groupname) {
		if (groupname.includes("-")) {
			const groupRealm = groupname.split("-").at(-1);
			const groupID = groupname.replace(`-${groupRealm}`, "");
			const groupObj = { id: groupID, realm: groupRealm };
			return groupObj;
		}
		else {
			const groupRealm = "pve";
			const groupID = groupname;
			const groupObj = { id: groupID, realm: groupRealm };
			return groupObj;
		}
	}
	else {
		return null;
	}
}

/**
 * Inspect pool object and return true if pool contains any groups which contain the user object.
 * @param {Object} poolObj pool data object
 * @param {Object} userObj user object containing id and realm
 * @returns {boolean} true if userObj in poolObj
 */
export function checkUserInPool(poolObj, userObj) {
	for (const group of poolObj.groups) {
		// assumption: pool listed groups are all relevant memberships (ie are paas client role)
		for (const user of group.users) {
			if (user.username.uid === userObj.id && user.username.realm === userObj.realm) {
				return true;
			}
		}
	}
	return false;
}
