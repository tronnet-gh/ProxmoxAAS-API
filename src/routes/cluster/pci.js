import { Router } from "express";
import { token } from "morgan";
export const router = Router({ mergeParams: true }); ;

const checkAuth = global.utils.checkAuth;
const approveResources = global.utils.approveResources;

/**
 * GET - get instance pcie device data
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number to destroy
 * - hostpci: string - hostpci number
 * responses:
 * - 200: PVE PCI Device Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 */
router.get("/:hostpci", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		hostpci: req.params.hostpci.replace("hostpci", "")
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// check device is in instance config
	const config = (await global.pve.requestPVE(`${vmpath}/config`, "GET", { cookies: req.cookies })).data.data;
	if (!config[`hostpci${params.hostpci}`]) {
		res.status(500).send({ error: `Could not find hostpci${params.hostpci} in ${params.vmid}.` });
		res.end();
		return;
	}
	const device = config[`hostpci${params.hostpci}`].split(",")[0];
	// get node's pci devices
	const deviceData = await global.pve.getDeviceInfo(params.node, device);
	if (!deviceData) {
		res.status(500).send({ error: `Could not find hostpci${params.hostpci}=${device} in ${params.node}.` });
		res.end();
		return;
	}
	res.status(200).send(deviceData);
	res.end();
});

/**
 * POST - modify existing instance pci device
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number to destroy
 * - hostpci: string - hostpci number
 * - device: string - new device id
 * - pcie: Boolean - whether to use pci express or pci
 * response:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
router.post("/:hostpci/modify", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		hostpci: req.params.hostpci.replace("hostpci", ""),
		device: req.body.device,
		pcie: req.body.pcie
	};

	const userObj = global.utils.getUserObjFromUsername(req.cookies.username);

	// check if type is qemu
	if (params.type !== "qemu") {
		res.status(500).send({ error: "Type must be qemu (vm)." });
		res.end();
		return;
	}
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// force all functions
	params.device = params.device.split(".")[0];
	// get instance config to check if device has not changed
	const config = (await global.pve.requestPVE(`/nodes/${params.node}/${params.type}/${params.vmid}/config`, "GET", { token: true })).data.data;
	const currentDeviceData = await global.pve.getDeviceInfo(params.node, config[`hostpci${params.hostpci}`].split(",")[0]);
	if (!currentDeviceData) {
		res.status(500).send({ error: `No device in hostpci${params.hostpci}.` });
		res.end();
		return;
	}
	// only check user and node availability if base id is different
	if (currentDeviceData.id.split(".")[0] !== params.device) {
		// setup request
		const deviceData = await global.pve.getDeviceInfo(params.node, params.device);
		const request = { pci: deviceData.device_name };
		// check resource approval
		if (!await approveResources(req, userObj, request, params.node)) {
			res.status(500).send({ request, error: `Could not fulfil request for ${deviceData.device_name}.` });
			res.end();
			return;
		}
		// check node availability
		const nodeAvailPci = await global.pve.getNodeAvailDevices(params.node, req.cookies);
		if (!nodeAvailPci.some(element => element.id.split(".")[0] === params.device)) {
			res.status(500).send({ error: `Device ${params.device} is already in use on ${params.node}.` });
			res.end();
			return;
		}
	}
	// setup action
	const action = {};
	action[`hostpci${params.hostpci}`] = `${params.device},pcie=${params.pcie}`;
	// commit action
	const rootauth = await global.pve.requestPVE("/access/ticket", "POST", null, global.config.backends.pve.config.root);
	if (!(rootauth.status === 200)) {
		res.status(rootauth.status).send({ auth: false, error: "API could not authenticate as root user." });
		res.end();
		return;
	}
	const rootcookies = {
		PVEAuthCookie: rootauth.data.data.ticket,
		CSRFPreventionToken: rootauth.data.data.CSRFPreventionToken
	};
	const result = await global.pve.requestPVE(`${vmpath}/config`, "POST", { cookies: rootcookies }, action);
	await global.pve.handleResponse(params.node, result, res);
});

/**
 * POST - add new instance pci device
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number to destroy
 * - device: string - new device id
 * - pcie: Boolean - whether to use pci express or pci
 * response:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
router.post("/create", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		device: req.body.device,
		pcie: req.body.pcie
	};

	const userObj = global.utils.getUserObjFromUsername(req.cookies.username);

	// check if type is qemu
	if (params.type !== "qemu") {
		res.status(500).send({ error: "Type must be qemu (vm)." });
		res.end();
		return;
	}
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// force all functions
	params.device = params.device.split(".")[0];
	// get instance config to find next available hostpci slot
	const config = (await global.pve.requestPVE(`/nodes/${params.node}/${params.type}/${params.vmid}/config`, "GET", { token: true })).data.data;
	let hostpci = 0;
	while (config[`hostpci${hostpci}`]) {
		hostpci++;
	}
	// setup request
	const deviceData = await global.pve.getDeviceInfo(params.node, params.device);
	const request = {
		pci: deviceData.device_name
	};
	// check resource approval
	if (!await approveResources(req, userObj, request, params.node)) {
		res.status(500).send({ request, error: `Could not fulfil request for ${deviceData.device_name}.` });
		res.end();
		return;
	}
	// check node availability
	const nodeAvailPci = await global.pve.getNodeAvailDevices(params.node, req.cookies);
	if (!nodeAvailPci.some(element => element.id.split(".")[0] === params.device)) {
		res.status(500).send({ error: `Device ${params.device} is already in use on ${params.node}.` });
		res.end();
		return;
	}
	// setup action
	const action = {};
	action[`hostpci${hostpci}`] = `${params.device},pcie=${params.pcie}`;
	// commit action
	const rootauth = await global.pve.requestPVE("/access/ticket", "POST", null, global.config.backends.pve.config.root);
	if (!(rootauth.status === 200)) {
		res.status(rootauth.status).send({ auth: false, error: "API could not authenticate as root user." });
		res.end();
		return;
	}
	const rootcookies = {
		PVEAuthCookie: rootauth.data.data.ticket,
		CSRFPreventionToken: rootauth.data.data.CSRFPreventionToken
	};
	const result = await global.pve.requestPVE(`${vmpath}/config`, "POST", { cookies: rootcookies }, action);
	await global.pve.handleResponse(params.node, result, res);
});

/**
 * DELETE - delete instance pci device
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number to destroy
 * - hostpci: string - hostpci number
 * response:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {request: Object, error: string}
 * - 500: PVE Task Object
 */
router.delete("/:hostpci/delete", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		hostpci: req.params.hostpci.replace("hostpci", "")
	};
	// check if type is qemu
	if (params.type !== "qemu") {
		res.status(500).send({ error: "Type must be qemu (vm)." });
		res.end();
		return;
	}
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// check device is in instance config
	const config = (await global.pve.requestPVE(`${vmpath}/config`, "GET", { cookies: req.cookies })).data.data;
	if (!config[`hostpci${params.hostpci}`]) {
		res.status(500).send({ error: `Could not find hostpci${params.hostpci} in ${params.vmid}.` });
		res.end();
		return;
	}
	// setup action
	const action = { delete: `hostpci${params.hostpci}` };
	// commit action, need to use root user here because proxmox api only allows root to modify hostpci for whatever reason
	const rootauth = await global.pve.requestPVE("/access/ticket", "POST", null, global.config.backends.pve.config.root);
	if (!(rootauth.status === 200)) {
		res.status(rootauth.status).send({ auth: false, error: "API could not authenticate as root user." });
		res.end();
		return;
	}
	const rootcookies = {
		PVEAuthCookie: rootauth.data.data.ticket,
		CSRFPreventionToken: rootauth.data.data.CSRFPreventionToken
	};
	const result = await global.pve.requestPVE(`${vmpath}/config`, "POST", { cookies: rootcookies }, action);
	await global.pve.handleResponse(params.node, result, res);
});
