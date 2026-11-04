import { Router } from "express";
export const router = Router({ mergeParams: true });

const config = global.config;
const checkAuth = global.utils.checkAuth;

/**
 * GET - get all groups
 * responses:
 * - 200: {auth: true, groups: {[groupname]: Object}}
 * - 401: {auth: false}
 * - PVE error: {auth: true, error: string}
 */
router.get("/", async (req, res) => {
	// check auth
	const auth = await global.utils.checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	const pveusers= await global.pve.requestPVE("/access/users?full=1", "GET", { cookies: req.cookies });
	if (pveusers.status !== 200) {
		res.status(pveusers.status).send({ auth: true, error: pveusers.statusText });
		return;
	}

	const users = {};
	for (const user of pveusers.data) {
		const userObj = global.utils.getUserObjFromUsername(user.userid);
		users[user.userid] = {
			username: {uid: userObj.id, realm: userObj.realm},
			cn: user.firstname,
			sn: user.lastname,
			mail: user.email,
			password: ""
		}
	}

	res.status(200).send({ auth: true, users });
});


/**
 * GET - get specific user
 * request:
 * - username: username (id@realm) of user to get
 * responses:
 * - 200: {auth: true, user: Object}
 * - 401: {auth: false}
 */
router.get("/:username", async (req, res) => {
	const params = {
		username: req.params.username
	};
	// check auth
	const auth = await global.utils.checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}

	// attempt to parse user from username
	const userObj = global.utils.getUserObjFromUsername(params.username);
	if (userObj === null) {
		res.status(400).send({ auth:true, error:`username ${params.username} does not match format uid@realm.` });
	}

	// get user
	const u = await global.access.getUser(userObj, req.cookies);
	if (u.ok !== true) {
		res.status(u.status).send({ auth: true, error: u });
		return;
	}
	const user = u.user;

	res.status(200).send({ user });
});

/**
 * GET - get user accessible iso files
 * response:
 * - 200: Array.<Object>
 * - 401: {auth: false}
 */
router.get("/:username/vm-isos", async (req, res) => {
	const params = {
		username: req.params.username
	};
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	// check requested username is current user
	if (req.cookies.username !== params.username) {
		res.status(401).send({ auth: false  });
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
router.get("/:username/ct-templates", async (req, res) => {
	const params = {
		username: req.params.username
	};
	// check auth
	const auth = await checkAuth(req.cookies, res);
	if (!auth) {
		return;
	}
	// check requested username is current user
	if (req.cookies.username !== params.username) {
		res.status(401).send({ auth: false  });
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
