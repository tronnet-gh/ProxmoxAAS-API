import { Router } from "express";
export const router = Router({ mergeParams: true }); ;

const config = global.config;
const checkAuth = global.utils.checkAuth;

/**
 * GET - get db user resource information including allocated, free, and maximum resource values along with resource metadata
 * responses:
 * - 200: {avail: Object, max: Object, used: Object, resources: Object}
 * - 401: {auth: false}
 */
router.get("/dynamic/resources", async (req, res) => {
	const params = {
		username: req.cookies.username
	};

	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	const userObj = global.utils.getUserObjFromUsername(params.username);

	const resources = await global.utils.getUserResources(req, userObj);
	res.status(200).send(resources);
});

/**
 * GET - get db user configuration by key
 * request:
 * - key: string - user config key
 * responses:
 * - 200: Object
 * - 401: {auth: false}
 * - 401: {auth: false, error: string}
 */
router.get("/config/:key", async (req, res) => {
	const params = {
		key: req.params.key
	};

	const userObj = global.utils.getUserObjFromUsername(req.cookies.username);

	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	const allowKeys = ["resources", "cluster"];
	if (allowKeys.includes(params.key)) {
		const config = await global.userManager.getUser(userObj, req.cookies);
		res.status(200).send(config[params.key]);
	}
	else {
		res.status(401).send({ auth: false, error: `User is not authorized to access /user/config/${params.key}.` });
	}
});

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
	const isos = content.data.data;
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
	const isos = content.data.data;
	const userIsos = [];
	isos.forEach((iso) => {
		iso.name = iso.volid.replace(`${userIsoConfig.storage}:vztmpl/`, "");
		userIsos.push(iso);
	});
	userIsos.sort();
	res.status(200).send(userIsos);
});
