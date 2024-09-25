import { Router } from "express";
export const router = Router({ mergeParams: true });

const checkAuth = global.utils.checkAuth;

/**
 * GET - get db global resource configuration
 * responses:
 * - 200: Object
 */
router.get("/config/:key", async (req, res) => {
	const params = {
		key: req.params.key
	};
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	const allowKeys = ["resources"];
	if (allowKeys.includes(params.key)) {
		const config = global.config;
		const result = {}
		result[params.key] = config[params.key]
		res.status(200).send(result);
	}
	else {
		res.status(401).send({ auth: false, error: `User is not authorized to access /global/config/${params.key}.` });
	}
});
