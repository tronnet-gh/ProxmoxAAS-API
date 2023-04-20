const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser")
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
var api = require("./package.json");

const {pveAPIToken, listenPort, domain} = require("./vars.js");
const {checkAuth, requestPVE, handleResponse, getUsedResources, getDiskInfo} = require("./pveutils.js");
const {init, getUser, getResources} = require("./db.js");

const app = express();
app.use(helmet());
app.use(bodyParser.urlencoded({extended: true}));
app.use(cookieParser())
app.use(cors({origin: domain}));
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
	path = req.url.replace("/api/proxmox", "");
	let result = await requestPVE(path, "GET", req.cookies);
	res.status(result.status).send(result.data);
});

app.post("/api/proxmox/*", async (req, res) => { // proxy endpoint for POST proxmox api with no token
	path = req.url.replace("/api/proxmox", "");
	let result = await requestPVE(path, "POST", req.cookies, JSON.stringify(req.body)); // need to stringify body because of other issues
	res.status(result.status).send(result.data);
});

async function getUserResources (req, username) {
	let dbResources = getResources();
	let used = await getUsedResources(req, dbResources);
	let max = getUser(username).resources.max;
	avail = {};
	Object.keys(max).forEach((k) => {
		avail[k] = max[k] - used[k];
	});
	return {used: used, max: max, avail: avail, units: dbResources};
}

async function approveResources (request, avail) {
	let approved = true;
	Object.keys(request).forEach((key) => {
		if (!(key in avail)) {
			approved = false;
		}
		else if (avail[key] - request[key] < 0) {
			approved = false;
		}
	});
	return approved;
}

app.get("/api/user/resources", async(req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	let userResources = await getUserResources(req, req.cookies.username);
	res.status(200).send({resources: userResources});
	res.end();
	return;
});

app.post("/api/disk/detach", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	if (req.body.disk.includes("unused")) {
		res.status(500).send({error: `Requested disk ${req.body.disk} cannot be unused. Use /disk/delete to permanently delete unused disks.`});
		return;
	}
	let action = JSON.stringify({delete: req.body.disk});
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.post("/api/disk/attach", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	let action = {};
	action[req.body.disk] = req.body.data;
	action = JSON.stringify(action);
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.post("/api/disk/resize", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	// check disk existence
	let diskConfig = await getDiskInfo(req.body.node, req.body.type, req.body.vmid, req.body.disk); // get target disk
	if (!diskConfig) { // exit if disk does not exist
		res.status(500).send({error: `requested disk ${req.body.disk} does not exist`});
		return;
	}
	// get used resources
	let userResources = await getUserResources(req, req.cookies.username);
	// setup request
	let storage = diskConfig.storage; // get the storage
	let request = {};
	request[storage] = Number(req.body.size * 1024 ** 3); // setup request object
	// check request approval
	if (!await approveResources(request, userResources.avail)) {
		res.status(500).send({request: request, error: `Storage ${storage} could not fulfill request of size ${req.body.size}G.`});
		return;
	}
	// action approved, commit to action
	let action = JSON.stringify({disk: req.body.disk, size: `+${req.body.size}G`});
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/resize`, "PUT", req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.post("/api/disk/move", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	// check disk existence
	let diskConfig = await getDiskInfo(req.body.node, req.body.type, req.body.vmid, req.body.disk); // get target disk
	if (!diskConfig) { // exit if disk does not exist
		res.status(500).send({error: `requested disk ${req.body.disk} does not exist`});
		return;
	}
	// get used resources
	let userResources = await getUserResources(req, req.cookies.username);
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
	if (!await approveResources(request, userResources.avail)) { 
		res.status(500).send({request: request, error: `Storage ${req.body.storage} could not fulfill request of size ${req.body.size}G.`});
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

app.post("/api/disk/delete", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	// only ide or unused are allowed to be deleted
	if (!req.body.disk.includes("unused") && !req.body.disk.includes("ide")) { // must be ide or unused
		res.status(500).send({error: `Requested disk ${req.body.disk} must be unused or ide. Use /disk/detach to detach disks in use.`});
		return;
	}	
	let action = JSON.stringify({delete: req.body.disk});
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	// commit action
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.post("/api/disk/create", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	// get used resources
	let userResources = await getUserResources(req, req.cookies.username);
	// setup request
	let request = {};
	if (!req.body.disk.includes("ide")) {
		request[req.body.storage] = Number(req.body.size * 1024 ** 3); // setup request object
		// check request approval
		if (!await approveResources(request, userResources.avail)) {
			res.status(500).send({request: request, error: `Storage ${req.body.storage} could not fulfill request of size ${req.body.size}G.`});
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
		action[req.body.disk] = `${req.body.storage}:${req.body.size},mp=/mp${req.body.device}/,backup=1`;
	}
	action = JSON.stringify(action);
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	// commit action
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, method, req.cookies, action, pveAPIToken);
	await handleResponse(req.body.node, result, res);
});

app.post("/api/resources", async (req, res) => {
	// check auth
	await checkAuth(req.cookies, res);
	// get used resources
	let userResources = await getUserResources(req, req.cookies.username);
	// get current config
	let currentConfig = await requestPVE(`/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}/config`, "GET", null, null, pveAPIToken);
	let request = {
		cores: Number(req.body.cores) - Number(currentConfig.data.data.cores), 
		memory: Number(req.body.memory) - Number(currentConfig.data.data.memory)
	};
	// check resource approval
	if (!await approveResources(request, userResources.avail)) {
		res.status(500).send({request: request, error: `Could not fulfil request`});
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
	// get used resources
	let userResources = await getUserResources(req, req.cookies.username);
	// setup request
	let request = {
		cores: Number(req.body.cores), 
		memory: Number(req.body.memory)
	};
	// setup action
	let user = getUser(req.cookies.username);
	let vmid = Number.parseInt(req.body.vmid);
	let vmid_min = user.instances.vmid.min;
	let vmid_max = user.instances.vmid.max;
	if (vmid < vmid_min || vmid > vmid_max) {
		res.status(500).send({error: `Requested vmid ${vmid} is out of allowed range [${vmid_min},${vmid_max}]`});
		return;
	}
	let action = {
		vmid: req.body.vmid,
		cores: req.body.cores,
		memory: req.body.memory,
		pool: user.instances.pool
	};
	for (key of Object.keys(user.instances.templates[req.body.type])) {
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
	if (!approveResources(request, userResources.avail)) { // check resource approval
		res.status(500).send({request: request, error: `Not enough resources to satisfy request.`});
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
	init();
	console.log(`proxmoxaas-api v${api.version} listening on port ${listenPort}`);
});