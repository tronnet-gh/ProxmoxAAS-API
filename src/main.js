import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import morgan from "morgan";

import { api } from "./package.js";
import { requestPVE, handleResponse, getDiskInfo, getDeviceInfo, getNodeAvailDevices } from "./pve.js";
import { checkAuth, approveResources, getUserResources } from "./utils.js";
import { db, pveAPIToken, listenPort, hostname, domain } from "./db.js";
import { setupClientSync } from "./clientsync.js";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({ origin: hostname }));
app.use(morgan("combined"));

const nodeRegexP = "[\\w-]+";
const typeRegexP = "qemu|lxc";
const vmidRegexP = "\\d+";

/**
 * GET - get API version
 * responses:
 * - 200: {version: string}
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
 * GET - proxy proxmox api without privilege elevation
 * request and responses passed through to/from proxmox
 */
app.get("/api/proxmox/*", async (req, res) => { // proxy endpoint for GET proxmox api with no token
	const path = req.url.replace("/api/proxmox", "");
	const result = await requestPVE(path, "GET", req.cookies);
	res.status(result.status).send(result.data);
});

/**
 * POST - proxy proxmox api without privilege elevation
 * request and responses passed through to/from proxmox
 */
app.post("/api/proxmox/*", async (req, res) => { // proxy endpoint for POST proxmox api with no token
	const path = req.url.replace("/api/proxmox", "");
	const result = await requestPVE(path, "POST", req.cookies, JSON.stringify(req.body)); // need to stringify body because of other issues
	res.status(result.status).send(result.data);
});

/**
 * GET - check authentication
 * responses:
 * - 200: {auth: true}
 * - 401: {auth: false}
 */
app.get("/api/auth", async (req, res) => {
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	res.status(200).send({ auth: true });
});

/**
 * POST - safer ticket generation using proxmox authentication but adding HttpOnly
 * request:
 * - username: string
 * - password: string
 * responses:
 * - 200: {auth: true}
 * - 401: {auth: false}
 */
app.post("/api/auth/ticket", async (req, res) => {
	const response = await requestPVE("/access/ticket", "POST", null, JSON.stringify(req.body));
	if (!(response.status === 200)) {
		res.status(response.status).send({ auth: false });
		res.end();
		return;
	}
	const ticket = response.data.data.ticket;
	const csrftoken = response.data.data.CSRFPreventionToken;
	const username = response.data.data.username;
	const expire = new Date(Date.now() + (2 * 60 * 60 * 1000));
	res.cookie("PVEAuthCookie", ticket, { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("CSRFPreventionToken", csrftoken, { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("username", username, { domain, path: "/", secure: true, expires: expire });
	res.cookie("auth", 1, { domain, path: "/", secure: true, expires: expire });
	res.status(200).send({ auth: true });
});

/**
 * DELETE - request to destroy ticket
 * responses:
 * - 200: {auth: false}
 */
app.delete("/api/auth/ticket", async (req, res) => {
	const expire = new Date(0);
	res.cookie("PVEAuthCookie", "", { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("CSRFPreventionToken", "", { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("username", "", { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("auth", 0, { domain, path: "/", expires: expire });
	res.status(200).send({ auth: false });
});

/**
 * GET - get db global resource configuration
 * responses:
 * - 200: Object
 */
app.get("/api/global/config/:key", async (req, res) => {
	const params = {
		key: req.params.key
	};
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	const allowKeys = ["resources"];
	if (allowKeys.includes(params.key)) {
		const config = db.getGlobalConfig();
		res.status(200).send(config[params.key]);
	}
	else {
		res.status(401).send({ auth: false, error: `User is not authorized to access /global/config/${params.key}.` });
	}
});

/**
 * GET - get db user resource information including allocated, free, and maximum resource values along with resource metadata
 * responses:
 * - 200: {avail: Object, max: Object, used: Object, resources: Object}
 * - 401: {auth: false}
 */
app.get("/api/user/dynamic/resources", async (req, res) => {
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	const resources = await getUserResources(req, req.cookies.username);
	res.status(200).send(resources);
});

/**
 * GET - get db user configuration by key
 * request:
 * - key: string - user config key
 * responses:
 * - 200: Object
 * - 401: {auth: false}
 * - 401: {auth: false, error: string}
 */
app.get("/api/user/config/:key", async (req, res) => {
	const params = {
		key: req.params.key
	};
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	const allowKeys = ["resources", "cluster", "nodes"];
	if (allowKeys.includes(params.key)) {
		const config = db.getUserConfig(req.cookies.username);
		res.status(200).send(config[params.key]);
	}
	else {
		res.status(401).send({ auth: false, error: `User is not authorized to access /user/config/${params.key}.` });
	}
});

/**
 * POST - detach mounted disk from instance
 * request:
 * - node: string - vm host node id
 * -y tpe: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - disk: string - disk id (sata0, NOT unused)
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: PVE Task Object
 */
app.post(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/disk/:disk/detach`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		disk: req.params.disk
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const config = (await requestPVE(`${vmpath}/config`, "GET", req.cookies, null, null)).data.data;
	// disk must exist
	if (!config[params.disk]) {
		res.status(500).send({ error: `Disk ${params.disk} does not exist.` });
		res.end();
		return;
	}
	// disk cannot be unused
	if (params.disk.includes("unused")) {
		res.status(500).send({ error: `Requested disk ${params.disk} cannot be unused. Use /disk/delete to permanently delete unused disks.` });
		res.end();
		return;
	}
	const action = JSON.stringify({ delete: params.disk });
	const method = params.type === "qemu" ? "POST" : "PUT";
	const result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(params.node, result, res);
});

/**
 * POST - attach unused disk image to instance
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - disk: string - disk id (sata0 NOT unused)
 * - source: number - source unused disk number (0 => unused0)
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: PVE Task Object
 */
app.post(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/disk/:disk/attach`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		disk: req.params.disk,
		source: req.body.source
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const config = (await requestPVE(`${vmpath}/config`, "GET", req.cookies, null, null)).data.data;
	// disk must exist
	if (!config[`unused${params.source}`]) {
		res.status(403).send({ error: `Requested disk unused${params.source} does not exist.` });
		res.end();
		return;
	}
	// target disk must be allowed according to source disk's storage options
	const diskConfig = await getDiskInfo(params.node, params.type, params.vmid, `unused${params.source}`); // get target disk
	const resourceConfig = db.getGlobalConfig().resources;
	if (!resourceConfig[diskConfig.storage].disks.some(diskPrefix => params.disk.startsWith(diskPrefix))) {
		res.status(500).send({ error: `Requested target ${params.disk} is not in allowed list [${resourceConfig[diskConfig.storage].disks}].` });
		res.end();
		return;
	}
	// setup action using source disk info from vm config
	let action = {};
	action[params.disk] = config[`unused${params.source}`];
	action = JSON.stringify(action);
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(params.node, result, res);
});

/**
 * POST - increase size of mounted disk
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - disk: string - disk id (sata0 NOT unused)
 * - size: number - increase size in GiB
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
app.post(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/disk/:disk/resize`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		disk: req.params.disk,
		size: req.body.size
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// check disk existence
	const diskConfig = await getDiskInfo(params.node, params.type, params.vmid, params.disk); // get target disk
	if (!diskConfig) { // exit if disk does not exist
		res.status(500).send({ error: `requested disk ${params.disk} does not exist.` });
		res.end();
		return;
	}
	// setup request
	const storage = diskConfig.storage; // get the storage
	const request = {};
	request[storage] = Number(params.size * 1024 ** 3); // setup request object
	// check request approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request, error: `Storage ${storage} could not fulfill request of size ${params.size}G.` });
		res.end();
		return;
	}
	// action approved, commit to action
	const action = JSON.stringify({ disk: params.disk, size: `+${params.size}G` });
	const result = await requestPVE(`${vmpath}/resize`, "PUT", req.cookies, action, pveAPIToken);
	await handleResponse(params.node, result, res);
});

/**
 * POST - move mounted disk from one storage to another
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - disk: string - disk id (sata0 NOT unused)
 * - storage: string - target storage to move disk
 * - delete: number - delete original disk (0, 1)
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
app.post(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/disk/:disk/move`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		disk: req.params.disk,
		storage: req.body.storage,
		delete: req.body.delete
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// check disk existence
	const diskConfig = await getDiskInfo(params.node, params.type, params.vmid, params.disk); // get target disk
	if (!diskConfig) { // exit if disk does not exist
		res.status(500).send({ error: `requested disk ${params.disk} does not exist.` });
		res.end();
		return;
	}
	// setup request
	const size = parseInt(diskConfig.size); // get source disk size
	const dstStorage = params.storage; // get destination storage
	const request = {};
	if (!params.delete) { // if not delete, then request storage, otherwise it is net 0
		request[dstStorage] = Number(size); // always decrease destination storage by size
	}
	// check request approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request, error: `Storage ${params.storage} could not fulfill request of size ${params.size}G.` });
		res.end();
		return;
	}
	// create action
	let action = { storage: params.storage, delete: params.delete };
	if (params.type === "qemu") {
		action.disk = params.disk;
	}
	else {
		action.volume = params.disk;
	}
	action = JSON.stringify(action);
	const route = params.type === "qemu" ? "move_disk" : "move_volume";
	// commit action
	const result = await requestPVE(`${vmpath}/${route}`, "POST", req.cookies, action, pveAPIToken);
	await handleResponse(params.node, result, res);
});

/**
 * DELETE - delete unused disk permanently
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - disk: string - disk id (unused0 or ide0)
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: PVE Task Object
 */
app.delete(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/disk/:disk/delete`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		disk: req.params.disk
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const config = (await requestPVE(`${vmpath}/config`, "GET", req.cookies, null, null)).data.data;
	// disk must exist
	if (!config[params.disk]) {
		res.status(403).send({ error: `Requested disk unused${params.source} does not exist.` });
		res.end();
		return;
	}
	// only ide or unused are allowed to be deleted
	if (!params.disk.includes("unused") && !params.disk.includes("ide")) { // must be ide or unused
		res.status(500).send({ error: `Requested disk ${params.disk} must be unused or ide. Use /disk/detach to detach disks in use.` });
		res.end();
		return;
	}
	// create action
	const action = JSON.stringify({ delete: params.disk });
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(params.node, result, res);
});

/**
 * POST - create a new disk in storage of specified size
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - disk: string - disk id (sata0, ide0, NOT unused)
 * - storage: string - storage to hold disk
 * - size: number - size of disk in GiB
 * - iso: string (optional) - file name to mount as cdrom
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
app.post(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/disk/:disk/create`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		disk: req.params.disk,
		storage: req.body.storage,
		size: req.body.size,
		iso: req.body.iso
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const config = (await requestPVE(`${vmpath}/config`, "GET", req.cookies, null, null)).data.data;
	// disk must not exist
	if (config[params.disk]) {
		res.status(403).send({ error: `Requested disk ${params.disk} already exists.` });
		res.end();
		return;
	}
	// setup request
	const request = {};
	if (!params.disk.includes("ide")) {
		// setup request
		request[params.storage] = Number(params.size * 1024 ** 3);
		// check request approval
		if (!await approveResources(req, req.cookies.username, request)) {
			res.status(500).send({ request, error: `Storage ${params.storage} could not fulfill request of size ${params.size}G.` });
			res.end();
			return;
		}
		// target disk must be allowed according to storage options
		const resourceConfig = db.getGlobalConfig().resources;
		if (!resourceConfig[params.storage].disks.some(diskPrefix => params.disk.startsWith(diskPrefix))) {
			res.status(500).send({ error: `Requested target ${params.disk} is not in allowed list [${resourceConfig[params.storage].disks}].` });
			res.end();
			return;
		}
	}
	// setup action
	let action = {};
	if (params.disk.includes("ide") && params.iso) {
		action[params.disk] = `${params.iso},media=cdrom`;
	}
	else if (params.type === "qemu") { // type is qemu, use sata
		action[params.disk] = `${params.storage}:${params.size}`;
	}
	else { // type is lxc, use mp and add mp and backup values
		action[params.disk] = `${params.storage}:${params.size},mp=/${params.disk}/,backup=1`;
	}
	action = JSON.stringify(action);
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(params.node, result, res);
});

/**
 * POST - create new virtual network interface
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - netid: number - network interface id number (0 => net0)
 * - rate: number - new bandwidth rate for interface in MB/s
 * - name: string, optional - required interface name for lxc only
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
app.post(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/net/:netid/create`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		netid: req.params.netid.replace("net", ""),
		rate: req.body.rate,
		name: req.body.name
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const currentConfig = await requestPVE(`/nodes/${params.node}/${params.type}/${params.vmid}/config`, "GET", null, null, pveAPIToken);
	// net interface must not exist
	if (currentConfig.data.data[`net${params.netid}`]) {
		res.status(500).send({ error: `Network interface net${params.netid} already exists.` });
		res.end();
		return;
	}
	if (params.type === "lxc" && !params.name) {
		res.status(500).send({ error: "Network interface must have name parameter." });
		res.end();
		return;
	}
	const request = {
		network: Number(params.rate)
	};
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request, error: `Could not fulfil network request of ${params.rate}MB/s.` });
		res.end();
		return;
	}
	// setup action
	const nc = db.getUserConfig(req.cookies.username).templates.network[params.type];
	let action = {};
	if (params.type === "lxc") {
		action[`net${params.netid}`] = `name=${params.name},bridge=${nc.bridge},ip=${nc.ip},ip6=${nc.ip6},tag=${nc.vlan},type=${nc.type},rate=${params.rate}`;
	}
	else {
		action[`net${params.netid}`] = `${nc.type},bridge=${nc.bridge},tag=${nc.vlan},rate=${params.rate}`;
	}
	action = JSON.stringify(action);
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(params.node, result, res);
});

/**
 * POST - modify virtual network interface
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - netid: number - network interface id number (0 => net0)
 * - rate: number - new bandwidth rate for interface in MB/s
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
app.post(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/net/:netid/modify`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		netid: req.params.netid.replace("net", ""),
		rate: req.body.rate
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const currentConfig = await requestPVE(`/nodes/${params.node}/${params.type}/${params.vmid}/config`, "GET", null, null, pveAPIToken);
	// net interface must already exist
	if (!currentConfig.data.data[`net${params.netid}`]) {
		res.status(500).send({ error: `Network interface net${params.netid} does not exist.` });
		res.end();
		return;
	}
	const currentNetworkConfig = currentConfig.data.data[`net${params.netid}`];
	const currentNetworkRate = currentNetworkConfig.split("rate=")[1].split(",")[0];
	const request = {
		network: Number(params.rate) - Number(currentNetworkRate)
	};
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request, error: `Could not fulfil network request of ${params.rate}MB/s.` });
		res.end();
		return;
	}
	// setup action
	let action = {};
	action[`net${params.netid}`] = currentNetworkConfig.replace(`rate=${currentNetworkRate}`, `rate=${params.rate}`);
	action = JSON.stringify(action);
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(params.node, result, res);
});

/**
 * DELETE - delete virtual network interface
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - netid: number - network interface id number (0 => net0)
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: PVE Task Object
 */
app.delete(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/net/:netid/delete`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		netid: req.params.netid.replace("net", "")
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const currentConfig = await requestPVE(`/nodes/${params.node}/${params.type}/${params.vmid}/config`, "GET", null, null, pveAPIToken);
	// net interface must already exist
	if (!currentConfig.data.data[`net${params.netid}`]) {
		res.status(500).send({ error: `Network interface net${params.netid} does not exist.` });
		res.end();
		return;
	}
	// setup action
	const action = JSON.stringify({ delete: `net${params.netid}` });
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(params.node, result, res);
});

/**
 * GET - get instance pcie device data
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number to destroy
 * - hostpci: string - hostpci number
 * responses:
 * - 200: PVE PCI Device Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 */
app.get(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/pci/:hostpci`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		hostpci: req.params.hostpci.replace("hostpci", "")
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// check device is in instance config
	const config = (await requestPVE(`${vmpath}/config`, "GET", req.cookies)).data.data;
	if (!config[`hostpci${params.hostpci}`]) {
		res.status(500).send({ error: `Could not find hostpci${params.hostpci} in ${params.vmid}.` });
		res.end();
		return;
	}
	const device = config[`hostpci${params.hostpci}`].split(",")[0];
	// get node's pci devices
	const deviceData = await getDeviceInfo(params.node, params.type, params.vmid, device);
	if (!deviceData) {
		res.status(500).send({ error: `Could not find hostpci${params.hostpci}=${device} in ${params.node}.` });
		res.end();
		return;
	}
	res.status(200).send(deviceData);
	res.end();
});

/**
 * GET - get available pcie devices given node and user
 * request:
 * - node: string - vm host node id
 * responses:
 * - 200: PVE PCI Device Object
 * - 401: {auth: false}
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 */
app.get(`/api/:node(${nodeRegexP})/pci`, async (req, res) => {
	const params = {
		node: req.params.node
	};
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	const userNodes = db.getUserConfig(req.cookies.username).nodes;
	if (!userNodes.includes(params.node)) {
		res.status(401).send({ auth: false, path: params.node });
		res.end();
		return;
	}
	// get remaining user resources
	const userAvailPci = (await getUserResources(req, req.cookies.username)).avail.pci;
	// get node avail devices
	let nodeAvailPci = await getNodeAvailDevices(params.node, req.cookies);
	nodeAvailPci = nodeAvailPci.filter(nodeAvail => userAvailPci.some((userAvail) => {
		return nodeAvail.device_name && nodeAvail.device_name.includes(userAvail);
	}));
	res.status(200).send(nodeAvailPci);
	res.end();
});

/**
 * POST - modify existing instance pci device
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number to destroy
 * - hostpci: string - hostpci number
 * - device: string - new device id
 * - pcie: Boolean - whether to use pci express or pci
 * response:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
app.post(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/pci/:hostpci/modify`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		hostpci: req.params.hostpci.replace("hostpci", ""),
		device: req.body.device,
		pcie: req.body.pcie
	};
	// check if type is qemu
	if (params.type !== "qemu") {
		res.status(500).send({ error: "Type must be qemu (vm)." });
		res.end();
		return;
	}
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// force all functions
	params.device = params.device.split(".")[0];
	// get instance config to check if device has not changed
	const config = (await requestPVE(`/nodes/${params.node}/${params.type}/${params.vmid}/config`, "GET", params.cookies, null, pveAPIToken)).data.data;
	const currentDeviceData = await getDeviceInfo(params.node, params.type, params.vmid, config[`hostpci${params.hostpci}`].split(",")[0]);
	if (!currentDeviceData) {
		res.status(500).send({ error: `No device in hostpci${params.hostpci}.` });
		res.end();
		return;
	}
	// only check user and node availability if base id is different
	if (currentDeviceData.id.split(".")[0] !== params.device) {
		// setup request
		const deviceData = await getDeviceInfo(params.node, params.type, params.vmid, params.device);
		const request = { pci: deviceData.device_name };
		// check resource approval
		if (!await approveResources(req, req.cookies.username, request)) {
			res.status(500).send({ request, error: `Could not fulfil request for ${deviceData.device_name}.` });
			res.end();
			return;
		}
		// check node availability
		const nodeAvailPci = await getNodeAvailDevices(params.node, req.cookies);
		if (!nodeAvailPci.some(element => element.id.split(".")[0] === params.device)) {
			res.status(500).send({ error: `Device ${params.device} is already in use on ${params.node}.` });
			res.end();
			return;
		}
	}
	// setup action
	let action = {};
	action[`hostpci${params.hostpci}`] = `${params.device},pcie=${params.pcie}`;
	action = JSON.stringify(action);
	// commit action
	const rootauth = await requestPVE("/access/ticket", "POST", null, JSON.stringify(db.getGlobalConfig().application.pveroot), null);
	if (!(rootauth.status === 200)) {
		res.status(rootauth.status).send({ auth: false, error: "API could not authenticate as root user." });
		res.end();
		return;
	}
	const rootcookies = {
		PVEAuthCookie: rootauth.data.data.ticket,
		CSRFPreventionToken: rootauth.data.data.CSRFPreventionToken
	};
	const result = await requestPVE(`${vmpath}/config`, "POST", rootcookies, action, null);
	await handleResponse(params.node, result, res);
});

/**
 * POST - add new instance pci device
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number to destroy
 * - device: string - new device id
 * - pcie: Boolean - whether to use pci express or pci
 * response:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
app.post(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/pci/create`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		device: req.body.device,
		pcie: req.body.pcie
	};
	// check if type is qemu
	if (params.type !== "qemu") {
		res.status(500).send({ error: "Type must be qemu (vm)." });
		res.end();
		return;
	}
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// force all functions
	params.device = params.device.split(".")[0];
	// get instance config to find next available hostpci slot
	const config = requestPVE(`/nodes/${params.node}/${params.type}/${params.vmid}/config`, "GET", params.cookies, null, null);
	let hostpci = 0;
	while (config[`hostpci${hostpci}`]) {
		hostpci++;
	}
	// setup request
	const deviceData = await getDeviceInfo(params.node, params.type, params.vmid, params.device);
	const request = {
		pci: deviceData.device_name
	};
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request, error: `Could not fulfil request for ${deviceData.device_name}.` });
		res.end();
		return;
	}
	// check node availability
	const nodeAvailPci = await getNodeAvailDevices(params.node, req.cookies);
	if (!nodeAvailPci.some(element => element.id.split(".")[0] === params.device)) {
		res.status(500).send({ error: `Device ${params.device} is already in use on ${params.node}.` });
		res.end();
		return;
	}
	// setup action
	let action = {};
	action[`hostpci${hostpci}`] = `${params.device},pcie=${params.pcie}`;
	action = JSON.stringify(action);
	// commit action
	const rootauth = await requestPVE("/access/ticket", "POST", null, JSON.stringify(db.getGlobalConfig().application.pveroot), null);
	if (!(rootauth.status === 200)) {
		res.status(rootauth.status).send({ auth: false, error: "API could not authenticate as root user." });
		res.end();
		return;
	}
	const rootcookies = {
		PVEAuthCookie: rootauth.data.data.ticket,
		CSRFPreventionToken: rootauth.data.data.CSRFPreventionToken
	};
	const result = await requestPVE(`${vmpath}/config`, "POST", rootcookies, action, null);
	await handleResponse(params.node, result, res);
});

/**
 * DELETE - delete instance pci device
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number to destroy
 * - hostpci: string - hostpci number
 * response:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
app.delete(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/pci/:hostpci/delete`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		hostpci: req.params.hostpci.replace("hostpci", "")
	};
	// check if type is qemu
	if (params.type !== "qemu") {
		res.status(500).send({ error: "Type must be qemu (vm)." });
		res.end();
		return;
	}
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// check device is in instance config
	const config = (await requestPVE(`${vmpath}/config`, "GET", req.cookies)).data.data;
	if (!config[`hostpci${params.hostpci}`]) {
		res.status(500).send({ error: `Could not find hostpci${params.hostpci} in ${params.vmid}.` });
		res.end();
		return;
	}
	// setup action
	const action = JSON.stringify({ delete: `hostpci${params.hostpci}` });
	// commit action, need to use root user here because proxmox api only allows root to modify hostpci for whatever reason
	const rootauth = await requestPVE("/access/ticket", "POST", null, JSON.stringify(db.getGlobalConfig().application.pveroot), null);
	if (!(rootauth.status === 200)) {
		res.status(rootauth.status).send({ auth: false, error: "API could not authenticate as root user." });
		res.end();
		return;
	}
	const rootcookies = {
		PVEAuthCookie: rootauth.data.data.ticket,
		CSRFPreventionToken: rootauth.data.data.CSRFPreventionToken
	};
	const result = await requestPVE(`${vmpath}/config`, "POST", rootcookies, action, null);
	await handleResponse(params.node, result, res);
});

/**
 * POST - set basic resources for vm
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - proctype: string - vm processor type
 * - cores: number, optional - number of processor cores for instance
 * - memory: number - amount of memory for instance
 * - swap: number, optional - new amount of swap for instance
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
app.post(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/resources`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		proctype: req.body.proctype,
		cores: req.body.cores,
		memory: req.body.memory,
		swap: req.body.swap
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const currentConfig = await requestPVE(`/nodes/${params.node}/${params.type}/${params.vmid}/config`, "GET", null, null, pveAPIToken);
	const request = {
		cores: Number(params.cores) - Number(currentConfig.data.data.cores),
		memory: Number(params.memory) - Number(currentConfig.data.data.memory)
	};
	if (params.type === "lxc") {
		request.swap = Number(params.swap) - Number(currentConfig.data.data.swap);
	}
	else if (params.type === "qemu") {
		request.cpu = params.proctype;
	}
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({ request, error: "Could not fulfil request." });
		res.end();
		return;
	}
	// setup action
	let action = { cores: params.cores, memory: params.memory };
	if (params.type === "lxc") {
		action.swap = Number(params.swap);
	}
	else if (params.type === "qemu") {
		action.cpu = params.proctype;
	}
	action = JSON.stringify(action);
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(params.node, result, res);
});

/**
 * POST - create new instance
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number for instance
 * - hostname: string, optional- hostname for lxc instance
 * - name: string, optional - hostname for qemu instance
 * - cores: number - number of cores for instance
 * - memory: number - amount of memory for instance
 * - swap: number, optional - amount of swap for lxc instance
 * - password: string, optional - password for lxc instance
 * - ostemplate: string, optional - os template name for lxc instance
 * - rootfslocation: string, optional - storage name for lxc instance rootfs
 * - rootfssize: number, optional, - size of lxc instance rootfs
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
app.post(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/create`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		hostname: req.body.hostname,
		name: req.body.name,
		cores: req.body.cores,
		memory: req.body.memory,
		swap: req.body.swap,
		password: req.body.password,
		ostemplate: req.body.ostemplate,
		rootfslocation: req.body.rootfslocation,
		rootfssize: req.body.rootfssize
	};
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	// get user db config
	const user = await db.getUserConfig(req.cookies.username);
	const vmid = Number.parseInt(params.vmid);
	const vmidMin = user.cluster.vmid.min;
	const vmidMax = user.cluster.vmid.max;
	// check vmid is within allowed range
	if (vmid < vmidMin || vmid > vmidMax) {
		res.status(500).send({ error: `Requested vmid ${vmid} is out of allowed range [${vmidMin},${vmidMax}].` });
		res.end();
		return;
	}
	// check node is within allowed list
	if (!user.nodes.includes(params.node)) {
		res.status(500).send({ error: `Requested node ${params.node} is not in allowed nodes [${user.nodes}].` });
		res.end();
		return;
	}
	// setup request
	const request = {
		cores: Number(params.cores),
		memory: Number(params.memory)
	};
	if (params.type === "lxc") {
		request.swap = params.swap;
		request[params.rootfslocation] = params.rootfssize;
	}
	for (const key of Object.keys(user.templates.instances[params.type])) {
		const item = user.templates.instances[params.type][key];
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
		res.status(500).send({ request, error: "Not enough resources to satisfy request." });
		res.end();
		return;
	}
	// setup action by adding non resource values
	let action = {
		vmid: params.vmid,
		cores: Number(params.cores),
		memory: Number(params.memory),
		pool: user.cluster.pool
	};
	for (const key of Object.keys(user.templates.instances[params.type])) {
		action[key] = user.templates.instances[params.type][key].value;
	}
	if (params.type === "lxc") {
		action.hostname = params.name;
		action.unprivileged = 1;
		action.features = "nesting=1";
		action.password = params.password;
		action.ostemplate = params.ostemplate;
		action.rootfs = `${params.rootfslocation}:${params.rootfssize}`;
	}
	else {
		action.name = params.name;
	}
	action = JSON.stringify(action);
	// commit action
	const result = await requestPVE(`/nodes/${params.node}/${params.type}`, "POST", req.cookies, action, pveAPIToken);
	await handleResponse(params.node, result, res);
});

/**
 * DELETE - destroy existing instance
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number to destroy
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: PVE Task Object
 */
app.delete(`/api/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})/delete`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// commit action
	const result = await requestPVE(vmpath, "DELETE", req.cookies, null, pveAPIToken);
	await handleResponse(params.node, result, res);
});

app.get("/api/user/iso", async (req, res) => {
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	// get user iso config
	const userIsoConfig = db.getGlobalConfig().useriso;
	// get all isos
	const isos = (await requestPVE(`/nodes/${userIsoConfig.node}/storage/${userIsoConfig.storage}/content?content=iso`, "GET", null, null, pveAPIToken)).data.data;
	const userIsos = [];
	isos.forEach((iso) => {
		iso.name = iso.volid.replace(`${userIsoConfig.storage}:iso/`, "");
		userIsos.push(iso);
	});
	userIsos.sort();
	res.status(200).send(userIsos);
});

const server = app.listen(listenPort, () => {
	console.log(`proxmoxaas-api v${api.version} listening on port ${listenPort}`);
});

setupClientSync(app, server, db.getGlobalConfig().clientsync);
