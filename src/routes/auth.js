import { Router } from "express";
export const router = Router({ mergeParams: true }); ;

const checkAuth = global.utils.checkAuth;

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
	const body = JSON.parse(JSON.stringify(req.body));
	const response = await global.pve.requestPVE("/access/ticket", "POST", null, body);
	if (!(response.status === 200)) {
		res.status(response.status).send({ auth: false });
		res.end();
		return;
	}
	const domain = global.config.application.domain;
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
	const domain = global.config.application.domain;
	res.cookie("PVEAuthCookie", "", { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("CSRFPreventionToken", "", { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("username", "", { domain, path: "/", httpOnly: true, secure: true, expires: expire });
	res.cookie("auth", 0, { domain, path: "/", expires: expire });
	res.status(200).send({ auth: false });
});

/**
 * POST - change user password
 * request:
 * - binduser: string
 * - bindpass: string
 * - username: string
 * - password: string
 * responses:
 * - PAAS-LDAP API response
 */
router.post("/password", async (req, res) => {
	const params = {
		binduser: req.body.binduser,
		bindpass: req.body.bindpass,
		username: req.body.username,
		password: req.body.password
	};

	const userRealm = params.username.split("@").at(-1);
	const domains = (await global.pve.requestPVE("/access/domains", "GET", { token: true })).data.data;
	const realm = domains.find((e) => e.realm === userRealm);
	const authHandlers = global.config.handlers.auth;

	if (realm.type in authHandlers) {
		const handler = authHandlers[realm.type];
		const userID = params.username.replace(`@${realm.realm}`, "");
		const newAttributes = {
			userpassword: params.password
		};
		const bindParams = {
			binduser: params.binduser,
			bindpass: params.bindpass
		};
		const response = await handler.modUser(userID, newAttributes, bindParams);
		if (response.ok) {
			res.status(response.status).send();
		}
		else {
			res.status(response.status).send({error: response.data.error});
		}
	}
	else {
		res.status(501).send({ error: `Auth type ${realm.type} not implemented yet.` });
	}
});
