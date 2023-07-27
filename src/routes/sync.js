import { WebSocketServer } from "ws";
import * as cookie from "cookie";

import { Router } from "express";
export const router = Router();

const requestPVE = global.pve.requestPVE;
const checkAuth = global.utils.checkAuth;
const db = global.db;
const pveAPIToken = global.db.pveAPIToken;
const getObjectHash = global.utils.getObjectHash;
const getTimeLeft = global.utils.getTimeLeft;

// maps usernames to socket object(s)
const userSocketMap = {};
// maps pool ids to users
const poolUserMap = {};
// maps sockets to their requested rates
const requestedRates = {};
// stores the next queued interrupt handler
let timer = null;
// previous cluster state for interrupt handler
let prevState = {};
// target ms value
let targetMSTime = null;

const schemes = db.getGlobalConfig().clientsync.schemes;
const resourceTypes = db.getGlobalConfig().clientsync.resourcetypes;
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
		const auth = await checkAuth(req.cookies, res);
		if (!auth) {
			return;
		}
		// get current cluster resources
		const status = (await requestPVE("/cluster/resources", "GET", req.cookies)).data.data;
		// filter out just state information of resources that are needed
		const state = extractClusterState(status, resourceTypes);
		res.status(200).send(getObjectHash(state));
	});
	console.log("clientsync: enabled hash sync");
}

// setup interupt scheme
if (schemes.interrupt.enabled) {
	const wsServer = new WebSocketServer({ noServer: true, path: "/api/sync/interrupt" });
	wsServer.on("connection", (socket, username, pool) => {
		// add new socket to userSocketmap
		if (userSocketMap[username]) {
			const index = Object.keys(userSocketMap[username]).length;
			userSocketMap[username][index] = socket;
			socket.userIndex = index;
		}
		else {
			userSocketMap[username] = { 0: socket };
			socket.userIndex = 0;
		}
		// add user to associated pool in poolUserMap
		if (poolUserMap[pool]) {
			poolUserMap[pool][username] = true;
		}
		else {
			poolUserMap[pool] = {};
			poolUserMap[pool][username] = true;
		}
		// add socket entry into requestedRates
		const index = Object.keys(requestedRates).length;
		requestedRates[index] = Infinity;
		socket.rateIndex = index;
		// handle socket error
		socket.on("error", console.error);
		// handle socket close
		socket.on("close", () => {
			// remove closed socket from userSocketMap user entry
			delete userSocketMap[username][socket.userIndex];
			// if there are no more sockets for this user, delete the userSocketMap user entry and the poolUserMap user entry
			if (Object.keys(userSocketMap[username]).length === 0) {
				// delete the user entry
				delete userSocketMap[username];
				// remove user from poolUserMap pool entry
				delete poolUserMap[pool][username];
				// if the poolUserMap pool entry is empty, delete the entry
				if (Object.keys(poolUserMap[pool]).length === 0) {
					delete poolUserMap[pool];
				}
			}
			// remove socket entry from requestedRates
			delete requestedRates[socket.rateIndex];
			if (Object.keys(requestedRates).length === 0) { // if there are no requested rates left, clear the timer
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
			if (cmd === "rate" && parsed[1] >= schemes.interrupt["min-rate"] && parsed[1] <= schemes.interrupt["max-rate"]) {
				// get requested rate in ms
				const rate = Number(parsed[1]) * 1000;
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
				else if (rate < Math.min.apply(null, Object.values(requestedRates)) && getTimeLeft(timer) > rate) {
					clearTimeout(timer);
					timer = setTimeout(handleInterruptSync, rate);
					const time = global.process.uptime();
					targetMSTime = time - Math.floor(time);
				}
				// otherwise just add the rate to the list, when the next even trigger happens it will be requeued with the new requested rates
				requestedRates[socket.rateIndex] = rate;
			}
			// command is rate but the requested value is out of bounds, terminate socket
			else if (cmd === "rate") {
				socket.send(`error: rate must be in range [${schemes.interrupt["min-rate"]}, ${schemes.interrupt["max-rate"]}].`);
				socket.terminate();
			}
			// otherwise, command is invalid, terminate socket
			else {
				socket.send(`error: ${cmd} command not found.`);
				socket.terminate();
			}
		});
	});
	// handle the wss upgrade request
	global.server.on("upgrade", async (req, socket, head) => {
		const cookies = cookie.parse(req.headers.cookie || "");
		const auth = (await requestPVE("/version", "GET", cookies)).status === 200;
		if (!auth) {
			socket.destroy();
		}
		else {
			wsServer.handleUpgrade(req, socket, head, (socket) => {
				const pool = db.getUserConfig(cookies.username).cluster.pool;
				wsServer.emit("connection", socket, cookies.username, pool);
			});
		}
	});
	const handleInterruptSync = async () => {
		// queue timeout for next iteration with delay of minimum rate
		const minRequestedRate = Math.min.apply(null, Object.values(requestedRates));
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
		const status = (await requestPVE("/cluster/resources", "GET", null, null, pveAPIToken)).data.data;
		// filter out just state information of resources that are needed, and hash each one
		const currState = extractClusterState(status, resourceTypes, true);
		// get a map of users to send sync notifications
		const syncUsers = {};
		// for each current resource in the cluster, check for state changes
		Object.keys(currState).forEach((resource) => {
			// if the resource's current state has changed, add all relevant users to syncUsers
			const resourceCurrState = currState[resource];
			const resourcePrevState = prevState[resource];
			// if the previous state did not exist, or the status or pool have changed, then a resource state was added or modified
			if (!resourcePrevState || resourceCurrState.hash !== resourcePrevState.hash) {
				// if the resource is a node, send sync to all users
				if (resourceCurrState.type === "node") {
					Object.keys(userSocketMap).forEach((user) => {
						syncUsers[user] = true;
					});
				}
				// if the resource is qemu or lxc, send sync to users in the same pool if there is a pool and if the pool has users
				else if (resourceCurrState.pool && poolUserMap[resourceCurrState.pool]) {
					Object.keys(poolUserMap[resourceCurrState.pool]).forEach((user) => {
						syncUsers[user] = true;
					});
				}
			}
		});
		// for each previous resource in the cluster, check for state changes
		Object.keys(prevState).forEach((resource) => {
			const resourceCurrState = currState[resource];
			const resourcePrevState = prevState[resource];
			// if the resource no longer exists in the current state, then it is lost or deleted
			if (!resourceCurrState) {
				// if the resource is a node, send sync to all users
				if (resourcePrevState.type === "node") {
					Object.keys(userSocketMap).forEach((user) => {
						syncUsers[user] = true;
					});
				}
				// if the resource is qemu or lxc, send sync to users in the same pool if there is a pool and if the pool has users
				else if (resourcePrevState.pool && poolUserMap[resourcePrevState.pool]) {
					Object.keys(poolUserMap[resourcePrevState.pool]).forEach((user) => {
						syncUsers[user] = true;
					});
				}
			}
		});
		// for each user in syncUsers, send a sync message over their registered sockets
		for (const user of Object.keys(syncUsers)) {
			for (const socket of Object.keys(userSocketMap[user])) {
				userSocketMap[user][socket].send("sync");
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
				const hash = getObjectHash(state[resource.id]);
				state[resource.id].hash = hash;
			}
		}
	});
	return state;
}
