import { Router } from "express";
export const router = Router({ mergeParams: true });

const checkAuth = global.utils.checkAuth;

/**
 * GET - get all users
 * responses:
 * - 200: {auth:true, users: Array}
 * - 401: {auth: false}
 */
router.get("/", async (req, res) => {
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	const users = await global.userManager.getAllUsers(req.cookies);
	res.status(200).send({ users });
});

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
	const user = await global.userManager.getUser(userObj, req.cookies);
	res.status(200).send({ user });
});
