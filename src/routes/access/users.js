import { Router } from "express";
export const router = Router({ mergeParams: true });

const checkAuth = global.utils.checkAuth;

/**
 * GET - get specific user
 * request:
 * - username: username (id@realm) of user to get
 * responses:
 * - 200: {auth: true, user: Object}
 * - 401: {auth: false}
 */
router.get("/:username", async (req, res) => {
	const params = {
		username: req.params.username
	};
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	
	const userObj = global.utils.getUserObjFromUsername(params.username);
	const u = await global.access.getUser(userObj, req.cookies);
	if (u.ok !== true) {
		res.status(u.status).send(u);
		return;
	}
	const user = u.user;

	res.status(200).send({ user });
});
