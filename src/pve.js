import axios from 'axios';
import { pveAPI, pveAPIToken } from "./db.js";

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
	if (result.data.data && typeof (result.data.data) === "string" && result.data.data.startsWith("UPID:")) {
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
		if (resourceMeta[resourceName].type === "storage") {
			used[resourceName] = 0;
			for (let diskPrefix of resourceMeta[resourceName].disks) {
				diskprefixes.push(diskPrefix);
			}
		}
		else if (resourceMeta[resourceName].type === "list") {
			used[resourceName] = [];
		}
		else {
			used[resourceName] = 0;
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
				else if (key.startsWith("net") && config[key].includes("rate=")) { // only count net instances with a rate limit
					used.network += Number(config[key].split("rate=")[1].split(",")[0]);
				}
				else if (key.startsWith("hostpci")) {
					let deviceInfo = await getDeviceInfo(instance.node, instance.type, instance.vmid, config[key].split(",")[0]);
					if (deviceInfo) { // only count if device exists
						used.pci.push(deviceInfo.device_name);
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

export async function getDeviceInfo(node, type, vmid, qid) {
	try {
		let result = (await requestPVE(`/nodes/${node}/hardware/pci`, "GET", null, null, pveAPIToken)).data.data;
		let deviceData = [];
		result.forEach((element) => {
			if (element.id.startsWith(qid)) {
				deviceData.push(element);
			}
		});
		deviceData.sort((a, b) => { return a.id < b.id })
		let device = deviceData[0];
		device.subfn = structuredClone(deviceData.slice(1));
		return device;
	}
	catch {
		return null;
	}
}

export async function getNodeAvailDevices(node, cookies) {
	// get node pci devices
	let nodeAvailPci = (await requestPVE(`/nodes/${node}/hardware/pci`, "GET", cookies, null, pveAPIToken)).data.data;
	// for each node container, get its config and remove devices which are already used
	let vms = (await requestPVE(`/nodes/${node}/qemu`, "GET", cookies, null, pveAPIToken)).data.data;
	for (let vm of vms) {
		let config = (await requestPVE(`/nodes/${node}/qemu/${vm.vmid}/config`, "GET", cookies, null, pveAPIToken)).data.data;
		Object.keys(config).forEach((key) => {
			if (key.startsWith("hostpci")) {
				let device_id = config[key].split(",")[0];
				nodeAvailPci = nodeAvailPci.filter(element => !element.id.includes(device_id));
			}
		});
	}
	return nodeAvailPci;
}