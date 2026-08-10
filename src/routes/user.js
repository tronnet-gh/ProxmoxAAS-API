import { Router } from "express";
export const router = Router({ mergeParams: true }); ;

const config = global.config;
const checkAuth = global.utils.checkAuth;

/**
 * GET - get user accessible iso files
 * response:
 * - 200: Array.<Object>
 * - 401: {auth: false}
 */
router.get("/vm-isos", async (req, res) => {
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	// get user iso config
	const userIsoConfig = config.useriso;
	// get all isos
	const content = await global.pve.requestPVE(`/nodes/${userIsoConfig.node}/storage/${userIsoConfig.storage}/content?content=iso`, "GET", { token: true });
	if (content.status !== 200) {
		res.status(content.status).send({ error: content.statusText });
		return;
	}
	const isos = content.data;
	const userIsos = [];
	isos.forEach((iso) => {
		iso.name = iso.volid.replace(`${userIsoConfig.storage}:iso/`, "");
		userIsos.push(iso);
	});
	userIsos.sort();
	res.status(200).send(userIsos);
});

/**
 * GET - get user accessible container template files
 * response:
 * - 200: Array.<Object>
 * - 401: {auth: false}
 */
router.get("/ct-templates", async (req, res) => {
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	// get user iso config
	const userIsoConfig = config.useriso;
	// get all isos
	const content = await global.pve.requestPVE(`/nodes/${userIsoConfig.node}/storage/${userIsoConfig.storage}/content?content=vztmpl`, "GET", { token: true });
	if (content.status !== 200) {
		res.status(content.status).send({ error: content.statusText });
		return;
	}
	const isos = content.data;
	const userIsos = [];
	isos.forEach((iso) => {
		iso.name = iso.volid.replace(`${userIsoConfig.storage}:vztmpl/`, "");
		userIsos.push(iso);
	});
	userIsos.sort();
	res.status(200).send(userIsos);
});
