import axios from "axios";
import { pveAPI, pveAPIToken } from "./db.js";

export async function requestPVE (path, method, cookies, body = null, token = null) {
	const url = `${pveAPI}${path}`;
	const content = {
		method,
		mode: "cors",
		credentials: "include",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		}
	};

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
		const response = await axios.request(url, content);
		return response;
	}
	catch (error) {
		return error.response;
	}
}

export async function handleResponse (node, result, res) {
	const waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
	if (result.data.data && typeof (result.data.data) === "string" && result.data.data.startsWith("UPID:")) {
		const upid = result.data.data;
		let taskStatus = await requestPVE(`/nodes/${node}/tasks/${upid}/status`, "GET", null, null, pveAPIToken);
		while (taskStatus.data.data.status !== "stopped") {
			await waitFor(1000);
			taskStatus = await requestPVE(`/nodes/${node}/tasks/${upid}/status`, "GET", null, null, pveAPIToken);
		}
		if (taskStatus.data.data.exitstatus === "OK") {
			const result = taskStatus.data.data;
			const taskLog = await requestPVE(`/nodes/${node}/tasks/${upid}/log`, "GET", null, null, pveAPIToken);
			result.log = taskLog.data.data;
			res.status(200).send(result);
			res.end();
		}
		else {
			const result = taskStatus.data.data;
			const taskLog = await requestPVE(`/nodes/${node}/tasks/${upid}/log`, "GET", null, null, pveAPIToken);
			result.log = taskLog.data.data;
			res.status(500).send(result);
			res.end();
		}
	}
	else {
		res.status(result.status).send(result.data);
		res.end();
	}
}

export async function getUsedResources (req, resourceMeta) {
	const response = await requestPVE("/cluster/resources", "GET", req.cookies);
	const used = {};
	const diskprefixes = [];
	for (const resourceName of Object.keys(resourceMeta)) {
		if (resourceMeta[resourceName].type === "storage") {
			used[resourceName] = 0;
			for (const diskPrefix of resourceMeta[resourceName].disks) {
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
	for (const instance of response.data.data) {
		if (instance.type === "lxc" || instance.type === "qemu") {
			let config = await requestPVE(`/nodes/${instance.node}/${instance.type}/${instance.vmid}/config`, "GET", req.cookies);
			config = config.data.data;
			for (const key of Object.keys(config)) {
				if (Object.keys(used).includes(key) && resourceMeta[key].type === "numeric") {
					used[key] += Number(config[key]);
				}
				else if (diskprefixes.some(prefix => key.startsWith(prefix))) {
					const diskInfo = await getDiskInfo(instance.node, instance.type, instance.vmid, key);
					if (diskInfo) { // only count if disk exists
						used[diskInfo.storage] += Number(diskInfo.size);
					}
				}
				else if (key.startsWith("net") && config[key].includes("rate=")) { // only count net instances with a rate limit
					used.network += Number(config[key].split("rate=")[1].split(",")[0]);
				}
				else if (key.startsWith("hostpci")) {
					const deviceInfo = await getDeviceInfo(instance.node, instance.type, instance.vmid, config[key].split(",")[0]);
					if (deviceInfo) { // only count if device exists
						used.pci.push(deviceInfo.device_name);
					}
				}
			}
		}
	}
	return used;
}

export async function getDiskInfo (node, type, vmid, disk) {
	try {
		const config = await requestPVE(`/nodes/${node}/${type}/${vmid}/config`, "GET", null, null, pveAPIToken);
		const storageID = config.data.data[disk].split(":")[0];
		const volID = config.data.data[disk].split(",")[0];
		const volInfo = await requestPVE(`/nodes/${node}/storage/${storageID}/content/${volID}`, "GET", null, null, pveAPIToken);
		volInfo.data.data.storage = storageID;
		return volInfo.data.data;
	}
	catch {
		return null;
	}
}

export async function getDeviceInfo (node, type, vmid, qid) {
	try {
		const result = (await requestPVE(`/nodes/${node}/hardware/pci`, "GET", null, null, pveAPIToken)).data.data;
		const deviceData = [];
		result.forEach((element) => {
			if (element.id.startsWith(qid)) {
				deviceData.push(element);
			}
		});
		deviceData.sort((a, b) => {
			return a.id < b.id;
		});
		const device = deviceData[0];
		device.subfn = structuredClone(deviceData.slice(1));
		return device;
	}
	catch {
		return null;
	}
}

export async function getNodeAvailDevices (node, cookies) {
	// get node pci devices
	let nodeAvailPci = (await requestPVE(`/nodes/${node}/hardware/pci`, "GET", cookies, null, pveAPIToken)).data.data;
	// for each node container, get its config and remove devices which are already used
	const vms = (await requestPVE(`/nodes/${node}/qemu`, "GET", cookies, null, pveAPIToken)).data.data;
	for (const vm of vms) {
		const config = (await requestPVE(`/nodes/${node}/qemu/${vm.vmid}/config`, "GET", cookies, null, pveAPIToken)).data.data;
		Object.keys(config).forEach((key) => {
			if (key.startsWith("hostpci")) {
				const deviceID = config[key].split(",")[0];
				nodeAvailPci = nodeAvailPci.filter(element => !element.id.includes(deviceID));
			}
		});
	}
	return nodeAvailPci;
}
