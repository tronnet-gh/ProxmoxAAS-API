import { Router } from "express";
export const router = Router({ mergeParams: true }); ;

const db = global.db;
const domain = global.db.domain;
const checkAuth = global.utils.checkAuth;
const requestPVE = global.pve.requestPVE;
const pveAPIToken = global.db.pveAPIToken;

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
 * POST - safer ticket generation using proxmox authentication but adding HttpOnly
 * request:
 * - username: string
 * - password: string
 * responses:
 * - 200: {auth: true}
 * - 401: {auth: false}
 */
router.post("/ticket", async (req, res) => {
	const response = await requestPVE("/access/ticket", "POST", null, JSON.stringify(req.body));
	if (!(response.status === 200)) {
		res.status(response.status).send({ auth: false });
		res.end();
		return;
	}
	const ticket = response.data.data.ticket;
	const csrftoken = response.data.data.CSRFPreventionToken;
	const username = response.data.data.username;
	const expire = new Date(Date.now() + (2 * 60 * 60 * 1000));
	res.cookie("PVEAuthCookie", ticket, { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("CSRFPreventionToken", csrftoken, { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("username", username, { domain, path: "/", secure: true, expires: expire });
	res.cookie("auth", 1, { domain, path: "/", secure: true, expires: expire });
	res.status(200).send({ auth: true });
});

/**
 * DELETE - request to destroy ticket
 * responses:
 * - 200: {auth: false}
 */
router.delete("/ticket", async (req, res) => {
	const expire = new Date(0);
	res.cookie("PVEAuthCookie", "", { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("CSRFPreventionToken", "", { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("username", "", { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("auth", 0, { domain, path: "/", expires: expire });
	res.status(200).send({ auth: false });
});

router.post("/password", async (req, res) => {
	const params = {
		password: req.body.password,
		userid: req.cookies.username
	};

	const userRealm = params.userid.split("@").at(-1);
	const domains = (await requestPVE("/access/domains", "GET", pveAPIToken)).data.data;
	const realm = domains.find((e) => e.realm === userRealm);
	const authTypes = db.getStatic().types.auth;
	const realmType = authTypes[realm.type];

	if (realmType === "pve") {
		const response = await requestPVE("/access/password", "PUT", { cookies: req.cookies }, JSON.stringify(params));
		res.status(response.status).send(response.data);
	}
	else {
		res.status(501).send({ error: `Auth type ${realmType} not implemented yet.` });
	}
});
