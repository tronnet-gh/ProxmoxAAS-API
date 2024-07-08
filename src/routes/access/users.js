import { Router } from "express";
export const router = Router({ mergeParams: true });

const checkAuth = global.utils.checkAuth;

/**
 * GET - get all users
 * responses:
 * - 200: {auth:true, users: Array}
 * - 201: {auth: false}
 */
router.get("/", async (req, res) => {
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	res.status(200).send(global.userManager.getAllUsers());
});
