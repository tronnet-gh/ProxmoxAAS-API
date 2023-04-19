const axios = require('axios');
const {pveAPI, pveAPIToken} = require("./vars.js");

async function checkAuth (cookies, res, vmpath = null) {
	let auth = false;
	if (vmpath) {
		let result = await requestPVE(`/${vmpath}/config`, "GET", cookies);
		auth = result.status === 200;
	}
	else { // if no path is specified, then do a simple authentication
		let result = await requestPVE("/version", "GET", cookies);
		auth = result.status === 200;
	}
	if (!auth) {
		res.status(401).send({auth: auth});
		res.end();
		return;
	}
}

async function requestPVE (path, method, cookies, body = null, token = null) {
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

async function handleResponse (node, result, res) {
	const waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
	if (result.data.data) {
		let upid = result.data.data;
		while (true) {
			let taskStatus = await requestPVE(`/nodes/${node}/tasks/${upid}/status`, "GET", null, null, pveAPIToken);
			if (taskStatus.data.data.status === "stopped" && taskStatus.data.data.exitstatus === "OK") {
				res.status(200).send(taskStatus.data.data);
				res.end();
				return;
			}
			else if (taskStatus.data.data.status === "stopped") {
				res.status(500).send(taskStatus.data.data);
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
		return;
	}
}

async function getUsedResources (req, resourceMeta) {
	let response = await requestPVE("/cluster/resources", "GET", req.cookies);
	let used = {};
	let diskprefixes = [];
	for (let resourceName of Object.keys(resourceMeta)) {
		if (resourceMeta[resourceName].type === "numeric") {
			used[resourceName] = 0;
		}
		else if (resourceMeta[resourceName].type === "disk") {
			resourceMeta[resourceName].storages.forEach((element) => {
				used[element] = 0;
			});
			diskprefixes.push(resourceName);
		}
	}
	for (instance of response.data.data) {
		if (instance.type === "lxc" || instance.type === "qemu") {
			let config = await requestPVE(`/nodes/${instance.node}/${instance.type}/${instance.vmid}/config`, "GET", req.cookies);
			config = config.data.data;
			for (key of Object.keys(config)) {
				if (Object.keys(used).includes(key) && resourceMeta[key].type === "numeric") {					
					used[key] += config[key];
				}
				else if (diskprefixes.some(prefix => key.startsWith(prefix))) {
					let diskInfo = await getDiskInfo(instance.node, instance.type, instance.vmid, key);
					used[diskInfo.storage] += diskInfo.size;
				}
			}
		}
	}
	return used;
}

async function getDiskInfo (node, type, vmid, disk) {
	let config = await requestPVE(`/nodes/${node}/${type}/${vmid}/config`, "GET", null, null, pveAPIToken);
	let storageID = config.data.data[disk].split(":")[0];
	let volID = config.data.data[disk].split(",")[0];
	let volInfo = await requestPVE(`/nodes/${node}/storage/${storageID}/content/${volID}`, "GET", null, null, pveAPIToken);
	volInfo.data.data.storage = storageID;
	return volInfo.data.data;
}

module.exports = {checkAuth, requestPVE, handleResponse, getUsedResources, getDiskInfo};