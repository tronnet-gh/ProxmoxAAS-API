import { Router } from "express";
export const router = Router({ mergeParams: true }); ;

const checkAuth = global.utils.checkAuth;

/**
 * GET - get backups for an instance
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * responses:
 * - 200: List of backups
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: PVE Task Object
 */
router.get("/", async (req, res) => {
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

	// get vm backups
	const storage = global.config.backups.storage;
	const backups = await global.pve.requestPVE(`/nodes/${params.node}/storage/${storage}/content?content=backup&vmid=${params.vmid}`, "GET", { token: true });
	if (backups.status === 200) {
		res.status(backups.status).send(backups.data.data);
	}
	else {
		res.status(backups.status).send({ error: backups.statusText });
	}
});

/**
 * POST - create a new backup of instance using snapshot mode
 * !!! Due to the time that backups can take, the API will not wait for the proxmox task to finish !!!
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - notes: notes template string or null if the default one should be used
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: PVE Task Object
 */
router.post("/", async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		notes: req.body.notes ? req.body.notes : "[PAAS] {{node}}.{{vmid}} ({{guestname}}) has been backed up"
	};

	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}

	// check if number of backups is less than the allowed number
	const storage = global.config.backups.storage;
	const backups = await global.pve.requestPVE(`/nodes/${params.node}/storage/${storage}/content?content=backup&vmid=${params.vmid}`, "GET", { token: true });
	const numBackups = backups.data.data.length;
	const userObj = global.utils.getUserObjFromUsername(req.cookies.username);
	const maxAllowed = (await global.userManager.getUser(userObj, req.cookies)).cluster.backups.max;
	if (backups.status !== 200) {
		res.status(backups.status).send({ error: backups.statusText });
		return;
	}
	else if (numBackups >= maxAllowed) {
		res.status(backups.status).send({ error: `${params.vmid} already has ${numBackups} >= ${maxAllowed} max backups allowed` });
		return;
	}

	// create backup using vzdump path
	const body = {
		storage,
		vmid: params.vmid,
		mode: "snapshot",
		remove: 0,
		compress: "zstd",
		"notes-template": params.notes
	};
	const result = await global.pve.requestPVE(`/nodes/${params.node}/vzdump`, "POST", { token: true }, body);
	res.status(result.status).send(result.data.data);
});

/**
 * DELETE - delete existing backup of instance
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - volid: volid of the backup to be deleted
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: PVE Task Object
 */
router.delete("/", async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		volid: req.body.volid
	};

	// check auth for specific instance
	const vmpath = `/nodes/${params.node}/${params.type}/${params.vmid}`;
	const auth = await checkAuth(req.cookies, res, vmpath);
	if (!auth) {
		return;
	}

	// check if the specified volid is a backup for the instance
	// for whatever reason, calling /nodes/node/storage/content/volid does not return the vmid number whereas /nodes/storage/content?... does
	const storage = global.config.backups.storage;
	const backups = await global.pve.requestPVE(`/nodes/${params.node}/storage/${storage}/content?content=backup&vmid=${params.vmid}`, "GET", { token: true });
	if (backups.status !== 200) {
		res.status(backups.status).send({ error: backups.statusText });
		return;
	}
	let found = false;
	for (const volume of backups.data.data) {
		if (volume.subtype === params.type && String(volume.vmid) === params.vmid && volume.content === "backup" && volume.volid === params.volid) {
			found = true;
		}
	}
	if (!found) {
		res.status(500).send({ error: `Did not find backup volume ${params.volid} for ${params.node}.${params.vmid}` });
		return;
	}

	// found a valid backup with matching vmid and volid
	const result = await global.pve.requestPVE(`/nodes/${params.node}/storage/${storage}/content/${params.volid}?delay=5`, "DELETE", { token: true });
	res.status(result.status).send(result.data.data);
});
