import { WebSocketServer } from "ws";
import * as cookie from "cookie";

import { requestPVE } from "./pve.js";
import { checkAuth, getObjectHash } from "./utils.js";

// maps usernames to socket object(s)
const userSocketMap = {};
// maps proxmox resource ids to user(s) who can access the resource
const resourceUserMap = {};

export function setupClientSync (app, server, schemes) {
	/**
	 * GET - get list of supported synchronization schemes
	 * responses:
	 * - 200 : {always: boolean, hash: boolean, interrupt: boolean}
	 */
	app.get("/api/sync/schemes", async (req, res) => {
		res.send(schemes);
	});

	if (schemes.hash) {
		/**
		 * GET - get hash of current cluster resources states
		 * Client can use this endpoint to check for cluster state changes to avoid costly data transfers to the client.
		 * responses:
		 * - 401: {auth: false}
		 * - 200: string
		 */
		app.get("/api/sync/hash", async (req, res) => {
			// check auth
			const auth = await checkAuth(req.cookies, res);
			if (!auth) {
				return;
			}
			// get current cluster resources
			const status = (await requestPVE("/cluster/resources", "GET", req.cookies)).data.data;
			// filter out just state information of resources that are needed
			const resources = ["lxc", "qemu", "node"];
			const state = {};
			status.forEach((element) => {
				if (resources.includes(element.type)) {
					state[element.id] = element.status;
				}
			});
			res.status(200).send(getObjectHash(state));
		});
	}
	if (schemes.interrupt) {
		const wsServer = new WebSocketServer({ noServer: true, path: "/api/sync/interrupt" });
		wsServer.on("connection", (socket, username) => {
			socket.on("message", (message) => {
				console.log(message.toString());
			});
		});
		server.on("upgrade", async (req, socket, head) => {
			const cookies = cookie.parse(req.headers.cookie || "");
			const auth = (await requestPVE("/version", "GET", cookies)).status === 200;
			if (!auth) {
				socket.destroy();
			}
			else {
				wsServer.handleUpgrade(req, socket, head, (socket) => {
					wsServer.emit("connection", socket, cookies.username);
				});
			}
		});
	}
}
