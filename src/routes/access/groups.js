import { Router } from "express";
export const router = Router({ mergeParams: true });

/**
 * GET - get all groups
 * responses:
 * - 200: {auth: true, groups: {[groupname]: Object}}
 * - 401: {auth: false}
 * - PVE error: {auth: true, error: string}
 */
router.get("/", async (req, res) => {
	// check auth
	const auth = await global.utils.checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	const pvegroups = await global.pve.requestPVE("/access/groups", "GET", { cookies: req.cookies });
	if (pvegroups.status !== 200) {
		res.status(pvegroups.status).send({ auth: true, error: pvegroups.statusText });
		return;
	}

	const groups = {};
	for (const { groupid, users } of pvegroups.data) {
		const groupObj = global.utils.getGroupObjFromGroupname(groupid);
		const usernames = users ? users.split(",") : []; // proxmox sends users as a comma separated list, it may be empty or missing
		groups[groupid] = {
			groupname: { gid: groupObj.id, realm: groupObj.realm },
			users: usernames.map((username) => {
				const userObj = global.utils.getUserObjFromUsername(username);
				return { username: { uid: userObj.id, realm: userObj.realm } };
			})
		};
	}

	res.status(200).send({ auth: true, groups });
});

/**
 * GET - get specific group
 * request:
 * - groupname: name of group to get
 * responses:
 * - 200: {auth: true, group: Object}
 * - 401: {auth: false}
 */
router.get("/:groupname", async (req, res) => {
	const params = {
		groupname: req.params.groupname
	};
	// check auth
	const auth = await global.utils.checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	// attempt to parse group from groupname
	const groupObj = global.utils.getGroupObjFromGroupname(params.groupname);
	if (groupObj === null) {
		res.status(400).send({ auth: true, error:`Groupname ${params.groupname} does not match format gid-realm or gid.` });
	}
	
	// get group
	const g = await global.access.getGroup(groupObj, req.cookies);
	if (g.ok !== true) {
		res.status(g.status).send({ auth:true, error:g });
		return;
	}
	const group = g.group;

	res.status(200).send({ auth:true, group });
});
