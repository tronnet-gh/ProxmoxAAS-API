import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import morgan from "morgan";
import api from "./package.json" assert {type: "json"};

import { pveAPIToken, listenPort, hostname, domain } from "./vars.js";
import { checkAuth, requestPVE, handleResponse, getDiskInfo } from "./pve.js";
import { getAllocatedResources, approveResources } from "./utils.js";
import { getUserConfig } from "./db.js";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser())
app.use(cors({ origin: hostname }));
app.use(morgan("combined"));

/**
 * GET - get API version
 * responses:
 * - 200: {version: String}
 */
app.get("/api/version", (req, res) => {
	res.status(200).send({ version: api.version });
});

/**
 * GET - echo request
 * responses:
 * - 200: {body: request.body, cookies: request.cookies}
 */
app.get("/api/echo", (req, res) => {
	res.status(200).send({ body: req.body, cookies: req.cookies });
});

/**
 * GET - check authentication
 * responses:
 * - 200: {auth: true, path: String}
 * - 401: {auth: false, path: String}
 */
app.get("/api/auth", async (req, res) => {
	let auth = await checkAuth(req.cookies, res);
	if (!auth) { return; }
	res.status(200).send({ auth: true });
});

/**
 * GET - proxy proxmox api without privilege elevation
 * request and responses passed through to/from proxmox
 */
app.get("/api/proxmox/*", async (req, res) => { // proxy endpoint for GET proxmox api with no token
	let path = req.url.replace("/api/proxmox", "");
	let result = await requestPVE(path, "GET", req.cookies);
	res.status(result.status).send(result.data);
});

/**
 * POST - proxy proxmox api without privilege elevation
 * request and responses passed through to/from proxmox
 */
app.post("/api/proxmox/*", async (req, res) => { // proxy endpoint for POST proxmox api with no token
	let path = req.url.replace("/api/proxmox", "");
	let result = await requestPVE(path, "POST", req.cookies, JSON.stringify(req.body)); // need to stringify body because of other issues
	res.status(result.status).send(result.data);
});

/**
 * POST - safer ticket generation using proxmox authentication but adding HttpOnly
 * request:
 * - username: String
 * - password: String
 * responses:
 * - 200: {auth: true, path: String}
 * - 401: {auth: false, path: String}
 */
app.post("/api/ticket", async (req, res) => {
	let response = await requestPVE("/access/ticket", "POST", null, JSON.stringify(req.body));
	if (!(response.status === 200)) {
		res.status(response.status).send({ auth: false });
		res.end();
		return;
	}
	let ticket = response.data.data.ticket;
	let csrftoken = response.data.data.CSRFPreventionToken;
	let username = response.data.data.username;
	let expire = new Date(Date.now() + (2 * 60 * 60 * 1000));
	res.cookie("PVEAuthCookie", ticket, { domain: domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("CSRFPreventionToken", csrftoken, { domain: domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("username", username, { domain: domain, path: "/", secure: true, expires: expire });
	res.cookie("auth", 1, { domain: domain, path: "/", secure: true, expires: expire });
	res.status(200).send({ auth: true });
});

/**
 * DELETE - request to destroy ticket
 * responses:
 * - 200: {auth: false, path: String}
 */
app.delete("/api/ticket", async (req, res) => {
	let expire = new Date(0);
	res.cookie("PVEAuthCookie", "", { domain: domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("CSRFPreventionToken", "", { domain: domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("username", "", { domain: domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("auth", 0, { domain: domain, path: "/", expires: expire });
	res.status(200).send({ auth: false });
});

/**
 * GET - get db user resource information including allocated, free, and maximum resource values along with resource metadata
 * responses:
 * - 200: {avail: Object, max: Object, units: Object, used: Object}
 * - 401: {auth: false, path: String}
 */
app.get("/api/user/resources", async (req, res) => {
	// check auth
	let auth = await checkAuth(req.cookies, res);
	if (!auth) { return; }
	let resources = await getAllocatedResources(req, req.cookies.username);
	res.status(200).send(resources);
});

/**
 * GET - get db user instance configuration
 * responses:
 * - 200: {pool: String, templates: {lxc: Object, qemu: Object}, vmid: {min: Number, max: Number}}
 * - 401: {auth: false, path: String}
 */
app.get("/api/user/instances", async (req, res) => {
	// check auth
	let auth = await checkAuth(req.cookies, res);
	if (!auth) { return; }
	let config = getUserConfig(req.cookies.username);
	res.status(200).send(config.instances)
});

/**
 * GET - get db user node configuration
 * responses:
 * - 200: {nodes: String[]}
 * - 401: {auth: false, path: String}
 */
app.get("/api/user/nodes", async (req, res) => {
	// check auth
	let auth = await checkAuth(req.cookies, res);
	if (!auth) { return; }
	let config = getUserConfig(req.cookies.username);
	res.status(200).send({ nodes: config.nodes })
})

/**
 * POST - detach mounted disk from instance
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - disk: String - disk id (sata0, NOT unused)
 * responses:
 * - 200: Object(pve_auth_object)
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: Object(pve_task_object)
 */
app.post("/api/instance/disk/detach", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	if (req.body.disk.includes("unused")) {
		res.status(500).send({ error: `Requested disk ${req.body.disk} cannot be unused. Use /disk/delete to permanently delete unused disks.` });
		res.end();
		return;
	}
	let action = JSON.stringify({ delete: req.body.disk });
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

/**
 * POST - attach unused disk image to instance
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - disk: String - disk id (sata0)
 * - source: Number - source unused disk number (0 => unused0)
 * responses:
 * - 200: Object(pve_auth_object)
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: Object(pve_task_object)
 */
app.post("/api/instance/disk/attach", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// get current config and check if unused disk exists
	let config = await requestPVE(`${vmpath}/config`, "GET", req.cookies, null, null);
	if (!config.data.data[`unused${req.body.source}`]) {
		res.status(403).send({ error: `requested disk unused${req.body.source} does not exist` });
		res.end();
		return;
	}
	let sourceDisk = config.data.data[`unused${req.body.source}`];
	// setup action using source disk info from vm config
	let action = {};
	action[req.body.disk] = sourceDisk;
	action = JSON.stringify(action);
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	// commit action
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

/**
 * POST - increase size of mounted disk
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - disk: String - disk id (sata0)
 * - size: Number - increase size in GiB
 * responses:
 * - 200: Object(pve_auth_object)
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: {request: Object, error: String}
 * - 500: Object(pve_task_object)
 */
app.post("/api/instance/disk/resize", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// check disk existence
	let diskConfig = await getDiskInfo(req.body.node, req.body.type, req.body.vmid, req.body.disk); // get target disk
	if (!diskConfig) { // exit if disk does not exist
		res.status(500).send({ error: `requested disk ${req.body.disk} does not exist` });
		res.end();
		return;
	}
	// setup request
	let storage = diskConfig.storage; // get the storage
	let request = {};
	request[storage] = Number(req.body.size * 1024 ** 3); // setup request object
	// check request approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request: request, error: `Storage ${storage} could not fulfill request of size ${req.body.size}G.` });
		res.end();
		return;
	}
	// action approved, commit to action
	let action = JSON.stringify({ disk: req.body.disk, size: `+${req.body.size}G` });
	let result = await requestPVE(`${vmpath}/resize`, "PUT", req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

/**
 * POST - move mounted disk from one storage to another
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - disk: String - disk id (sata0)
 * - storage: String - target storage to move disk
 * - delete: Number - delete original disk (0, 1) 
 * responses:
 * - 200: Object(pve_auth_object)
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: {request: Object, error: String}
 * - 500: Object(pve_task_object)
 */
app.post("/api/instance/disk/move", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// check disk existence
	let diskConfig = await getDiskInfo(req.body.node, req.body.type, req.body.vmid, req.body.disk); // get target disk
	if (!diskConfig) { // exit if disk does not exist
		res.status(500).send({ error: `requested disk ${req.body.disk} does not exist` });
		res.end();
		return;
	}
	// setup request
	let size = parseInt(diskConfig.size); // get source disk size
	let srcStorage = diskConfig.storage; // get source storage
	let dstStorage = req.body.storage; // get destination storage
	let request = {};
	let release = {};
	if (req.body.delete) { // if delete is true, increase resource used by the source storage
		release[srcStorage] = Number(size);
	}
	request[dstStorage] = Number(size); // always decrease destination storage by size
	// check request approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request: request, error: `Storage ${req.body.storage} could not fulfill request of size ${req.body.size}G.` });
		res.end();
		return;
	}
	// create action
	let action = { storage: req.body.storage, delete: req.body.delete };
	if (req.body.type === "qemu") {
		action.disk = req.body.disk
	}
	else {
		action.volume = req.body.disk
	}
	action = JSON.stringify(action);
	let route = req.body.type === "qemu" ? "move_disk" : "move_volume";
	// commit action
	let result = await requestPVE(`${vmpath}/${route}`, "POST", req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

/**
 * POST - delete unused disk permanently
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - disk: String - disk id (sata0)
 * responses:
 * - 200: Object(pve_auth_object)
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: Object(pve_task_object)
 */
app.post("/api/instance/disk/delete", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// only ide or unused are allowed to be deleted
	if (!req.body.disk.includes("unused") && !req.body.disk.includes("ide")) { // must be ide or unused
		res.status(500).send({ error: `Requested disk ${req.body.disk} must be unused or ide. Use /disk/detach to detach disks in use.` });
		res.end();
		return;
	}
	// create action
	let action = JSON.stringify({ delete: req.body.disk });
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	// commit action
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

/**
 * POST - create a new disk in storage of specified size
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - disk: String - disk id (sata0, ide0)
 * - storage: String - storage to hold disk
 * - size: Number size of disk in GiB
 * responses:
 * - 200: Object(pve_auth_object)
 * - 401: {auth: false, path: String}
 * - 500: {request: Object, error: String}
 * - 500: Object(pve_task_object)
 */
app.post("/api/instance/disk/create", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// setup request
	let request = {};
	if (!req.body.disk.includes("ide")) {
		request[req.body.storage] = Number(req.body.size * 1024 ** 3); // setup request object
		// check request approval
		if (!await approveResources(req, req.cookies.username, request)) {
			res.status(500).send({ request: request, error: `Storage ${req.body.storage} could not fulfill request of size ${req.body.size}G.` });
			res.end();
			return;
		}
	}
	// setup action
	let action = {};
	if (req.body.disk.includes("ide") && req.body.iso) {
		action[req.body.disk] = `${req.body.iso},media=cdrom`;
	}
	else if (req.body.type === "qemu") { // type is qemu, use sata
		action[req.body.disk] = `${req.body.storage}:${req.body.size}`;
	}
	else { // type is lxc, use mp and add mp and backup values
		action[req.body.disk] = `${req.body.storage}:${req.body.size},mp=/${req.body.disk}/,backup=1`;
	}
	action = JSON.stringify(action);
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	// commit action
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

/**
 * POST - modify virtual network interface
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - netid: Number - network interface id number (0 => net0)
 * - rate: Number - new bandwidth rate for interface in MB/s
 * responses:
 * - 200: Object(pve_auth_object)
 * - 401: {auth: false, path: String}
 * - 500: {request: Object, error: String}
 * - 500: Object(pve_task_object)
 */
app.post("/api/instance/network", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// get current config
	let currentConfig = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, "GET", null, null, pveAPIToken);
	let currentNetworkConfig = currentConfig.data.data[`net${req.body.netid}`];
	let currentNetworkRate = currentNetworkConfig.split("rate=")[1].split(",")[0];
	let request = {
		network: Number(req.body.rate) - Number(currentNetworkRate)
	};
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request: request, error: `Could not fulfil network request of ${req.body.rate}MB/s` });
		res.end();
		return;
	}
	// setup action
	let action = {};
	action[`net${req.body.netid}`] = currentNetworkConfig.replace(`rate=${currentNetworkRate}`, `rate=${req.body.rate}`);
	action = JSON.stringify(action);
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	// commit action
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

/**
 * POST - set basic resources for vm
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - cores: Number - new number of cores for instance
 * - memory: Number - new amount of memory for instance
 * - swap: Number, optional - new amount of swap for instance
 * responses:
 * - 200: Object(pve_auth_object)
 * - 401: {auth: false, path: String}
 * - 500: {request: Object, error: String}
 * - 500: Object(pve_task_object)
 */
app.post("/api/instance/resources", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// get current config
	let currentConfig = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, "GET", null, null, pveAPIToken);
	let request = {
		cores: Number(req.body.cores) - Number(currentConfig.data.data.cores),
		memory: Number(req.body.memory) - Number(currentConfig.data.data.memory)
	};
	if (req.body.type === "lxc") {
		request.swap = Number(req.body.swap) - Number(currentConfig.data.data.swap);
	}
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request: request, error: `Could not fulfil request` });
		res.end();
		return;
	}
	// setup action
	let action = { cores: req.body.cores, memory: req.body.memory };
	if (req.body.type === "lxc") {
		action.swap = Number(req.body.swap);
	}
	action = JSON.stringify(action);
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	// commit action
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

/**
 * POST - create new instance
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number for instance
 * - hostname: String, optional- hostname for lxc instance
 * - name: String, optional - hostname for qemu instance
 * - cores: Number - number of cores for instance
 * - memory: Number - amount of memory for instance
 * - swap: Number, optional - amount of swap for lxc instance
 * - password: String, optional - password for lxc instance
 * - ostemplate: String, optional - os template name for lxc instance
 * - rootfslocation: String, optional - storage name for lxc instance rootfs
 * - rootfssize: Number, optional, - size of lxc instance rootfs
 * responses:
 * - 200: Object(pve_auth_object)
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: {request: Object, error: String}
 * - 500: Object(pve_task_object)
 */
app.post("/api/instance", async (req, res) => {
	// check auth
	let auth = await checkAuth(req.cookies, res);
	if (!auth) { return; }
	// setup request
	let request = {
		cores: Number(req.body.cores),
		memory: Number(req.body.memory)
	};
	// setup action
	let user = await getUserConfig(req.cookies.username);
	let vmid = Number.parseInt(req.body.vmid);
	let vmid_min = user.instances.vmid.min;
	let vmid_max = user.instances.vmid.max;
	// check vmid is within allowed range
	if (vmid < vmid_min || vmid > vmid_max) {
		res.status(500).send({ error: `Requested vmid ${vmid} is out of allowed range [${vmid_min},${vmid_max}]` });
		res.end();
		return;
	}
	// check node is within allowed list
	if (!user.nodes.includes(req.body.node)) {
		res.status(500).send({ error: `Requested node ${req.body.node} is not in allowed nodes [${user.nodes}]` });
		res.end();
		return;
	}
	let action = {
		vmid: req.body.vmid,
		cores: req.body.cores,
		memory: req.body.memory,
		pool: user.instances.pool
	};
	for (let key of Object.keys(user.instances.templates[req.body.type])) {
		action[key] = user.instances.templates[req.body.type][key];
	}
	if (req.body.type === "lxc") {
		action.swap = req.body.swap;
		action.hostname = req.body.name;
		action.unprivileged = 1;
		action.features = "nesting=1";
		action.password = req.body.password;
		action.ostemplate = req.body.ostemplate;
		action.rootfs = `${req.body.rootfslocation}:${req.body.rootfssize}`;
		request[req.body.rootfslocation] = req.body.rootfssize;
	}
	else {
		action.name = req.body.name;
	}
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) { // check resource approval
		res.status(500).send({ request: request, error: `Not enough resources to satisfy request.` });
		res.end();
		return;
	}
	action = JSON.stringify(action);
	// commit action
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}`, "POST", req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

/**
 * DELETE - destroy existing instance
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number to destroy
 * responses:
 * - 200: Object(pve_auth_object)
 * - 401: {auth: false, path: String}
 * - 500: Object(pve_task_object)
 */
app.delete("/api/instance", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// commit action
	let result = await requestPVE(vmpath, "DELETE", req.cookies, null, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.listen(listenPort, () => {
	console.log(`proxmoxaas-api v${api.version} listening on port ${listenPort}`);
});