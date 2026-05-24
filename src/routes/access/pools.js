import { Router } from "express";
export const router = Router({ mergeParams: true });

const checkAuth = global.utils.checkAuth;
const checkUserInPool = global.utils.checkUserInPool;

/**
 * GET - get all available cluster pools
 * returns only pool IDs
 * responses:
 * - 200: List of pools
 * - PVE error
 */
router.get("/", async (req, res) => {
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	const userObj = global.utils.getUserObjFromUsername(req.cookies.username);

	const pools = {};

	const poolnames = await global.pve.requestPVE("/pools", "GET", { token: true });

	for (const poolpartial of poolnames.data) {
		const poolname = poolpartial.poolid;
		
		const p = await global.access.getPool(poolname, req.cookies);
		if (p.ok !== true) {
			continue;
		}
		const pool = p.pool;

		if (checkUserInPool(pool, userObj)) {
			const resources = await global.utils.getPoolResources(req, poolname);
			pool.resources = resources;
			pools[poolname] = pool;
		}
	}

	res.status(200).send({ pools });
	res.end();
});

/**
 * GET - get specific pool
 * request:
 * - poolname: name of pool to get
 * responses:
 * - 200: {auth: true, pool: Object}
 * - 401: {auth: false}
 */
router.get("/:poolname", async (req, res) => {
	const params = {
		poolname: req.params.poolname
	};
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	const p = await global.access.getPool(params.poolname, req.cookies);
	if (p.ok !== true) {
		res.status(p.status).send(p);
		return;
	}
	const pool = p.pool;
	const resources = await global.utils.getPoolResources(req, params.poolname);

	pool.resources = resources;

	res.status(200).send({ pool });
});
