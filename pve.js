import axios from 'axios';
import { pveAPI, pveAPIToken } from "./vars.js";

export async function requestPVE(path, method, cookies, body = null, token = null) {
	let url = `${pveAPI}${path}`;
	let content = {
		method: method,
		mode: "cors",
		credentials: "include",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		},
	}

	if (token) {
		content.headers.Authorization = `PVEAPIToken=${token.user}@${token.realm}!${token.id}=${token.uuid}`;
	}
	else if (cookies) {
		content.headers.CSRFPreventionToken = cookies.CSRFPreventionToken;
		content.headers.Cookie = `PVEAuthCookie=${cookies.PVEAuthCookie}; CSRFPreventionToken=${cookies.CSRFPreventionToken}`;
	}

	if (body) {
		content.data = JSON.parse(body);
	}

	try {
		let response = await axios.request(url, content);
		return response;
	}
	catch (error) {
		return error.response;
	}
}

export async function handleResponse(node, result, res) {
	const waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
	if (result.data.data) {
		let upid = result.data.data;
		while (true) {
			let taskStatus = await requestPVE(`/nodes/${node}/tasks/${upid}/status`, "GET", null, null, pveAPIToken);
			if (taskStatus.data.data.status === "stopped" && taskStatus.data.data.exitstatus === "OK") {
				let result = taskStatus.data.data;
				let taskLog = await requestPVE(`/nodes/${node}/tasks/${upid}/log`, "GET", null, null, pveAPIToken);
				result.log = taskLog.data.data;
				res.status(200).send(result);
				res.end();
				return;
			}
			else if (taskStatus.data.data.status === "stopped") {
				let result = taskStatus.data.data;
				let taskLog = await requestPVE(`/nodes/${node}/tasks/${upid}/log`, "GET", null, null, pveAPIToken);
				result.log = taskLog.data.data;
				res.status(500).send(result);
				res.end();
				return;
			}
			else {
				await waitFor(1000);
			}
		}
	}
	else {
		res.status(result.status).send(result.data);
		res.end();	
	}
}

export async function getUsedResources(req, resourceMeta) {
	let response = await requestPVE("/cluster/resources", "GET", req.cookies);
	let used = {};
	let diskprefixes = [];
	for (let resourceName of Object.keys(resourceMeta)) {
		used[resourceName] = 0;
		if (resourceMeta[resourceName].type === "storage") {
			for (let diskPrefix of resourceMeta[resourceName].disks) {
				diskprefixes.push(diskPrefix);
			}
		}
	}
	for (let instance of response.data.data) {
		if (instance.type === "lxc" || instance.type === "qemu") {
			let config = await requestPVE(`/nodes/${instance.node}/${instance.type}/${instance.vmid}/config`, "GET", req.cookies);
			config = config.data.data;
			for (let key of Object.keys(config)) {
				if (Object.keys(used).includes(key) && resourceMeta[key].type === "numeric") {
					used[key] += Number(config[key]);
				}
				else if (diskprefixes.some(prefix => key.startsWith(prefix))) {
					let diskInfo = await getDiskInfo(instance.node, instance.type, instance.vmid, key);
					if (diskInfo) { // only count if disk exists
						used[diskInfo.storage] += Number(diskInfo.size);
					}
				}
				else if (key.startsWith("net")) {
					if (config[key].includes("rate=")) { // only count instances with a rate limit
						used.network += Number(config[key].split("rate=")[1].split(",")[0]);
					}
				}
			}
		}
	}
	return used;
}

export async function getDiskInfo(node, type, vmid, disk) {
	try {
		let config = await requestPVE(`/nodes/${node}/${type}/${vmid}/config`, "GET", null, null, pveAPIToken);
		let storageID = config.data.data[disk].split(":")[0];
		let volID = config.data.data[disk].split(",")[0];
		let volInfo = await requestPVE(`/nodes/${node}/storage/${storageID}/content/${volID}`, "GET", null, null, pveAPIToken);
		volInfo.data.data.storage = storageID;
		return volInfo.data.data;
	}
	catch {
		return null;
	}
}