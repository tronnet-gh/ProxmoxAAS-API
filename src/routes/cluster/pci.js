import { Router } from "express";
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
		hostpci: req.params.hostpci
	};
	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}
	// get device
	const device = await global.pve.getDevice(params.node, params.vmid, params.hostpci);
	if (!device) {
		res.status(500).send({ error: `Could not find ${params.hostpci}=${device} in ${params.node}.` });
		res.end();
		return;
	}
	res.status(200).send(device);
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
		hostpci: req.params.hostpci,
		device: req.body.device,
		pcie: req.body.pcie
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
	// force all functions
	params.device = params.device.split(".")[0];
	// device must exist to be modified
	const existingDevice = await global.pve.getDevice(params.node, params.vmid, params.hostpci);
	if (!existingDevice) {
		res.status(500).send({ error: `No device in ${params.hostpci}.` });
		res.end();
		return;
	}
	// only check user and node availability if base id is different, we do the split in case of existing partial-function hostpci
	const userObj = global.utils.getUserObjFromUsername(req.cookies.username);
	if (existingDevice.device_bus.split(".")[0] !== params.device) {
		// setup request
		const node = await global.pve.getNode(params.node);
		const requestedDevice = node.devices[`${params.device}`];
		const request = { pci: requestedDevice.device_name };
		if (!requestedDevice) {
			res.status(500).send({ request, error: `Could not fulfil request for ${params.device}.` });
			res.end();
			return;
		}
		// check resource approval
		const { approved } = await approveResources(req, userObj, request, params.node);
		if (!approved) {
			res.status(500).send({ request, error: `Could not fulfil request for ${requestedDevice.device_name}.` });
			res.end();
			return;
		}
		// check node availability
		if (!Object.values(node.devices).some(element => element.device_bus.split(".")[0] === params.device && element.reserved === false)) {
			res.status(500).send({ error: `Device ${params.device} is already in use on ${params.node}.` });
			res.end();
			return;
		}
	}
	// setup action
	const action = {};
	action[`${params.hostpci}`] = `${params.device},pcie=${params.pcie}`;
	// commit action
	const result = await global.pve.requestPVE(`${vmpath}/config`, "POST", { root: true }, action);
	await global.pve.handleResponse(params.node, result, res);
	await global.pve.syncNode(params.node);
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
router.post("/:hostpci/create", async (req, res) => {
	req.params = Object.assign({}, req.routeparams, req.params);
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		hostpci: req.params.hostpci,
		device: req.body.device,
		pcie: req.body.pcie
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
	// force all functions
	params.device = params.device.split(".")[0];
	// device must not exist to be added
	const existingDevice = await global.pve.getDevice(params.node, params.vmid, params.hostpci);
	if (existingDevice) {
		res.status(500).send({ error: `Existing device in ${params.hostpci}.` });
		res.end();
		return;
	}
	// setup request
	const node = await global.pve.getNode(params.node);
	const requestedDevice = node.devices[`${params.device}`];
	const request = { pci: requestedDevice.device_name };
	// check resource approval
	const userObj = global.utils.getUserObjFromUsername(req.cookies.username);
	const { approved } = await approveResources(req, userObj, request, params.node);
	if (!approved) {
		res.status(500).send({ request, error: `Could not fulfil request for ${requestedDevice.device_name}.` });
		res.end();
		return;
	}
	// check node availability
	// const node = await global.pve.getNode(params.node);
	if (!Object.values(node.devices).some(element => element.device_bus.split(".")[0] === params.device && element.reserved === false)) {
		res.status(500).send({ error: `Device ${params.device} is already in use on ${params.node}.` });
		res.end();
		return;
	}
	// setup action
	const action = {};
	action[`${params.hostpci}`] = `${params.device},pcie=${params.pcie}`;
	// commit action
	const result = await global.pve.requestPVE(`${vmpath}/config`, "POST", { root: true }, action);
	await global.pve.handleResponse(params.node, result, res);
	await global.pve.syncNode(params.node);
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
		hostpci: req.params.hostpci
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
	const device = global.pve.getDevice(params.node, params.vmid, params.hostpci);
	if (!device) {
		res.status(500).send({ error: `Could not find ${params.hostpci} in ${params.vmid}.` });
		res.end();
		return;
	}
	// setup action
	const action = { delete: `${params.hostpci}` };
	// commit action, need to use root user here because proxmox api only allows root to modify hostpci for whatever reason
	const result = await global.pve.requestPVE(`${vmpath}/config`, "POST", { root: true }, action);
	await global.pve.handleResponse(params.node, result, res);
	await global.pve.syncNode(params.node);
});
