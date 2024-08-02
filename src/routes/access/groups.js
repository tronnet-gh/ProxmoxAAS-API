import { Router } from "express";
export const router = Router({ mergeParams: true });

const checkAuth = global.utils.checkAuth;

/**
 * GET - get all groups
 * responses:
 * - 200: {auth: true, groups: Array}
 * - 401: {auth: false}
 */
router.get("/", async (req, res) => {
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	const groups = await global.userManager.getAllGroups(req.cookies);
	res.status(200).send({ groups });
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
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	const group = await global.userManager.getGroup(params.groupname, req.cookies);
	res.status(200).send({ group });
});
