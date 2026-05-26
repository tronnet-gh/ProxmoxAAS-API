import { Router } from "express";
export const router = Router({ mergeParams: true });

const nodeRegexP = "[\\w-]+";
const typeRegexP = "qemu|lxc";
const vmidRegexP = "\\d+";

const basePath = `/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})`;

global.utils.recursiveImportRoutes(router, basePath, "cluster", import.meta.url);

/**
 * GET - get all available cluster nodes
 * uses existing user permissions without elevation
 * returns only node IDs
 * responses:
 * - 200: List of nodes
 * - PVE error
 */
router.get("/nodes", async (req, res) => {
	// check auth
	const auth = await global.utils.checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	// get all nodes
	const allNodes = await global.pve.requestPVE("/nodes", "GET", { cookies: req.cookies });
	if (allNodes.status === 200) {
		const allNodesIDs = Array.from(allNodes.data, (x) => x.node);
		res.status(allNodes.status).send({ nodes: allNodesIDs });
		res.end();
	}
	else {
		res.status(allNodes.status).send({ error: allNodes.statusText });
		res.end();
	}
});

/**
 * GET - get basic resources for vm using the fabric format
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * response:
 * - 200: Fabric instance config
 * - 401: {auth: false}
 */
router.get(`${basePath}`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid
	};

	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await global.utils.checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}

	// get current config
	const instance = await global.pve.getInstance(params.node, params.vmid);
	res.status(200).send(instance);
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
 * - 400: {request; Object, error: string, reason: Object}
 * - 401: {auth: false, path: string}
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
	const auth = await global.utils.checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const instance = await global.pve.getInstance(params.node, params.vmid);
	const request = {
		cores: Number(params.cores) - Number(instance.cores),
		memory: Number(params.memory) - Number(instance.memory)
	};
	if (params.type === "lxc") {
		request.swap = Number(params.swap) - Number(instance.swap);
	}
	else if (params.type === "qemu") {
		request.cpu = params.proctype;
	}

	// check resource approval
	const userObj = global.utils.getUserObjFromUsername(req.cookies.username);
	const { approved, reason } = await global.utils.approveResources(req, userObj, params.node, instance.pool, request);
	if (!approved) {
		res.status(400).send({ request, error: "Not enough resources to satisfy request.", reason });
		res.end();
		return;
	}

	// setup action
	const action = { cores: params.cores, memory: params.memory };
	if (params.type === "lxc") {
		action.swap = Number(params.swap);
	}
	else if (params.type === "qemu") {
		action.cpu = params.proctype;
		action.boot = `order=${params.boot.toString().replaceAll(",", ";")};`;
	}
	const method = params.type === "qemu" ? "POST" : "PUT";

	// commit action
	const result = await global.pve.requestPVE(`${vmpath}/config`, method, { token: true }, action);
	await global.pve.handleResponse(params.node, result, res);
	await global.pve.syncInstance(params.node, params.vmid);
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
 * - 400: {request: Object, error: string, reason: Object}
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: PVE Task Object
 */
router.post(`${basePath}/create`, async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		hostname: req.body.hostname,
		name: req.body.name,
		pool: req.body.pool,
		cores: req.body.cores,
		memory: req.body.memory,
		swap: req.body.swap,
		password: req.body.password,
		ostemplate: req.body.ostemplate,
		rootfslocation: req.body.rootfslocation,
		rootfssize: req.body.rootfssize
	};

	// check auth
	const auth = await global.utils.checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	// get pool config
	const pool = (await global.access.getPool(params.pool, req.cookies)).pool;
	const vmid = Number.parseInt(params.vmid);
	const vmidMin = pool["vmid-allowed"].min;
	const vmidMax = pool["vmid-allowed"].max;

	// check vmid is within allowed range
	if (vmid < vmidMin || vmid > vmidMax) {
		res.status(500).send({ error: `Requested vmid ${vmid} is out of allowed range [${vmidMin},${vmidMax}].` });
		res.end();
		return;
	}

	// check node is within allowed list
	if (pool["nodes-allowed"][params.node] !== true) {
		res.status(500).send({ error: `Requested node ${params.node} is not in allowed nodes [${pool["nodes-allowed"]}].` });
		res.end();
		return;
	}

	// check if user is in pool
	const userObj = global.utils.getUserObjFromUsername(req.cookies.username);
	if(global.utils.checkUserInPool(pool, userObj) !== true) {
		res.status(500).send({ error: `Requested pool ${params.pool} does not contain user ${req.cookies.username}]` });
		res.end();
		return;
	}

	// setup request
	const request = {
		cores: Number(params.cores),
		memory: Number(params.memory) * 1024 ** 2
	};
	if (params.type === "lxc") {
		request.swap = Number(params.swap) * 1024 ** 2;
		request[params.rootfslocation] = params.rootfssize * 1024 ** 3;
	}
	for (const key of Object.keys(pool.templates.instances[params.type])) {
		const item = pool.templates.instances[params.type][key];
		if (item.resource.enabled) {
			if (request[item.resource.name]) {
				request[item.resource.name] += item.resource.amount;
			}
			else {
				request[item.resource.name] = item.resource.amount;
			}
		}
	}

	// check resource approval
	const { approved, reason } = await await global.utils.approveResources(req, userObj, params.node, params.pool, request);
	if (!approved) {
		res.status(400).send({ request, error: "Not enough resources to satisfy request.", reason });
		res.end();
		return;
	}

	// setup action by adding non resource values
	const action = {
		vmid: params.vmid,
		cores: Number(params.cores),
		memory: Number(params.memory),
		pool: params.pool
	};
	for (const key of Object.keys(pool.templates.instances[params.type])) {
		action[key] = pool.templates.instances[params.type][key].value;
	}
	if (params.type === "lxc") {
		action.swap = params.swap;
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

	// commit action
	const result = await global.pve.requestPVE(`/nodes/${params.node}/${params.type}`, "POST", { token: true }, action);
	await global.pve.handleResponse(params.node, result, res);
	await global.pve.syncNode(params.node);
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
	const auth = await global.utils.checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}

	// commit action
	const result = await global.pve.requestPVE(vmpath, "DELETE", { token: true });
	await global.pve.handleResponse(params.node, result, res);
	await global.pve.syncNode(params.node);
});
