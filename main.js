const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser")
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
var api = require("./package.json");

const {pveAPIToken, listenPort, domain} = require("./vars.js");
const {checkAuth, requestPVE, handleResponse, getUnusedDiskData, getDiskConfig} = require("./pveutils.js");
const {init, requestResources, allocateResources, releaseResources} = require("./db.js");

const app = express();
app.use(helmet());
app.use(bodyParser.urlencoded({extended: true}));
app.use(cookieParser())
app.use(cors({origin: domain}));
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

	// check auth
	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.status(401).send({auth: auth});
		return;
	}

	if (req.body.disk.includes("unused")) {
		res.status(500).send({auth: auth, data:{error: `Requested disk ${req.body.disk} cannot be unused. Use /disk/delete to permanently delete unused disks.`}});
		return;
	}

	let action = JSON.stringify({delete: req.body.disk});
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);
	res.status(result.status).send({auth: auth, data: result.data});
});

app.post("/api/disk/attach", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	// check auth
	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.status(401).send({auth: auth});
		return;
	}

	let action = {};
	action[req.body.disk] = req.body.data;
	action = JSON.stringify(action);
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);
	res.status(result.status).send({auth: auth, data: result.data});
});

app.post("/api/disk/resize", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	// check auth
	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.status(401).send({auth: auth});
		return;
	}

	// check resource allocation
	let diskConfig = await getDiskConfig(req.body.node, req.body.type, req.body.vmid, req.body.disk); // get target disk
	if (!diskConfig) { // exit if disk does not exist
		res.status(500).send({auth: auth, data:{error: `requested disk ${req.body.disk} does not exist`}});
		return;
	}	
	let storage = diskConfig.split(":")[0]; // get the storage
	let request = {};
	request[storage] = Number(req.body.size); // setup request object
	if (!requestResources(req.cookies.username, request)) { // check request approval
		res.status(500).send({auth: auth, data:{request: request, error: `Storage ${storage} could not fulfill request of size ${req.body.size}G.`}});
		return;
	}

	let action = JSON.stringify({disk: req.body.disk, size: `+${req.body.size}G`});
	let result = await requestPVE(`${vmpath}/resize`, "PUT", req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);

	// update resources
	if (result.status === 200) {
		allocateResources(req.cookies.username, request);
	}

	res.status(result.status).send({auth: auth, data: result.data, allocated: request});
});

app.post("/api/disk/move", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	let route = req.body.type === "qemu" ? "move_disk" : "move_volume";

	// check auth
	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.status(401).send({auth: auth});
		return;
	}

	// check resource allocation
	let diskConfig = await getDiskConfig(req.body.node, req.body.type, req.body.vmid, req.body.disk); // get source disk
	if (!diskConfig) { // exit if source disk does not exist
		res.status(500).send({auth: auth, data:{error: `Requested disk ${req.body.disk} does not exist`}});
	}
	let size = parseInt(diskConfig.split("size=")[1].split("G")[0]); // get source disk size
	let srcStorage = diskConfig.split(":")[0]; // get source storage
	let dstStorage = req.body.storage; // get destination storage
	let request = {};
	let release = {};
	if (req.body.delete) { // if delete is true, increase resource used by the source storage
		release[srcStorage] = Number(size);
	}
	request[dstStorage] = Number(size); // always decrease destination storage by size
	if (!requestResources(req.cookies.username, request)) { // check resource approval
		res.status(500).send({auth: auth, data:{request: request, release: release, error: `Storage ${dstStorage} could not fulfill request of size ${size}G.`}});
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

	// update resources
	if (result.status === 200) {
		allocateResources(req.cookies.username, request);
		releaseResources(req.cookies.username, release);
	}

	res.status(result.status).send({auth: auth, data: result.data, allocated: request, deallocated: release});
});

app.post("/api/disk/delete", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	// check auth
	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.status(401).send({auth: auth});
		return;
	}

	if (!req.body.disk.includes("unused") && !req.body.disk.includes("ide")) { // must be ide or unused
		res.status(500).send({auth: auth, data:{error: `Requested disk ${req.body.disk} must be unused or ide. Use /disk/detach to detach disks in use.`}});
		return;
	}

	// setup release
	let release = {};
	if (!req.body.disk.includes("ide")) { // if disk type is ide, then dont bother checking for resources
		let diskConfig = await getUnusedDiskData(req.body.node, req.body.type, req.body.vmid, req.body.disk); // get disk config of unused disk
		let storage = diskConfig.storage; // get disk storage
		let size = diskConfig.size / (1024**3); // get disk size
		release[storage] = Number(size);
	}

	let action = JSON.stringify({delete: req.body.disk});
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);

	// update resources
	if (result.status === 200) {
		releaseResources(req.cookies.username, release);
	}

	res.status(result.status).send({auth: auth, data: result.data, deallocated: release});
});

app.post("/api/disk/create", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	// check auth
	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.status(401).send({auth: auth});
		return;
	}

	// check resource allocation
	let request = {};
	if (!req.body.disk.includes("ide")) {
		request[req.body.storage] = Number(req.body.siz); // setup request object
		if (!requestResources(req.cookies.username, request)) { // check request approval
			res.status(500).send({auth: auth, data:{request: request, error: `Storage ${storage} could not fulfill request of size ${req.body.size}G.`}});
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
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);

	// update resources
	if (result.status === 200) {
		allocateResources(req.cookies.username, request);
	}

	res.status(result.status).send({auth: auth, data: result.data, allocated: request});
});

app.post("/api/resources", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	// check auth
	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.status(401).send({auth: auth});
		return;
	}

	let currentConfig = await requestPVE(`${vmpath}/config`, "GET", null, null, pveAPIToken);
	let request = {
		cores: Number(req.body.cores) - Number(currentConfig.data.data.cores), 
		memory: Number(req.body.memory) - Number(currentConfig.data.data.memory)
	};
	if (!requestResources(req.cookies.username, request)) { // check resource approval
		res.status(500).send({auth: auth, data:{request: request, error: `Not enough resources to satisfy request.`}});
		return;
	}

	let action = JSON.stringify({cores: req.body.cores, memory: req.body.memory});
	let method = req.body.type === "qemu" ? "POST" : "PUT";
	let result = await requestPVE(`${vmpath}/config`, method, req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);

	// update resources
	if (result.status === 200) {
		allocateResources(req.cookies.username, request);
	}

	res.status(result.status).send({auth: auth, data: result.data, allocated: request});
});

app.post("/api/instance", async (req, res) => {
	// check auth
	let auth = await checkAuth(req.cookies);
	if (!auth) {
		res.status(401).send({auth: auth});
		return;
	}

	// setup request
	let request = {
		cores: Number(req.body.cores), 
		memory: Number(req.body.memory)
	};

	// setup action
	let user = await requestPVE(`/access/users/${req.cookies.username}`, "GET", null, null, pveAPIToken);
	let group = user.data.data.groups[0];
	if (!group) {
		res.status(500).send({auth: auth, data: {error: `user ${req.cookies.username} has no group membership`}});
	}
	let action = {
		vmid: req.body.vmid,
		cores: req.body.cores,
		memory: req.body.memory,
		pool: group
	};
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
	if (!requestResources(req.cookies.username, request)) { // check resource approval
		res.status(500).send({auth: auth, data:{request: request, error: `Not enough resources to satisfy request.`}});
		return;
	}

	action = JSON.stringify(action);
	let result = await requestPVE(`/nodes/${req.body.node}/${req.body.type}`, "POST", req.cookies, action, pveAPIToken);
	result = await handleResponse(req.body.node, result);

	//update resources
	if (result.status === 200) {
		allocateResources(req.cookies.username, request);
	}

	res.status(result.status).send({auth: auth, data: result.data, allocated: request});
});

app.delete("/api/instance", async (req, res) => {
	let vmpath = `/nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;

	//check auth
	let auth = await checkAuth(req.cookies, vmpath);
	if (!auth) {
		res.status(401).send({auth: auth});
		return;
	}

	// setup release TODO: add disk data here
	let currentConfig = await requestPVE(`${vmpath}/config`, "GET", null, null, pveAPIToken);
	let release = {cores: currentConfig.data.data.cores, memory: currentConfig.data.data.memory};
	let keys = Object.keys(currentConfig.data.data);
	for (let i = 0; i < keys.length; i++) {
		let element = keys[i];
		if (element.includes("sata") || element.includes("mp") || element.includes("rootfs")) { // if the disk is mounted, get its storage and size 
			let diskConfig = await getDiskConfig(req.body.node, req.body.type, req.body.vmid, element);
			let storage = diskConfig.split(":")[0];
			let size = parseInt(diskConfig.split("size=")[1].split("G")[0]);
			if (!release[storage]) { // if this is the first time storage has been seen, set storage to size
				release[storage] = size;
			}
			else { // otherwise incrment storage by size
				release[storage] += size;
			}
		}
		else if (element.includes("unused")) {
			let diskConfig = await getUnusedDiskData(req.body.node, req.body.type, req.body.vmid, element); // get disk config of unused disk
			let storage = diskConfig.storage; // get disk storage
			let size = diskConfig.size / (1024**3); // get disk size
			if (!release[storage]) { // if this is the first time storage has been seen, set storage to size
				release[storage] = size;
			}
			else { // otherwise incrment storage by size
				release[storage] += size;
			}
		}
	}

	let result = await requestPVE(`${vmpath}`, "DELETE", req.cookies, null, pveAPIToken);
	result = await handleResponse(req.body.node, result);

	//update resources
	if (result.status === 200) {
		releaseResources(req.cookies.username, release);
	}

	res.status(result.status).send({auth: auth, data: result.data, deallocated: release});
});

app.listen(listenPort, () => {
	init();
	console.log(`proxmoxaas-api v${api.version} listening on port ${listenPort}`);
});