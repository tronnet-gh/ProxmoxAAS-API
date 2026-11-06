import { WebSocketServer } from "ws";
import * as cookie from "cookie";

import { Router } from "express";
export const router = Router({ mergeParams: true });

// open interrupt sockets, each socket stores the pools its user can see (socket.pools) and its requested rate in ms (socket.rate)
const sockets = new Set();
// stores the next queued interrupt handler
let timer = null;
// previous cluster state for interrupt handler
let prevState = {};
// target ms value
let targetMSTime = null;

const schemes = global.config.clientsync.schemes;
const resourceTypes = global.config.clientsync.resourcetypes;
/**
 * GET - get list of supported synchronization schemes
 * responses:
 * - 200 : {always: boolean, hash: boolean, interrupt: boolean}
 */
router.get("/schemes", async (req, res) => {
	res.send(schemes);
});

if (schemes.always.enabled) {
	console.log("clientsync: enabled always sync");
}

// setup hash scheme
if (schemes.hash.enabled) {
	/**
	 * GET - get hash of current cluster resources states
	 * Client can use this endpoint to check for cluster state changes to avoid costly data transfers to the client.
	 * responses:
	 * - 401: {auth: false}
	 * - 200: string
	 */
	router.get("/hash", async (req, res) => {
		// check auth
		const auth = await global.utils.checkAuth(req.cookies, res);
		if (!auth) {
			return;
		}
		// get current cluster resources - do not use fabric here because fabric is not always updated to changes like up/down state changes
		const status = (await global.pve.requestPVE("/cluster/resources", "GET", { cookies: req.cookies })).data;
		// filter out just state information of resources that are needed
		const state = extractClusterState(status, resourceTypes);
		res.status(200).send(global.utils.getObjectHash(state));
	});
	console.log("clientsync: enabled hash sync");
}

// setup interupt scheme
if (schemes.interrupt.enabled) {
	const wsServer = new WebSocketServer({ noServer: true, path: "/api/sync/interrupt" });
	// get the minimum rate requested by any open socket, Infinity if no socket has requested a rate
	const getMinRequestedRate = () => Math.min(Infinity, ...Array.from(sockets, (s) => s.rate));
	wsServer.on("connection", (socket, pools) => {
		// register the socket with the pools its user can see, it has no requested rate until it sends one
		socket.pools = pools;
		socket.rate = Infinity;
		sockets.add(socket);
		// handle socket error
		socket.on("error", console.error);
		// handle socket close
		socket.on("close", () => {
			// remove closed socket
			sockets.delete(socket);
			if (sockets.size === 0) { // if there are no sockets left, clear the timer
				clearTimeout(timer);
				timer = null;
				targetMSTime = null;
			}
			// terminate socket
			socket.terminate();
		});
		// handle socket incoming message
		socket.on("message", (message) => {
			const parsed = message.toString().split(" ");
			const cmd = parsed[0];
			// command is rate and the value is valid
			if (cmd === "rate" && parsed.length === 2 && parsed[1] >= schemes.interrupt["min-rate"] && parsed[1] <= schemes.interrupt["max-rate"]) {
				// get requested rate in ms
				const rate = Number(parsed[1]) * 1000;
				if (isNaN(rate)) {
					socket.send("error: rate <rate> must be a number");
					socket.terminate();
					return;
				}
				// if timer has not started, start it with requested rate
				if (!timer) {
					timer = setTimeout(handleInterruptSync, rate);
					const time = global.process.uptime();
					targetMSTime = time - Math.floor(time);
				}
				// otherwise, if the timer has started but the rate is lower than the current minimum
				// AND if the next event trigger is more than the new rate in the future,
				// restart the timer with the new rate
				// avoids a large requested rate preventing a faster rate from being fulfilled
				else if (rate < getMinRequestedRate() && global.utils.getTimeLeft(timer) > rate) {
					clearTimeout(timer);
					timer = setTimeout(handleInterruptSync, rate);
					const time = global.process.uptime();
					targetMSTime = time - Math.floor(time);
				}
				// otherwise just add the rate to the list, when the next even trigger happens it will be requeued with the new requested rates
				socket.rate = rate;
			}
			// command is rate but the requested value is out of bounds, terminate socket
			else if (cmd === "rate") {
				socket.send(`error: rate <rate> must be in range [${schemes.interrupt["min-rate"]}, ${schemes.interrupt["max-rate"]}].`);
				socket.terminate();
			}
			// otherwise, command is invalid, terminate socket
			else {
				socket.send(`error: ${cmd} command not supported.`);
				socket.terminate();
			}
		});
	});
	// handle the wss upgrade request
	global.server.on("upgrade", async (req, socket, head) => {
		// basic auth validation
		const cookies = cookie.parse(req.headers.cookie || "");
		const auth = (await global.pve.requestPVE("/version", "GET", { cookies })).status === 200;
		if (!auth) {
			socket.destroy();
		}
		else {
			// use user cookies to determine which pools they can see, lazily assume that if a user can audit a pool they are also can audit pool member state
			// fetch pools before upgrading so the connection handler attaches its listeners as soon as the socket opens,
			// otherwise the client's rate message can arrive before the message listener exists and be dropped
			const pools = await global.pve.requestPVE("/pools", "GET", { cookies });
			const poolIDs = pools.status === 200 ? pools.data.map((p) => p.poolid) : [];
			wsServer.handleUpgrade(req, socket, head, (socket) => {
				// emit the connection to initialize socket
				wsServer.emit("connection", socket, poolIDs);
			});
		}
	});
	const handleInterruptSync = async () => {
		// queue timeout for next iteration with delay of minimum rate
		const minRequestedRate = getMinRequestedRate();
		// if the minimum rate is not Infinity, schedule the next timer
		if (minRequestedRate < Infinity) {
			const time = global.process.uptime() - targetMSTime;
			const delay = (time - Math.round(time)) * 1000;
			timer = setTimeout(handleInterruptSync, minRequestedRate - delay);
		}
		// if the minimum rate is Infinity, then don't schedule anything and set timer to null
		else {
			timer = null;
			targetMSTime = null;
			return;
		}
		// get current cluster resources
		const status = (await global.pve.requestPVE("/cluster/resources", "GET", { token: true })).data;
		// filter out just state information of resources that are needed, and hash each one
		const currState = extractClusterState(status, resourceTypes, true);
		// a changed node syncs every socket, a changed qemu or lxc syncs sockets that can see its pool
		let syncAll = false;
		const syncPools = new Set();
		// for each current resource in the cluster, check for state changes
		Object.keys(currState).forEach((resource) => {
			const resourceCurrState = currState[resource];
			const resourcePrevState = prevState[resource];
			// if the previous state did not exist, or the status or pool have changed, then a resource state was added or modified
			if (!resourcePrevState || resourceCurrState.hash !== resourcePrevState.hash) {
				if (resourceCurrState.type === "node") {
					syncAll = true;
				}
				else if (resourceCurrState.pool) {
					syncPools.add(resourceCurrState.pool);
				}
			}
		});
		// for each previous resource in the cluster, check for state changes
		Object.keys(prevState).forEach((resource) => {
			const resourceCurrState = currState[resource];
			const resourcePrevState = prevState[resource];
			// if the resource no longer exists in the current state, then it is lost or deleted
			if (!resourceCurrState) {
				if (resourcePrevState.type === "node") {
					syncAll = true;
				}
				else if (resourcePrevState.pool) {
					syncPools.add(resourcePrevState.pool);
				}
			}
		});
		// send a sync message over each socket whose user can see a changed resource
		for (const socket of sockets) {
			if (syncAll || socket.pools.some((pool) => syncPools.has(pool))) {
				socket.send("sync");
			}
		}
		// set prevState for next iteration
		prevState = currState;
	};
	console.log("clientsync: enabled interrupt sync");
}

function extractClusterState (status, resourceTypes, hashIndividual = false) {
	const state = {};
	status.forEach((resource) => {
		if (resourceTypes.includes(resource.type)) {
			state[resource.id] = {
				name: resource.name || null,
				type: resource.type,
				status: resource.status,
				node: resource.node,
				pool: resource.pool || null
			};
			if (hashIndividual) {
				const hash = global.utils.getObjectHash(state[resource.id]);
				state[resource.id].hash = hash;
			}
		}
	});
	return state;
}
