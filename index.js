const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser")
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const axios = require('axios');
var api = require("./package.json");

const {pveAPI, pveAPIToken, listenPort} = require("./vars.js");
const { token } = require("morgan");

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

app.post("/api/disk/detach", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	let auth = await checkAuth(req.cookies, vmpath);
	if (auth) {
		let method = req.body.type === "qemu" ? "POST" : "PUT";
		let result = await requestPVE(`${vmpath}/config`, method, req.cookies, req.body.action, pveAPIToken);
		result = await handleResponse(req.body.node, result);
		res.send({auth: auth, status: result.status, data: result.data.data});
	}
	else {
		res.send({auth: auth});
	}
});

app.post("/api/disk/attach", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	let auth = await checkAuth(req.cookies, vmpath);
	if (auth) {
		let method = req.body.type === "qemu" ? "POST" : "PUT";
		let result = await requestPVE(`${vmpath}/config`, method, req.cookies, req.body.action, pveAPIToken);
		result = await handleResponse(req.body.node, result);
		res.send({auth: auth, status: result.status, data: result.data.data});
	}
	else {
		res.send({auth: auth});
	}
});

app.post("/api/disk/resize", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	let auth = await checkAuth(req.cookies, vmpath);
	if (auth) {
		let method = "PUT";
		let result = await requestPVE(`${vmpath}/resize`, method, req.cookies, req.body.action, pveAPIToken);
		result = await handleResponse(req.body.node, result);
		res.send({auth: auth, status: result.status, data: result.data.data});
	}
	else {
		res.send({auth: auth});
	}
});

app.post("/api/disk/move", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let route = req.body.type === "qemu" ? "move_disk" : "move_volume";

	let auth = await checkAuth(req.cookies, vmpath);
	if (auth) {
		let method = "POST";
		let result = await requestPVE(`${vmpath}/${route}`, method, req.cookies, req.body.action, pveAPIToken);
		result = await handleResponse(req.body.node, result);
		res.send({auth: auth, status: result.status, data: result.data.data});
	}
	else {
		res.send({auth: auth});
	}
});

app.post("/api/disk/delete", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	let auth = await checkAuth(req.cookies, vmpath);
	if (auth) {
		let method = req.body.type === "qemu" ? "POST" : "PUT";
		let result = await requestPVE(`${vmpath}/config`, method, req.cookies, req.body.action, pveAPIToken);
		result = await handleResponse(req.body.node, result);
		res.send({auth: auth, status: result.status, data: result.data.data});
	}
	else {
		res.send({auth: auth});
	}
});

app.post("/api/resources", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	let auth = await checkAuth(req.cookies, vmpath);
	if (auth) {
		let method = req.body.type === "qemu" ? "POST" : "PUT";
		action = JSON.stringify({cores: req.body.cores, memory: req.body.memory});
		let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
		result = await handleResponse(req.body.node, result);
		res.send({auth: auth, status: result.status, data: result.data.data});
	}
	else {
		res.send({auth: auth});
	}
});

async function checkAuth (cookies, vmpath = null) {
	if (vmpath) {
		let result = await requestPVE(`/${vmpath}/config`, "GET", cookies);
		if (result) {
			return result.status === 200;
		}
		else {
			return false;
		}
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
	else {
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
		return error;
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
	console.log(`proxmoxaas-api v${api.version} listening on port ${listenPort}`);
});