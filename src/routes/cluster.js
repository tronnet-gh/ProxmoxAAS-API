import { Router } from "express";
export const router = Router({ mergeParams: true });

const db = global.db;
const requestPVE = global.pve.requestPVE;
const handleResponse = global.pve.handleResponse;
const checkAuth = global.utils.checkAuth;
const approveResources = global.utils.approveResources;
const pveAPIToken = global.db.pveAPIToken;
const getNodeAvailDevices = global.pve.getNodeAvailDevices;
const getUserResources = global.utils.getUserResources;

const nodeRegexP = "[\\w-]+";
const typeRegexP = "qemu|lxc";
const vmidRegexP = "\\d+";

const basePath = `/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})`;

global.utils.recursiveImport(router, basePath, "cluster", import.meta.url);

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
router.get(`/:node(${nodeRegexP})/pci`, async (req, res) => {
	const params = {
		node: req.params.node
	};
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	const userNodes = db.getUser(req.cookies.username).nodes;
	if (!userNodes.includes(params.node)) {
		res.status(401).send({ auth: false, path: params.node });
		res.end();
		return;
	}
	// get remaining user resources
	const userAvailPci = (await getUserResources(req, req.cookies.username)).pci.nodes[params.node];
	// get node avail devices
	let nodeAvailPci = await getNodeAvailDevices(params.node, req.cookies);
	nodeAvailPci = nodeAvailPci.filter(nodeAvail => userAvailPci.some((userAvail) => {
		return nodeAvail.device_name && nodeAvail.device_name.includes(userAvail.match) && userAvail.avail > 0;
	}));
	res.status(200).send(nodeAvailPci);
	res.end();
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
router.post(`${basePath}/resources`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		proctype: req.body.proctype,
		cores: req.body.cores,
		memory: req.body.memory,
		swap: req.body.swap,
		boot: req.body.boot
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const currentConfig = await requestPVE(`/nodes/${params.node}/${params.type}/${params.vmid}/config`, "GET", { token: pveAPIToken });
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
	if (!await approveResources(req, req.cookies.username, request,  params.node)) {
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
		action.boot = `order=${params.boot.toString().replaceAll(",", ";")};`;
	}
	action = JSON.stringify(action);
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await requestPVE(`${vmpath}/config`, method, { token: pveAPIToken }, action);
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
router.post(`${basePath}/create`, async (req, res) => {
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
	const user = await db.getUser(req.cookies.username);
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
	if (!await approveResources(req, req.cookies.username, request,  params.node)) { // check resource approval
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
	const result = await requestPVE(`/nodes/${params.node}/${params.type}`, "POST", { token: pveAPIToken }, action);
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
router.delete(`${basePath}/delete`, async (req, res) => {
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
	const result = await requestPVE(vmpath, "DELETE", { token: pveAPIToken });
	await handleResponse(params.node, result, res);
});
