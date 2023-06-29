import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import morgan from "morgan";
import api from "../package.json" assert {type: "json"};

import { requestPVE, handleResponse, getDiskInfo, getDeviceInfo, getNodeAvailDevices } from "./pve.js";
import { checkAuth, approveResources, getUserResources } from "./utils.js";
import { db, pveAPIToken, listenPort, hostname, domain } from "./db.js";

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
 * - 200: {avail: Object, max: Object, used: Object, resources: Object}
 * - 401: {auth: false, path: String}
 */
app.get("/api/user/resources", async (req, res) => {
	// check auth
	let auth = await checkAuth(req.cookies, res);
	if (!auth) { return; }
	let resources = await getUserResources(req, req.cookies.username);
	res.status(200).send(resources);
});

/**
 * GET - get db global resource configuration
 * responses:
 * - 200: Object
 */
app.get("/api/global/config/resources", async (req, res) => {
	// check auth
	let auth = await checkAuth(req.cookies, res);
	if (!auth) { return; }
	let config = db.getResourceConfig();
	res.status(200).send(config);
});

/**
 * GET - get db user resource configuration
 * responses:
 * - 200: Object
 * - 401: {auth: false, path: String}
 */
app.get("/api/user/config/resources", async (req, res) => {
	// check auth
	let auth = await checkAuth(req.cookies, res);
	if (!auth) { return; }
	let config = db.getUserConfig(req.cookies.username);
	res.status(200).send(config.resources);
});

/**
 * GET - get db user cluster configuration
 * responses:
 * - 200: {pool: String, templates: {lxc: Object, qemu: Object}, vmid: {min: Number, max: Number}}
 * - 401: {auth: false, path: String}
 */
app.get("/api/user/config/cluster", async (req, res) => {
	// check auth
	let auth = await checkAuth(req.cookies, res);
	if (!auth) { return; }
	let config = db.getUserConfig(req.cookies.username);
	res.status(200).send(config.cluster)
});

/**
 * GET - get db user node configuration
 * responses:
 * - 200: {nodes: String[]}
 * - 401: {auth: false, path: String}
 */
app.get("/api/user/config/nodes", async (req, res) => {
	// check auth
	let auth = await checkAuth(req.cookies, res);
	if (!auth) { return; }
	let config = db.getUserConfig(req.cookies.username);
	res.status(200).send(config.nodes)
})

/**
 * POST - detach mounted disk from instance
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - disk: String - disk id (sata0, NOT unused)
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: PVE Task Object
 */
app.post("/api/instance/disk/detach", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// get current config
	let config = (await requestPVE(`${vmpath}/config`, "GET", req.cookies, null, null)).data.data;
	// disk must exist
	if (!config[req.body.disk]) {
		res.status(500).send({ error: `Disk ${req.body.disk} does not exist.` });
		res.end();
		return;
	}
	// disk cannot be unused
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
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: PVE Task Object
 */
app.post("/api/instance/disk/attach", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// get current config
	let config = (await requestPVE(`${vmpath}/config`, "GET", req.cookies, null, null)).data.data;
	// disk must exist
	if (!config[`unused${req.body.source}`]) {
		res.status(403).send({ error: `Requested disk unused${req.body.source} does not exist.` });
		res.end();
		return;
	}
	// target disk must be allowed according to source disk's storage options
	let diskConfig = await getDiskInfo(req.body.node, req.body.type, req.body.vmid, `unused${req.body.source}`); // get target disk
	let resourceConfig = db.getResourceConfig();
	if (!resourceConfig[diskConfig.storage].disks.some(diskPrefix => req.body.disk.startsWith(diskPrefix))) {
		res.status(500).send({ error: `Requested target ${req.body.disk} is not in allowed list [${resourceConfig[diskConfig.storage].disks}].` });
		res.end();
		return;
	}
	// setup action using source disk info from vm config
	let action = {};
	action[req.body.disk] = config[`unused${req.body.source}`];
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
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: {request: Object, error: String}
 * - 500: PVE Task Object
 */
app.post("/api/instance/disk/resize", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// check disk existence
	let diskConfig = await getDiskInfo(req.body.node, req.body.type, req.body.vmid, req.body.disk); // get target disk
	if (!diskConfig) { // exit if disk does not exist
		res.status(500).send({ error: `requested disk ${req.body.disk} does not exist.` });
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
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: {request: Object, error: String}
 * - 500: PVE Task Object
 */
app.post("/api/instance/disk/move", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// check disk existence
	let diskConfig = await getDiskInfo(req.body.node, req.body.type, req.body.vmid, req.body.disk); // get target disk
	if (!diskConfig) { // exit if disk does not exist
		res.status(500).send({ error: `requested disk ${req.body.disk} does not exist.` });
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
 * DELETE - delete unused disk permanently
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - disk: String - disk id (unused0 or ide0)
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: PVE Task Object
 */
app.delete("/api/instance/disk/delete", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// get current config
	let config = (await requestPVE(`${vmpath}/config`, "GET", req.cookies, null, null)).data.data;
	// disk must exist
	if (!config[req.body.disk]) {
		res.status(403).send({ error: `Requested disk unused${req.body.source} does not exist.` });
		res.end();
		return;
	}
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
 * - size: Number - size of disk in GiB
 * - iso: String - file name to mount as cdrom
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {request: Object, error: String}
 * - 500: PVE Task Object
 */
app.post("/api/instance/disk/create", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// get current config
	let config = (await requestPVE(`${vmpath}/config`, "GET", req.cookies, null, null)).data.data;
	// disk must not exist
	if (config[req.body.disk]) {
		res.status(403).send({ error: `Requested disk ${req.body.disk} already exists.` });
		res.end();
		return;
	}
	// setup request
	let request = {};
	if (!req.body.disk.includes("ide")) {
		// setup request
		request[req.body.storage] = Number(req.body.size * 1024 ** 3);
		// check request approval
		if (!await approveResources(req, req.cookies.username, request)) {
			res.status(500).send({ request: request, error: `Storage ${req.body.storage} could not fulfill request of size ${req.body.size}G.` });
			res.end();
			return;
		}
		// target disk must be allowed according to storage options
		let resourceConfig = db.getResourceConfig();
		if (!resourceConfig[req.body.storage].disks.some(diskPrefix => req.body.disk.startsWith(diskPrefix))) {
			res.status(500).send({ error: `Requested target ${req.body.disk} is not in allowed list [${resourceConfig[req.body.storage].disks}].` });
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
 * POST - create new virtual network interface
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - netid: Number - network interface id number (0 => net0)
 * - rate: Number - new bandwidth rate for interface in MB/s
 * - name: String, optional - required interface name for lxc only
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: {request: Object, error: String}
 * - 500: PVE Task Object
 */
app.post("/api/instance/network/create", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// get current config
	let currentConfig = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, "GET", null, null, pveAPIToken);
	// net interface must not exist
	if (currentConfig.data.data[`net${req.body.netid}`]) {
		res.status(500).send({ error: `Network interface net${req.body.netid} already exists.` });
		res.end();
		return;
	}
	if (req.body.type === "lxc" && !req.body.name) {
		res.status(500).send({ error: `Network interface must have name parameter.` });
		res.end();
		return;
	}
	let request = {
		network: Number(req.body.rate)
	};
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request: request, error: `Could not fulfil network request of ${req.body.rate}MB/s.` });
		res.end();
		return;
	}
	// setup action
	let nc = db.getUserConfig(req.cookies.username).templates.network[req.body.type];
	let action = {};
	if (req.body.type === "lxc") {
		action[`net${req.body.netid}`] = `name=${req.body.name},bridge=${nc.bridge},ip=${nc.ip},ip6=${nc.ip6},tag=${nc.vlan},type=${nc.type},rate=${req.body.rate}`;
	}
	else {
		action[`net${req.body.netid}`] = `${nc.type},bridge=${nc.bridge},tag=${nc.vlan},rate=${req.body.rate}`;
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
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: {request: Object, error: String}
 * - 500: PVE Task Object
 */
app.post("/api/instance/network/modify", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// get current config
	let currentConfig = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, "GET", null, null, pveAPIToken);
	// net interface must already exist
	if (!currentConfig.data.data[`net${req.body.netid}`]) {
		res.status(500).send({ error: `Network interface net${req.body.netid} does not exist.` });
		res.end();
		return;
	}
	let currentNetworkConfig = currentConfig.data.data[`net${req.body.netid}`];
	let currentNetworkRate = currentNetworkConfig.split("rate=")[1].split(",")[0];
	let request = {
		network: Number(req.body.rate) - Number(currentNetworkRate)
	};
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request: request, error: `Could not fulfil network request of ${req.body.rate}MB/s.` });
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
 * DELETE - delete virtual network interface
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - netid: Number - network interface id number (0 => net0)
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: PVE Task Object
 */
app.delete("/api/instance/network/delete", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// get current config
	let currentConfig = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, "GET", null, null, pveAPIToken);
	// net interface must already exist
	if (!currentConfig.data.data[`net${req.body.netid}`]) {
		res.status(500).send({ error: `Network interface net${req.body.netid} does not exist.` });
		res.end();
		return;
	}
	// setup action
	let action = JSON.stringify({ delete: `net${req.body.netid}` });
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	// commit action
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

/**
 * GET - get instance pcie device data
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number to destroy
 * - hostpci: String - hostpci number
 * responses:
 * - 200: PVE PCI Device Object
 * - 401: {auth: false, path: String}
 * - 500: {error: String} 
 */
app.get("/api/instance/pci", async (req, res) => {
	// check auth for specific instance
	let vmpath = `/nodes/${req.query.node}/${req.query.type}/${req.query.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// check device is in instance config
	let config = (await requestPVE(`${vmpath}/config`, "GET", req.cookies)).data.data;
	if (!config[`hostpci${req.query.hostpci}`]) {
		res.status(500).send({ error: `Could not find hostpci${req.query.hostpci} in ${req.query.vmid}.` });
		res.end();
		return;
	}
	let device = config[`hostpci${req.query.hostpci}`].split(",")[0];
	// get node's pci devices
	let deviceData = await getDeviceInfo(req.query.node, req.query.type, req.query.vmid, device);
	if (!deviceData) {
		res.status(500).send({ error: `Could not find hostpci${req.query.hostpci}=${device} in ${req.query.node}.` });
		res.end();
		return;
	}
	res.status(200).send(deviceData);
	res.end();
	return;
});

/**
 * GET - get available pcie devices given node and user
 * request:
 * - node: String - vm host node id
 * responses:
 * - 200: PVE PCI Device Object
 * - 401: {auth: false, path: String}
 * - 500: {error: String} 
 */
app.get("/api/nodes/pci", async (req, res) => {
	// check auth
	let auth = await checkAuth(req.cookies, res);
	if (!auth) { return; }
	// get remaining user resources
	let userAvailPci = (await getUserResources(req, req.cookies.username)).avail.pci;
	// get node avail devices
	let nodeAvailPci = await getNodeAvailDevices(req.query.node, req.cookies);
	nodeAvailPci = nodeAvailPci.filter(nodeAvail => userAvailPci.some((userAvail) => { return nodeAvail.device_name && nodeAvail.device_name.includes(userAvail); }));
	res.status(200).send(nodeAvailPci);
	res.end();
	return;
});

/**
 * POST - modify existing instance pci device
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number to destroy
 * - hostpci: String - hostpci number
 * - device: String - new device id
 * - pcie: Boolean - whether to use pci express or pci
 * response:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {request: Object, error: String}
 * - 500: PVE Task Object
 */
app.post("/api/instance/pci/modify", async (req, res) => {
	// check if type is qemu
	if (req.body.type !== "qemu") {
		res.status(500).send({ error: `Type must be qemu (vm).` });
		res.end();
		return;
	}
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// force all functions
	req.body.device = req.body.device.split(".")[0];
	// get instance config to check if device has not changed
	let config = (await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, "GET", req.body.cookies, null, pveAPIToken)).data.data;
	let currentDeviceData = await getDeviceInfo(req.body.node, req.body.type, req.body.vmid, config[`hostpci${req.body.hostpci}`].split(",")[0]);
	if (!currentDeviceData) {
		res.status(500).send({ error: `No device in hostpci${req.body.hostpci}.` });
		res.end();
		return;
	}
	// only check user and node availability if base id is different
	if (currentDeviceData.id.split(".")[0] !== req.body.device) {
		// setup request
		let deviceData = await getDeviceInfo(req.body.node, req.body.type, req.body.vmid, req.body.device);
		let request = { pci: deviceData.device_name };
		// check resource approval
		if (!await approveResources(req, req.cookies.username, request)) {
			res.status(500).send({ request: request, error: `Could not fulfil request for ${deviceData.device_name}.` });
			res.end();
			return;
		}
		// check node availability
		let nodeAvailPci = await getNodeAvailDevices(req.body.node, req.cookies);
		if (!nodeAvailPci.some(element => element.id.split(".")[0] === req.body.device)) {
			res.status(500).send({ error: `Device ${req.body.device} is already in use on ${req.body.node}.` });
			res.end();
			return;
		}
	}
	// setup action
	let action = {};
	action[`hostpci${req.body.hostpci}`] = `${req.body.device},pcie=${req.body.pcie}`;
	action = JSON.stringify(action);
	// commit action
	let rootauth = await requestPVE("/access/ticket", "POST", null, JSON.stringify(db.getApplicationConfig().pveroot), null);
	if (!(rootauth.status === 200)) {
		res.status(rootauth.status).send({ auth: false, error: "API could not authenticate as root user." });
		res.end();
		return;
	}
	let rootcookies = {
		PVEAuthCookie: rootauth.data.data.ticket,
		CSRFPreventionToken: rootauth.data.data.CSRFPreventionToken
	};
	let result = await requestPVE(`${vmpath}/config`, "POST", rootcookies, action, null);
	await handleResponse(req.body.node, result, res);
});

/**
 * POST - add new instance pci device
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number to destroy
 * - device: String - new device id
 * - pcie: Boolean - whether to use pci express or pci
 * response:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {request: Object, error: String}
 * - 500: PVE Task Object
 */
app.post("/api/instance/pci/create", async (req, res) => {
	// check if type is qemu
	if (req.body.type !== "qemu") {
		res.status(500).send({ error: `Type must be qemu (vm).` });
		res.end();
		return;
	}
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// force all functions
	req.body.device = req.body.device.split(".")[0];
	// get instance config to find next available hostpci slot
	let config = requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, "GET", req.body.cookies, null, null);
	let hostpci = 0;
	while (config[`hostpci${hostpci}`]) {
		hostpci++;
	}
	// setup request
	let deviceData = await getDeviceInfo(req.body.node, req.body.type, req.body.vmid, req.body.device);
	let request = {
		pci: deviceData.device_name
	};
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request: request, error: `Could not fulfil request for ${deviceData.device_name}.` });
		res.end();
		return;
	}
	// check node availability
	let nodeAvailPci = await getNodeAvailDevices(req.body.node, req.cookies);
	if (!nodeAvailPci.some(element => element.id.split(".")[0] === req.body.device)) {
		res.status(500).send({ error: `Device ${req.body.device} is already in use on ${req.body.node}.` });
		res.end();
		return;
	}
	// setup action
	let action = {};
	action[`hostpci${hostpci}`] = `${req.body.device},pcie=${req.body.pcie}`;
	action = JSON.stringify(action);
	// commit action
	let rootauth = await requestPVE("/access/ticket", "POST", null, JSON.stringify(db.getApplicationConfig().pveroot), null);
	if (!(rootauth.status === 200)) {
		res.status(rootauth.status).send({ auth: false, error: "API could not authenticate as root user." });
		res.end();
		return;
	}
	let rootcookies = {
		PVEAuthCookie: rootauth.data.data.ticket,
		CSRFPreventionToken: rootauth.data.data.CSRFPreventionToken
	};
	let result = await requestPVE(`${vmpath}/config`, "POST", rootcookies, action, null);
	await handleResponse(req.body.node, result, res);
});

/**
 * DELETE - delete instance pci device
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number to destroy
 * - hostpci: String - hostpci number
 * response:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {request: Object, error: String}
 * - 500: PVE Task Object
 */
app.delete("/api/instance/pci/delete", async (req, res) => {
	// check if type is qemu
	if (req.body.type !== "qemu") {
		res.status(500).send({ error: `Type must be qemu (vm).` });
		res.end();
		return;
	}
	// check auth for specific instance
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) { return; }
	// check device is in instance config
	let config = (await requestPVE(`${vmpath}/config`, "GET", req.cookies)).data.data;
	if (!config[`hostpci${req.body.hostpci}`]) {
		res.status(500).send({ error: `Could not find hostpci${req.body.hostpci} in ${req.body.vmid}.` });
		res.end();
		return;
	}
	// setup action
	let action = JSON.stringify({ delete: `hostpci${req.body.hostpci}` });
	// commit action, need to use root user here because proxmox api only allows root to modify hostpci for whatever reason
	let rootauth = await requestPVE("/access/ticket", "POST", null, JSON.stringify(db.getApplicationConfig().pveroot), null);
	if (!(rootauth.status === 200)) {
		res.status(response.status).send({ auth: false, error: "API could not authenticate as root user." });
		res.end();
		return;
	}
	let rootcookies = {
		PVEAuthCookie: rootauth.data.data.ticket,
		CSRFPreventionToken: rootauth.data.data.CSRFPreventionToken
	};
	let result = await requestPVE(`${vmpath}/config`, "POST", rootcookies, action, null);
	await handleResponse(req.body.node, result, res);
});

/**
 * POST - set basic resources for vm
 * request:
 * - node: String - vm host node id
 * - type: String - vm type (lxc, qemu)
 * - vmid: Number - vm id number
 * - proctype: String - vm processor type
 * - cores: Number, optional - number of processor cores for instance
 * - memory: Number - amount of memory for instance
 * - swap: Number, optional - new amount of swap for instance
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {request: Object, error: String}
 * - 500: PVE Task Object
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
	else if (req.body.type === "qemu") {
		request.cpu = req.body.proctype;
	}
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request: request, error: `Could not fulfil request.` });
		res.end();
		return;
	}
	// setup action
	let action = { cores: req.body.cores, memory: req.body.memory };
	if (req.body.type === "lxc") {
		action.swap = Number(req.body.swap);
	}
	else if (req.body.type === "qemu") {
		action.cpu = req.body.proctype;
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
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: {error: String}
 * - 500: {request: Object, error: String}
 * - 500: PVE Task Object
 */
app.post("/api/instance", async (req, res) => {
	// check auth
	let auth = await checkAuth(req.cookies, res);
	if (!auth) { return; }
	// get user db config
	let user = await db.getUserConfig(req.cookies.username);
	let vmid = Number.parseInt(req.body.vmid);
	let vmid_min = user.cluster.vmid.min;
	let vmid_max = user.cluster.vmid.max;
	// check vmid is within allowed range
	if (vmid < vmid_min || vmid > vmid_max) {
		res.status(500).send({ error: `Requested vmid ${vmid} is out of allowed range [${vmid_min},${vmid_max}].` });
		res.end();
		return;
	}
	// check node is within allowed list
	if (!user.nodes.includes(req.body.node)) {
		res.status(500).send({ error: `Requested node ${req.body.node} is not in allowed nodes [${user.nodes}].` });
		res.end();
		return;
	}
	// setup request
	let request = {
		cores: Number(req.body.cores),
		memory: Number(req.body.memory)
	};
	if (req.body.type === "lxc") {
		request.swap = req.body.swap;
		request[req.body.rootfslocation] = req.body.rootfssize;
	}
	for (let key of Object.keys(user.templates.instances[req.body.type])) {
		let item = user.templates.instances[req.body.type][key];
		if (item.resource) {
			if (request[item.resource.name]) {
				request[item.resource.name] += item.resource.amount;
			}
			else {
				request[item.resource.name] = item.resource.amount;
			}
		}
	}
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) { // check resource approval
		res.status(500).send({ request: request, error: `Not enough resources to satisfy request.` });
		res.end();
		return;
	}
	// setup action by adding non resource values
	let action = {
		vmid: req.body.vmid,
		cores: Number(req.body.cores),
		memory: Number(req.body.memory),
		pool: user.cluster.pool
	};
	for (let key of Object.keys(user.templates.instances[req.body.type])) {
		action[key] = user.templates.instances[req.body.type][key].value;
	}
	if (req.body.type === "lxc") {
		action.hostname = req.body.name;
		action.unprivileged = 1;
		action.features = "nesting=1";
		action.password = req.body.password;
		action.ostemplate = req.body.ostemplate;
		action.rootfs = `${req.body.rootfslocation}:${req.body.rootfssize}`;
	}
	else {
		action.name = req.body.name;
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
 * - 200: PVE Task Object
 * - 401: {auth: false, path: String}
 * - 500: PVE Task Object
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