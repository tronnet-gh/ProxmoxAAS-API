import { Router } from "express";
export const router = Router({ mergeParams: true });

const checkAuth = global.utils.checkAuth;

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
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	const groupObj = global.utils.getGroupObjFromGroupname(params.groupname);
	const g = await global.access.getGroup(groupObj, req.cookies);
	if (g.ok !== true) {
		res.status(g.status).send(g);
		return;
	}
	const group = g.group;

	res.status(200).send({ group });
});
