import { Router } from "express";
export const router = Router({ mergeParams: true });

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
	const auth = await global.utils.checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	// attempt to parse user from username
	const userObj = global.utils.getUserObjFromUsername(params.username);
	if (userObj === null) {
		res.status(400).send({ auth:true, error:`username ${params.username} does not match format uid@realm.` });
	}

	// get user
	const u = await global.access.getUser(userObj, req.cookies);
	if (u.ok !== true) {
		res.status(u.status).send({ auth: true, error: u });
		return;
	}
	const user = u.user;

	res.status(200).send({ user });
});
