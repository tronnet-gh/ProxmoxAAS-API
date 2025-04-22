import { Router } from "express";
export const router = Router({ mergeParams: true }); ;

const checkAuth = global.utils.checkAuth;
const approveResources = global.utils.approveResources;

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
router.post("/:netid/create", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		netid: req.params.netid,
		rate: req.body.rate,
		name: req.body.name
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// net interface must not exist
	const net = await global.pve.getNet(params.node, params.vmid, params.netid);
	if (net) {
		res.status(500).send({ error: `Network interface ${params.netid} already exists.` });
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
	const userObj = global.utils.getUserObjFromUsername(req.cookies.username);
	if (!await approveResources(req, userObj, request, params.node)) {
		res.status(500).send({ request, error: `Could not fulfil network request of ${params.rate}MB/s.` });
		res.end();
		return;
	}
	// setup action
	const nc = (await global.userManager.getUser(userObj, req.cookies)).templates.network[params.type];
	const action = {};
	if (params.type === "lxc") {
		action[`${params.netid}`] = `name=${params.name},bridge=${nc.bridge},ip=${nc.ip},ip6=${nc.ip6},tag=${nc.vlan},type=${nc.type},rate=${params.rate}`;
	}
	else {
		action[`${params.netid}`] = `${nc.type},bridge=${nc.bridge},tag=${nc.vlan},rate=${params.rate}`;
	}
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await global.pve.requestPVE(`${vmpath}/config`, method, { token: true }, action);
	await global.pve.handleResponse(params.node, result, res);
	await global.pve.syncInstance(params.node, params.vmid);
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
router.post("/:netid/modify", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		netid: req.params.netid,
		rate: req.body.rate
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// net interface must already exist
	const net = await global.pve.getNet(params.node, params.vmid, params.netid);
	if (!net) {
		res.status(500).send({ error: `Network interface net${params.netid} does not exist.` });
		res.end();
		return;
	}
	const request = {
		network: Number(params.rate) - Number(net.rate)
	};
	// check resource approval
	const userObj = global.utils.getUserObjFromUsername(req.cookies.username);
	if (!await approveResources(req, userObj, request, params.node)) {
		res.status(500).send({ request, error: `Could not fulfil network request of ${params.rate}MB/s.` });
		res.end();
		return;
	}
	// setup action
	const action = {};
	action[`${params.netid}`] = net.value.replace(`rate=${net.rate}`, `rate=${params.rate}`);
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await global.pve.requestPVE(`${vmpath}/config`, method, { token: true }, action);
	await global.pve.handleResponse(params.node, result, res);
	await global.pve.syncInstance(params.node, params.vmid);
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
router.delete("/:netid/delete", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		netid: req.params.netid
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// net interface must already exist
	const net = await global.pve.getNet(params.node, params.vmid, params.netid);
	if (!net) {
		res.status(500).send({ error: `Network interface net${params.netid} does not exist.` });
		res.end();
		return;
	}
	// setup action
	const method = params.type === "qemu" ? "POST" : "PUT";
	// commit action
	const result = await global.pve.requestPVE(`${vmpath}/config`, method, { token: true }, { delete: `${params.netid}` });
	await global.pve.handleResponse(params.node, result, res);
	await global.pve.syncInstance(params.node, params.vmid);
});
