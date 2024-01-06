import { Router } from "express";
export const router = Router({ mergeParams: true }); ;

/**
 * GET - proxy proxmox api without privilege elevation
 * request and responses passed through to/from proxmox
 */
router.get("/*", async (req, res) => { // proxy endpoint for GET proxmox api with no token
	console.log(req.url);
	const path = req.url.replace("/api/proxmox", "");
	const result = await global.pve.requestPVE(path, "GET", { cookies: req.cookies });
	res.status(result.status).send(result.data);
});

/**
 * POST - proxy proxmox api without privilege elevation
 * request and responses passed through to/from proxmox
 */
router.post("/*", async (req, res) => { // proxy endpoint for POST proxmox api with no token
	const path = req.url.replace("/api/proxmox", "");
	const result = await global.pve.requestPVE(path, "POST", { cookies: req.cookies }, JSON.stringify(req.body)); // need to stringify body because of other issues
	res.status(result.status).send(result.data);
});
