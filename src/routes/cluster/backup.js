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
 * POST - edit the notes for an existing backup
 * request:
 * - node: string - vm host node id
 * - type: string - vm type (lxc, qemu)
 * - vmid: number - vm id number
 * - volid: volid of the backup to be deleted
 * - notes: notes template string
 * responses:
 * - 200: PVE Task Object
 * - 401: {auth: false, path: string}
 * - 500: {error: string}
 * - 500: PVE Task Object
 */
router.post("/notes", async (req, res) => {
	const params = {
		node: req.params.node,
		type: req.params.type,
		vmid: req.params.vmid,
		volid: req.body.volid,
		notes: req.body.notes
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

	// create backup using vzdump path
	const body = {
		notes: params.notes
	};
	const result = await global.pve.requestPVE(`/nodes/${params.node}/storage/${storage}/content/${params.volid}`, "PUT", { token: true }, body);
	if (result.status === 200) {
		res.status(result.status).send();
	}
	else {
		res.status(result.status).send({ error: result.statusText });
	}
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

/**
 * POST - restore instance using backup file. Ideally, PBS should be used instead so that individual disk level restore can be done.
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
router.post("/restore", async (req, res) => {
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

	// container restore
	// need to use "advanced" mode to specify the storage used for each disk, so we also need to read the container's config
	// for whatever reason, this will wipe disks that are not included in the backup !!!
	if (params.type === "lxc") {
		const body = {
			vmid: params.vmid,
			force: 1,
			ostemplate: params.volid,
			restore: 1
		};

		const instance = await global.pve.getInstance(params.node, params.vmid);
		for (const v in instance.volumes) {
			const volume = instance.volumes[v];
			if (volume.type === "mp") {
				body[v] = `${volume.storage}:${volume.size / 1024 ** 3},mp=${volume.mp},backup=1`;
			}
			else if (volume.type === "rootfs") {
				body[v] = `${volume.storage}:${volume.size / 1024 ** 3}`;
			}
		}

		const result = await global.pve.requestPVE(`/nodes/${params.node}/${params.type}/`, "POST", { token: true }, body);
		console.log(result);
		if (result.status === 200) {
			res.status(result.status).send();
		}
		else {
			res.status(result.status).send({ error: result.statusText });
		}
	}
	// VM restore, unlike the container restore, this should not affect disks which are not in the backup
	else if (params.type === "qemu") { // vm restore
		const body = {
			vmid: params.vmid,
			force: 1,
			archive: params.volid
		};
		const result = await global.pve.requestPVE(`/nodes/${params.node}/${params.type}/`, "POST", { token: true }, body);
		if (result.status === 200) {
			res.status(result.status).send();
		}
		else {
			res.status(result.status).send({ error: result.statusText });
		}
	}
});
