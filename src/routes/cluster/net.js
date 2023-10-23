import { Router } from "express";
export const router = Router({ mergeParams: true }); ;

const db = global.db;
const requestPVE = global.pve.requestPVE;
const handleResponse = global.pve.handleResponse;
const checkAuth = global.utils.checkAuth;
const approveResources = global.utils.approveResources;
const pveAPIToken = global.db.pveAPIToken;

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
	const currentConfig = await requestPVE(`/nodes/${params.node}/${params.type}/${params.vmid}/config`, "GET", { token: pveAPIToken });
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
	const nc = db.getUser(req.cookies.username).network[params.type];
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
	const result = await requestPVE(`${vmpath}/config`, method, { token: pveAPIToken }, action);
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
router.post("/:netid/modify", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
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
	const currentConfig = await requestPVE(`/nodes/${params.node}/${params.type}/${params.vmid}/config`, "GET", { token: pveAPIToken });
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
	const result = await requestPVE(`${vmpath}/config`, method, { token: pveAPIToken }, action);
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
router.delete("/:netid/delete", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
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
	const currentConfig = await requestPVE(`/nodes/${params.node}/${params.type}/${params.vmid}/config`, "GET", { token: pveAPIToken });
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
	const result = await requestPVE(`${vmpath}/config`, method, { token: pveAPIToken }, action);
	await handleResponse(params.node, result, res);
});
