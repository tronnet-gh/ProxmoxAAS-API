import { Router } from "express";
export const router = Router({ mergeParams: true });

const checkAuth = global.utils.checkAuth;
const approveResources = global.utils.approveResources;

/**
 * POST - detach mounted disk from instance
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - disk: string - disk id (sata0, NOT unused)
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: PVE Task Object
 */
router.post("/:disk/detach", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
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
	const config = (await global.pve.requestPVE(`${vmpath}/config`, "GET", { cookies: req.cookies })).data.data;
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
	const action = { delete: params.disk };
	const method = params.type === "qemu" ? "POST" : "PUT";
	const result = await global.pve.requestPVE(`${vmpath}/config`, method, { token: true }, action);
	await global.pve.handleResponse(params.node, result, res);
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
router.post("/:disk/attach", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
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
	const config = (await global.pve.requestPVE(`${vmpath}/config`, "GET", { cookies: req.cookies })).data.data;
	// disk must exist
	if (!config[`unused${params.source}`]) {
		res.status(403).send({ error: `Requested disk unused${params.source} does not exist.` });
		res.end();
		return;
	}
	// target disk must be allowed according to source disk's storage options
	const diskConfig = await global.pve.getDiskInfo(params.node, config, `unused${params.source}`); // get target disk
	const resourceConfig = global.config.resources;
	if (!resourceConfig[diskConfig.storage].disks.some(diskPrefix => params.disk.startsWith(diskPrefix))) {
		res.status(500).send({ error: `Requested target ${params.disk} is not in allowed list [${resourceConfig[diskConfig.storage].disks}].` });
		res.end();
		return;
	}
	// setup action using source disk info from vm config
	const action = {};
	action[params.disk] = config[`unused${params.source}`];
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await global.pve.requestPVE(`${vmpath}/config`, method, { token: true }, action);
	await global.pve.handleResponse(params.node, result, res);
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
router.post("/:disk/resize", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		disk: req.params.disk,
		size: req.body.size
	};

	const userRealm = req.cookies.username.split("@").at(-1);
	const userID = req.cookies.username.replace(`@${userRealm}`, "");
	const userObj = { id: userID, realm: userRealm };

	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const config = (await global.pve.requestPVE(`${vmpath}/config`, "GET", { cookies: req.cookies })).data.data;
	// check disk existence
	const diskConfig = await global.pve.getDiskInfo(params.node, config, params.disk); // get target disk
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
	if (!await approveResources(req, userObj, request, params.node)) {
		res.status(500).send({ request, error: `Storage ${storage} could not fulfill request of size ${params.size}G.` });
		res.end();
		return;
	}
	// action approved, commit to action
	const action = { disk: params.disk, size: `+${params.size}G` };
	const result = await global.pve.requestPVE(`${vmpath}/resize`, "PUT", { token: true }, action);
	await global.pve.handleResponse(params.node, result, res);
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
router.post("/:disk/move", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		disk: req.params.disk,
		storage: req.body.storage,
		delete: req.body.delete
	};

	const userRealm = req.cookies.username.split("@").at(-1);
	const userID = req.cookies.username.replace(`@${userRealm}`, "");
	const userObj = { id: userID, realm: userRealm };

	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const config = (await global.pve.requestPVE(`${vmpath}/config`, "GET", { cookies: req.cookies })).data.data;
	// check disk existence
	const diskConfig = await global.pve.getDiskInfo(params.node, config, params.disk); // get target disk
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
	if (!await approveResources(req, userObj, request, params.node)) {
		res.status(500).send({ request, error: `Storage ${params.storage} could not fulfill request of size ${params.size}G.` });
		res.end();
		return;
	}
	// create action
	const action = { storage: params.storage, delete: params.delete };
	if (params.type === "qemu") {
		action.disk = params.disk;
	}
	else {
		action.volume = params.disk;
	}
	const route = params.type === "qemu" ? "move_disk" : "move_volume";
	// commit action
	const result = await global.pve.requestPVE(`${vmpath}/${route}`, "POST", { token: true }, action);
	await global.pve.handleResponse(params.node, result, res);
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
router.delete("/:disk/delete", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
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
	const config = (await global.pve.requestPVE(`${vmpath}/config`, "GET", { cookies: req.cookies })).data.data;
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
	const action = { delete: params.disk };
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await global.pve.requestPVE(`${vmpath}/config`, method, { token: true }, action);
	await global.pve.handleResponse(params.node, result, res);
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
router.post("/:disk/create", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		disk: req.params.disk,
		storage: req.body.storage,
		size: req.body.size,
		iso: req.body.iso
	};

	const userRealm = req.cookies.username.split("@").at(-1);
	const userID = req.cookies.username.replace(`@${userRealm}`, "");
	const userObj = { id: userID, realm: userRealm };

	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get current config
	const config = (await global.pve.requestPVE(`${vmpath}/config`, "GET", { cookies: req.cookies })).data.data;
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
		if (!await approveResources(req, userObj, request, params.node)) {
			res.status(500).send({ request, error: `Storage ${params.storage} could not fulfill request of size ${params.size}G.` });
			res.end();
			return;
		}
		// target disk must be allowed according to storage options
		const resourceConfig = global.config.resources;
		if (!resourceConfig[params.storage].disks.some(diskPrefix => params.disk.startsWith(diskPrefix))) {
			res.status(500).send({ error: `Requested target ${params.disk} is not in allowed list [${resourceConfig[params.storage].disks}].` });
			res.end();
			return;
		}
	}
	// setup action
	const action = {};
	if (params.disk.includes("ide") && params.iso) {
		action[params.disk] = `${params.iso},media=cdrom`;
	}
	else if (params.type === "qemu") { // type is qemu, use sata
		action[params.disk] = `${params.storage}:${params.size}`;
	}
	else { // type is lxc, use mp and add mp and backup values
		action[params.disk] = `${params.storage}:${params.size},mp=/${params.disk}/,backup=1`;
	}
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await global.pve.requestPVE(`${vmpath}/config`, method, { token: true }, action);
	await global.pve.handleResponse(params.node, result, res);
});
