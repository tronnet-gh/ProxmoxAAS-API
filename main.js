const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser")
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const axios = require('axios');
var api = require("./package.json");

const {pveAPI, pveAPIToken, listenPort} = require("./vars.js");
const {init, requestResources, releaseResources} = require("./db.js");

const app = express();
app.use(helmet());
app.use(bodyParser.urlencoded({extended: true}));
app.use(cookieParser())
app.use(cors());
app.use(morgan("combined"));


app.get("/api/version", (req, res) => {
	res.send({version: api.version});
});

app.get("/api/echo", (req, res) => {
	res.send({body: req.body, cookies: req.cookies});
});

app.get("/api/auth", async (req, res) => {
	let result = await checkAuth(req.cookies);
	res.send({auth: result});
});

app.get("/api/proxmox/*", async (req, res) => { // proxy endpoint for GET proxmox api with no token
	path = req.url.replace("/api/proxmox", "");
	let result = await requestPVE(path, "GET", req.cookies);
	res.send(result.data, result.status);
});

app.post("/api/proxmox/*", async (req, res) => { // proxy endpoint for POST proxmox api with no token
	path = req.url.replace("/api/proxmox", "");
	let result = await requestPVE(path, "POST", req.cookies, JSON.stringify(req.body)); // need to stringify body because of other issues
	res.send(result.data, result.status);
});

app.post("/api/disk/detach", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.send({auth: auth});
		return;
	}

	let action = JSON.stringify({delete: req.body.disk});

	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);
	res.send({auth: auth, status: result.status, data: result.data});
});

app.post("/api/disk/attach", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.send({auth: auth});
		return;
	}

	let action = {};
	action[req.body.disk] = req.body.data;
	action = JSON.stringify(action);

	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);
	res.send({auth: auth, status: result.status, data: result.data});
});

app.post("/api/disk/resize", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.send({auth: auth});
		return;
	}

	let action = JSON.stringify({disk: req.body.disk, size: `+${req.body.size}G`});

	let result = await requestPVE(`${vmpath}/resize`, "PUT", req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);
	res.send({auth: auth, status: result.status, data: result.data});
});

app.post("/api/disk/move", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let route = req.body.type === "qemu" ? "move_disk" : "move_volume";

	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.send({auth: auth});
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

	let result = await requestPVE(`${vmpath}/${route}`, "POST", req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);
	res.send({auth: auth, status: result.status, data: result.data});
});

app.post("/api/disk/delete", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.send({auth: auth});
		return;
	}

	let action = JSON.stringify({delete: req.body.disk});

	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);
	res.send({auth: auth, status: result.status, data: result.data});
});

app.post("/api/disk/create", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.send({auth: auth});
		return;
	}

	let action = {};
	if (req.body.disk.includes("ide") && req.body.iso) {
		action[req.body.disk] = `${req.body.iso},media=cdrom`;
	}
	else if (req.body.type === "qemu") { // type is qemu, use sata
		action[req.body.disk] = `${req.body.storage}:${req.body.size}`;
	}
	else { // type is lxc, use mp and add mp and backup values
		action[req.body.disk] = `${req.body.storage}:${req.body.size},mp=/mp${req.body.device}/,backup=1`;
	}
	action = JSON.stringify(action);

	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);
	res.send({auth: auth, status: result.status, data: result.data});
});

app.post("/api/resources", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.send({auth: auth});
		return;
	}

	let method = req.body.type === "qemu" ? "POST" : "PUT";
	action = JSON.stringify({cores: req.body.cores, memory: req.body.memory});
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);
	res.send({auth: auth, status: result.status, data: result.data});
});

app.post("/api/instance", async (req, res) => {
	let auth = await checkAuth(req.cookies);
	if (!auth) {
		res.send({auth: auth});
		return;
	}

	let action = {
		vmid: req.body.vmid,
		cores: req.body.cores,
		memory: req.body.memory,
		pool: req.cookies.username.replace("@ldap", "")
	};
	if (req.body.type === "lxc") {
		action.swap = req.body.swap;
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

	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}`, "POST", req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);
	res.send({auth: auth, status: result.status, data: result.data});
});

app.delete("/api/instance", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.send({auth: auth});
		return;
	}

	let result = await requestPVE(`${vmpath}`, "DELETE", req.cookies, null, pveAPIToken);
	result = await handleResponse(req.body.node, result);
	res.send({auth: auth, status: result.status, data: result.data});
});

async function checkAuth (cookies, vmpath = null) {
	if (vmpath) {
		let result = await requestPVE(`/${vmpath}/config`, "GET", cookies);
		return result.status === 200;
	}
	else { // if no path is specified, then do a simple authentication
		let result = await requestPVE("/version", "GET", cookies);
		return result.status === 200;
	}
}

async function requestPVE (path, method, cookies, body = null, token = null) {
	let url = `${pveAPI}${path}`;
	let content = {
		method: method,
		mode: "cors",
		credentials: "include",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		},
	}

	if (token) {
		content.headers.Authorization = `PVEAPIToken=${token.user}@${token.realm}!${token.id}=${token.uuid}`;
	}
	else if (cookies) {
		content.headers.CSRFPreventionToken = cookies.CSRFPreventionToken;
		content.headers.Cookie = `PVEAuthCookie=${cookies.PVEAuthCookie}; CSRFPreventionToken=${cookies.CSRFPreventionToken}`;
	}

	if (body) {
		content.data = JSON.parse(body);
	}

	try {
		let response = await axios.request(url, content);
		return response;
	}
	catch (error) {
		return error.response;
	}
}

async function handleResponse (node, response) {
	const waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
	if (response.data.data) {
		let upid = response.data.data;
		while (true) {
			let taskStatus = await requestPVE(`/nodes/${node}/tasks/${upid}/status`, "GET", null, null, pveAPIToken);
			if (taskStatus.data.data.status === "stopped" && taskStatus.data.data.exitStatus === "OK") {
				return taskStatus;
			}
			else if (taskStatus.data.data.status === "stopped") {
				return taskStatus;
			}
			else {
				await waitFor(1000);
			}
		}
	}
	else {
		return response;
	}
}

app.listen(listenPort, () => {
	init();
	console.log(`proxmoxaas-api v${api.version} listening on port ${listenPort}`);
});