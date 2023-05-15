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
app.use(bodyParser.urlencoded({extended: true}));
app.use(cookieParser())
app.use(cors({origin: hostname}));
app.use(morgan("combined"));

app.get("/api/version", (req, res) => {
	res.status(200).send({version: api.version});
});

app.get("/api/echo", (req, res) => {
	res.status(200).send({body: req.body, cookies: req.cookies});
});

app.get("/api/auth", async (req, res) => {
	await checkAuth(req.cookies);
	res.status(200).send({auth: true});
});

app.get("/api/proxmox/*", async (req, res) => { // proxy endpoint for GET proxmox api with no token
	let path = req.url.replace("/api/proxmox", "");
	let result = await requestPVE(path, "GET", req.cookies);
	res.status(result.status).send(result.data);
});

app.post("/api/proxmox/*", async (req, res) => { // proxy endpoint for POST proxmox api with no token
	let path = req.url.replace("/api/proxmox", "");
	let result = await requestPVE(path, "POST", req.cookies, JSON.stringify(req.body)); // need to stringify body because of other issues
	res.status(result.status).send(result.data);
});

app.post("/api/ticket", async (req, res) => {
	let response = await requestPVE("/access/ticket", "POST", null, JSON.stringify(req.body));
	if (!response.ok) {
		res.status(response.status).send({auth: false});
		res.end();
		return;
	}
	let ticket = response.data.data.ticket;
	let csrftoken = response.data.data.CSRFPreventionToken;
	let username = response.data.data.username;
	let expire = new Date(Date.now() + (2*60*60*1000));
	res.cookie("PVEAuthCookie", ticket, {domain: domain, path: "/", httpOnly: true, secure: true, expires: expire});
	res.cookie("CSRFPreventionToken", csrftoken, {domain: domain, path: "/", httpOnly: true, secure: true, expires: expire});
	res.cookie("username", username, {domain: domain, path: "/", secure: true, expires: expire});
	res.cookie("auth", 1, {domain: domain, path: "/", secure: true, expires: expire});
	res.status(200).send({auth: true});
});

app.delete("/api/ticket", async (req, res) => {
	let expire = new Date(0);
	res.cookie("PVEAuthCookie", "", {domain: domain, path: "/", httpOnly: true, secure: true, expires: expire});
	res.cookie("CSRFPreventionToken", "", {domain: domain, path: "/", httpOnly: true, secure: true, expires: expire});
	res.cookie("username", "", {domain: domain, path: "/", httpOnly: true, secure: true, expires: expire});
	res.cookie("auth", 0, {domain: domain, path: "/", expires: expire});
	res.status(200).send({auth: false});
});


app.get("/api/user/resources", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	let resources = await getAllocatedResources(req, req.cookies.username);
	res.status(200).send(resources);
});

app.get("/api/user/instances", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	let config = getUserConfig(req.cookies.username);
	res.status(200).send(config.instances)
});

app.get("/api/user/nodes", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	let config = getUserConfig(req.cookies.username);
	res.status(200).send(config.nodes)
})

app.post("/api/instance/disk/detach", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	if (req.body.disk.includes("unused")) {
		res.status(500).send({error: `Requested disk ${req.body.disk} cannot be unused. Use /disk/delete to permanently delete unused disks.`});
		res.end();
		return;
	}
	let action = JSON.stringify({delete: req.body.disk});
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.post("/api/instance/disk/attach", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	let action = {};
	action[req.body.disk] = req.body.data;
	action = JSON.stringify(action);
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.post("/api/instance/disk/resize", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	// check disk existence
	let diskConfig = await getDiskInfo(req.body.node, req.body.type, req.body.vmid, req.body.disk); // get target disk
	if (!diskConfig) { // exit if disk does not exist
		res.status(500).send({error: `requested disk ${req.body.disk} does not exist`});
		res.end();
		return;
	}
	// setup request
	let storage = diskConfig.storage; // get the storage
	let request = {};
	request[storage] = Number(req.body.size * 1024 ** 3); // setup request object
	// check request approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({request: request, error: `Storage ${storage} could not fulfill request of size ${req.body.size}G.`});
		res.end();
		return;
	}
	// action approved, commit to action
	let action = JSON.stringify({disk: req.body.disk, size: `+${req.body.size}G`});
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/resize`, "PUT", req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.post("/api/instance/disk/move", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	// check disk existence
	let diskConfig = await getDiskInfo(req.body.node, req.body.type, req.body.vmid, req.body.disk); // get target disk
	if (!diskConfig) { // exit if disk does not exist
		res.status(500).send({error: `requested disk ${req.body.disk} does not exist`});
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
		res.status(500).send({request: request, error: `Storage ${req.body.storage} could not fulfill request of size ${req.body.size}G.`});
		res.end();
		return;
	}

	let action = {storage: req.body.storage, delete: req.body.delete};
	if (req.body.type === "qemu") {
		action.disk = req.body.disk
	}
	else {
		action.volume = req.body.disk
	}
	action = JSON.stringify(action);
	let route = req.body.type === "qemu" ? "move_disk" : "move_volume";
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/${route}`, "POST", req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.post("/api/instance/disk/delete", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	// only ide or unused are allowed to be deleted
	if (!req.body.disk.includes("unused") && !req.body.disk.includes("ide")) { // must be ide or unused
		res.status(500).send({error: `Requested disk ${req.body.disk} must be unused or ide. Use /disk/detach to detach disks in use.`});
		res.end();
		return;
	}	
	let action = JSON.stringify({delete: req.body.disk});
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	// commit action
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.post("/api/instance/disk/create", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	// setup request
	let request = {};
	if (!req.body.disk.includes("ide")) {
		request[req.body.storage] = Number(req.body.size * 1024 ** 3); // setup request object
		// check request approval
		if (!await approveResources(req, req.cookies.username, request)) {
			res.status(500).send({request: request, error: `Storage ${req.body.storage} could not fulfill request of size ${req.body.size}G.`});
			res.end();
			return;
		}
	}
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
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.post("/api/instance/resources", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	// get current config
	let currentConfig = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, "GET", null, null, pveAPIToken);
	let request = {
		cores: Number(req.body.cores) - Number(currentConfig.data.data.cores), 
		memory: Number(req.body.memory) - Number(currentConfig.data.data.memory)
	};
	// check resource approval
	if (!await approveResources(req, req.cookies.username, request)) {
		res.status(500).send({request: request, error: `Could not fulfil request`});
		res.end();
		return;
	}
	// commit action
	let action = JSON.stringify({cores: req.body.cores, memory: req.body.memory});
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.post("/api/instance", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
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
	if (vmid < vmid_min || vmid > vmid_max) {
		res.status(500).send({error: `Requested vmid ${vmid} is out of allowed range [${vmid_min},${vmid_max}]`});
		res.end();
		return;
	}
	if (!user.nodes.includes(req.body.node)) {
		res.status(500).send({error: `Requested node ${req.body.node} is not in allowed nodes [${user.nodes}]`});
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
		res.status(500).send({request: request, error: `Not enough resources to satisfy request.`});
		res.end();
		return;
	}
	// commit action
	action = JSON.stringify(action);
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}`, "POST", req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.delete("/api/instance", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	// commit action
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`, "DELETE", req.cookies, null, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.listen(listenPort, () => {
	console.log(`proxmoxaas-api v${api.version} listening on port ${listenPort}`);
});