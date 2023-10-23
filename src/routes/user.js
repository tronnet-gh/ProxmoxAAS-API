import { Router } from "express";
export const router = Router({ mergeParams: true }); ;

const db = global.db;
const requestPVE = global.pve.requestPVE;
const checkAuth = global.utils.checkAuth;
const getUserResources = global.utils.getUserResources;
const pveAPIToken = global.db.pveAPIToken;

/**
 * GET - get db user resource information including allocated, free, and maximum resource values along with resource metadata
 * responses:
 * - 200: {avail: Object, max: Object, used: Object, resources: Object}
 * - 401: {auth: false}
 */
router.get("/dynamic/resources", async (req, res) => {
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	const resources = await getUserResources(req, req.cookies.username);
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
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	const allowKeys = ["resources", "cluster", "nodes"];
	if (allowKeys.includes(params.key)) {
		const config = db.getUser(req.cookies.username);
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
router.get("/iso", async (req, res) => {
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	// get user iso config
	const userIsoConfig = db.getGlobal().useriso;
	// get all isos
	const isos = (await requestPVE(`/nodes/${userIsoConfig.node}/storage/${userIsoConfig.storage}/content?content=iso`, "GET", { token: pveAPIToken })).data.data;
	const userIsos = [];
	isos.forEach((iso) => {
		iso.name = iso.volid.replace(`${userIsoConfig.storage}:iso/`, "");
		userIsos.push(iso);
	});
	userIsos.sort();
	res.status(200).send(userIsos);
});
