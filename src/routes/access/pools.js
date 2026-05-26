import { Router } from "express";
export const router = Router({ mergeParams: true });

/**
 * GET - get all available cluster pools
 * returns only pool IDs
 * responses:
 * - 200: List of pools
 * - PVE error
 */
router.get("/", async (req, res) => {
	// check auth
	const auth = await global.utils.checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	// get user object
	const userObj = global.utils.getUserObjFromUsername(req.cookies.username);

	// get all pool names using api token
	const poolnames = await global.pve.requestPVE("/pools", "GET", { token: true });

	// setup pools (return value)
	const pools = {};
	// for each poolname
	for (const poolpartial of poolnames.data) {
		const poolname = poolpartial.poolid;
		// get the pool
		const p = await global.access.getPool(poolname, req.cookies);
		if (p.ok !== true) {
			continue;
		}
		const pool = p.pool;
		// if user is in the pool, add it to pools (return value)
		if (global.utils.checkUserInPool(pool, userObj)) {
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
	const auth = await global.utils.checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	// get pool
	const p = await global.access.getPool(params.poolname, req.cookies);
	if (p.ok !== true) {
		res.status(p.status).send({ auth:true, error: p });
		return;
	}
	const pool = p.pool;
	// get resources
	const resources = await global.utils.getPoolResources(req, params.poolname);
	// append resources to pool
	pool.resources = resources;

	res.status(200).send({ auth: true, pool });
});
