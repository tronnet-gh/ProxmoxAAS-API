import { Router } from "express";
export const router = Router({ mergeParams: true }); ;

const checkAuth = global.utils.checkAuth;

global.utils.recursiveImportRoutes(router, "/access", "access", import.meta.url);

/**
 * GET - check authentication
 * responses:
 * - 200: {auth: true}
 * - 401: {auth: false}
 */
router.get("/", async (req, res) => {
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	res.status(200).send({ auth: true });
});

/**
 * Fetches and consumes cookies from backends and avoids duplicate cookies from repeat backends. Also helps handle errors.
 */
class CookieFetcher {
	#fetchedBackends = [];
	#cookies = [];
	async fetchBackends (backends, user, password) {
		for (const backend of backends) {
			if (this.#fetchedBackends.indexOf(backend) === -1) {
				const response = await global.backends[backend].openSession(user, password);
				if (!response.ok) {
					return false;
				}
				this.#cookies = this.#cookies.concat(response.cookies);
				this.#fetchedBackends.push(backend);
			}
			else { // assume that repeat backends should not be requested
				continue;
			}
		}
		return true;
	}

	exportCookies () {
		return this.#cookies;
	}
}

/**
 * POST - safer ticket generation using proxmox authentication but adding HttpOnly
 * request:
 * - username: string
 * - password: string
 * responses:
 * - 200: {auth: true}
 * - 401: {auth: false}
 */
router.post("/ticket", async (req, res) => {
	const params = {
		username: req.body.username,
		password: req.body.password
	};
	const domain = global.config.application.domain;
	// const userRealm = params.username.split("@").at(-1);
	const userObj = global.utils.getUserObjFromUsername(params.username);
	let backends = global.userManager.getBackendsByUser(userObj);
	backends = backends.concat(["pve"]);
	const cm = new CookieFetcher();
	const success = await cm.fetchBackends(backends, userObj, params.password);
	if (!success) {
		res.status(401).send({ auth: false });
		return;
	}
	const cookies = cm.exportCookies();
	for (const cookie of cookies) {
		const expiresDate = new Date(Date.now() + cookie.expiresMSFromNow);
		res.cookie(cookie.name, cookie.value, { domain, path: "/", httpOnly: true, secure: true, expires: expiresDate });
	}
	res.cookie("username", params.username, { domain, path: "/", secure: true });
	res.cookie("auth", 1, { domain, path: "/", secure: true });
	res.status(200).send({ auth: true });
});

/**
 * DELETE - request to destroy ticket
 * responses:
 * - 200: {auth: false}
 */
router.delete("/ticket", async (req, res) => {
	if (Object.keys(req.cookies).length === 0) {
		res.status(200).send({ auth: false });
		return;
	}
	const domain = global.config.application.domain;
	const expire = new Date(0);
	for (const cookie in req.cookies) {
		res.cookie(cookie, "", { domain, path: "/", expires: expire });
	}
	await global.pve.closeSession(req.cookies);
	await global.userManager.closeSession(req.cookies);
	res.status(200).send({ auth: false });
});

/**
 * POST - change user password
 * request:
 * - password: string
 * responses:
 * - PAAS-LDAP API response
 */
router.post("/password", async (req, res) => {
	const params = {
		username: req.cookies.username,
		password: req.body.password
	};

	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	const userObj = global.utils.getUserObjFromUsername(params.username);
	const newAttributes = {
		userpassword: params.password
	};
	const response = await global.userManager.setUser(userObj, newAttributes, req.cookies);
	res.status(response.status).send(response);
});
