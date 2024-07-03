import { Router } from "express";
export const router = Router({ mergeParams: true });

/**
 * GET - get all groups
 * responses:
 * - 200: {auth:true, groups: Array}
 * - 201: {auth: false}
 */
router.get("/", async (req, res) => {
    const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
    res.status(200).send(global.userManager.getAllGroups())
});