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

	if ((await global.userManager.getUser(userObj, cookies)) === null) { // check if user exists in database
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
 * Get the full config of an instance, including searching disk information.
 * @param {Object} req ProxmoxAAS API request object.
 * @param {Object} instance to get config as object containing node, type, and id.
 * @param {Array} diskprefixes Array containing prefixes for disks.
 * @returns
 */
async function getFullInstanceConfig (req, instance, diskprefixes) {
	const config = (await global.pve.requestPVE(`/nodes/${instance.node}/${instance.type}/${instance.vmid}/config`, "GET", { cookies: req.cookies })).data.data;
	// fetch all instance disk and device data concurrently
	const promises = [];
	const mappings = [];
	for (const key in config) {
		if (diskprefixes.some(prefix => key.startsWith(prefix))) {
			promises.push(global.pve.getDiskInfo(instance.node, config, key));
			mappings.push(key);
		}
		else if (key.startsWith("hostpci")) {
			promises.push(global.pve.getDeviceInfo(instance.node, config[key].split(",")[0]));
			mappings.push(key);
		}
	}
	const results = await Promise.all(promises);
	results.forEach((e, i) => {
		const key = mappings[i];
		config[key] = e;
	});
	config.node = instance.node;
	return config;
}

/**
 * Get all configs for every instance owned by the user. Uses the expanded config data from getFullInstanceConfig.
 * @param {Object} req ProxmoxAAS API request object.
 * @param {Object} dbResources data about application resources, to indicate which resources are tracked.
 * @returns {Object} k-v pairs of resource name and used amounts
 */
async function getAllInstanceConfigs (req, diskprefixes) {
	// get the basic resources list
	const resources = (await global.pve.requestPVE("/cluster/resources", "GET", { cookies: req.cookies })).data.data;

	// filter resources by their type, we only want lxc and qemu
	const instances = [];
	for (const resource of resources) {
		if (resource.type === "lxc" || resource.type === "qemu") {
			instances.push(resource);
		}
	}

	// get all instance configs, also include detailed disk and device info
	const promises = [];
	const mappings = [];
	for (let i = 0; i < instances.length; i++) {
		const instance = instances[i];
		const config = getFullInstanceConfig(req, instance, diskprefixes);
		promises.push(config);
		mappings.push(i);
	}
	const configs = await Promise.all(promises);

	return configs;
}

/**
 * Get user resource data including used, available, and maximum resources.
 * @param {Object} req ProxmoxAAS API request object.
 * @param {{id: string, realm: string}} user object of user to get resource data.
 * @returns {{used: Object, avail: Object, max: Object, resources: Object}} used, available, maximum, and resource metadata for the specified user.
 */
export async function getUserResources (req, user) {
	const dbResources = global.config.resources;
	const userResources = (await global.userManager.getUser(user, req.cookies)).resources;
	// setup disk prefixes object
	const diskprefixes = [];
	for (const resourceName of Object.keys(dbResources)) {
		if (dbResources[resourceName].type === "storage") {
			for (const diskPrefix of dbResources[resourceName].disks) {
				diskprefixes.push(diskPrefix);
			}
		}
	}

	// setup the user resource object with used and avail for each resource and each resource pool
	// also add a total counter for each resource (only used for display, not used to check requests)
	for (const resourceName of Object.keys(userResources)) {
		if (dbResources[resourceName].type === "list") {
			userResources[resourceName].total = [];
			userResources[resourceName].global.forEach((e) => {
				e.used = 0;
				e.avail = e.max;
				const index = userResources[resourceName].total.findIndex((availEelement) => e.match === availEelement.match);
				if (index === -1) {
					userResources[resourceName].total.push(structuredClone(e));
				}
				else {
					userResources[resourceName].total[index].max += e.max;
					userResources[resourceName].total[index].avail += e.avail;
				}
			});
			for (const nodeName of Object.keys(userResources[resourceName].nodes)) {
				userResources[resourceName].nodes[nodeName].forEach((e) => {
					e.used = 0;
					e.avail = e.max;
					const index = userResources[resourceName].total.findIndex((availEelement) => e.match === availEelement.match);
					if (index === -1) {
						userResources[resourceName].total.push(structuredClone(e));
					}
					else {
						userResources[resourceName].total[index].max += e.max;
						userResources[resourceName].total[index].avail += e.avail;
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
			userResources[resourceName].global.used = 0;
			userResources[resourceName].global.avail = userResources[resourceName].global.max;
			total.max += userResources[resourceName].global.max;
			total.avail += userResources[resourceName].global.avail;
			for (const nodeName of Object.keys(userResources[resourceName].nodes)) {
				userResources[resourceName].nodes[nodeName].used = 0;
				userResources[resourceName].nodes[nodeName].avail = userResources[resourceName].nodes[nodeName].max;
				total.max += userResources[resourceName].nodes[nodeName].max;
				total.avail += userResources[resourceName].nodes[nodeName].avail;
			}
			userResources[resourceName].total = total;
		}
	}

	const configs = await getAllInstanceConfigs(req, diskprefixes);

	for (const config of configs) {
		const nodeName = config.node;
		for (const resourceName of Object.keys(config)) {
			// numeric resource type
			if (resourceName in dbResources && dbResources[resourceName].type === "numeric") {
				const val = Number(config[resourceName]);
				// if the instance's node is restricted by this resource, add it to the instance's used value
				if (nodeName in userResources[resourceName].nodes) {
					userResources[resourceName].nodes[nodeName].used += val;
					userResources[resourceName].nodes[nodeName].avail -= val;
				}
				// otherwise add the resource to the global pool
				else {
					userResources[resourceName].global.used += val;
					userResources[resourceName].global.avail -= val;
				}
				userResources[resourceName].total.used += val;
				userResources[resourceName].total.avail -= val;
			}
			else if (diskprefixes.some(prefix => resourceName.startsWith(prefix))) {
				const diskInfo = config[resourceName];
				if (diskInfo) { // only count if disk exists
					const val = Number(diskInfo.size);
					const storage = diskInfo.storage;
					// if the instance's node is restricted by this resource, add it to the instance's used value
					if (nodeName in userResources[storage].nodes) {
						userResources[storage].nodes[nodeName].used += val;
						userResources[storage].nodes[nodeName].avail -= val;
					}
					// otherwise add the resource to the global pool
					else {
						userResources[storage].global.used += val;
						userResources[storage].global.avail -= val;
					}
					userResources[storage].total.used += val;
					userResources[storage].total.avail -= val;
				}
			}
			else if (resourceName.startsWith("net") && config[resourceName].includes("rate=")) { // only count net instances with a rate limit
				const val = Number(config[resourceName].split("rate=")[1].split(",")[0]);
				// if the instance's node is restricted by this resource, add it to the instance's used value
				if (nodeName in userResources.network.nodes) {
					userResources.network.nodes[nodeName].used += val;
					userResources.network.nodes[nodeName].avail -= val;
				}
				// otherwise add the resource to the global pool
				else {
					userResources.network.global.used += val;
					userResources.network.global.avail -= val;
				}
				userResources.network.total.used += val;
				userResources.network.total.avail -= val;
			}
			else if (resourceName.startsWith("hostpci")) {
				const deviceInfo = config[resourceName];
				if (deviceInfo) { // only count if device exists
					const deviceName = deviceInfo.device_name;
					// if the instance's node is restricted by this resource, add it to the instance's used value
					if (nodeName in userResources.pci.nodes) {
						const index = userResources.pci.nodes[nodeName].findIndex((availEelement) => deviceName.includes(availEelement.match));
						userResources.pci.nodes[nodeName][index].used++;
						userResources.pci.nodes[nodeName][index].avail--;
					}
					// otherwise add the resource to the global pool
					else {
						const index = userResources.pci.global.findIndex((availEelement) => deviceName.includes(availEelement.match));
						userResources.pci.global[index].used++;
						userResources.pci.global[index].avail--;
					}
					const index = userResources.pci.total.findIndex((availEelement) => deviceName.includes(availEelement.match));
					userResources.pci.total[index].used++;
					userResources.pci.total[index].avail--;
				}
			}
		}
	}

	return userResources;
}

/**
 * Check approval for user requesting additional resources. Generally, subtracts the request from available resources and ensures request can be fulfilled by the available resources.
 * @param {Object} req ProxmoxAAS API request object.
 * @param {{id: string, realm: string}} user object of user requesting additional resources.
 * @param {Object} request k-v pairs of resources and requested amounts
 * @returns {boolean} true if the available resources can fullfill the requested resources, false otherwise.
 */
export async function approveResources (req, user, request, node) {
	const dbResources = global.config.resources;
	const userResources = await getUserResources(req, user);
	let approved = true;
	Object.keys(request).every((key) => {
		// if requested resource is not specified in user resources, assume it's not allowed
		if (!(key in userResources)) {
			approved = false;
			return false;
		}

		const inNode = node in userResources[key].nodes;
		const resourceData = inNode ? userResources[key].nodes[node] : userResources[key].global;

		// if the resource type is list, check if the requested resource exists in the list
		if (dbResources[key].type === "list") {
			const index = resourceData.findIndex((availElement) => request[key].includes(availElement.match));
			// if no matching resource when index == -1, then remaining is -1 otherwise use the remaining value
			const avail = index === -1 ? false : resourceData[index].avail > 0;
			if (avail !== dbResources[key].whitelist) {
				approved = false;
				return false;
			}
		}
		// if either the requested or avail resource is NaN, block
		else if (isNaN(resourceData.avail) || isNaN(request[key])) {
			approved = false;
			return false;
		}
		// if the avail resources is less than the requested resources, block
		else if (resourceData.avail - request[key] < 0) {
			approved = false;
			return false;
		}

		return true;
	});
	return approved; // if all requested resources pass, allow
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
		console.log(`error: ${path} was not found.`);
		exit(1);
	}
};

/**
 *
 * @param {*} username
 * @returns {Object | null} user object containing username and realm or null if user does not exist
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
