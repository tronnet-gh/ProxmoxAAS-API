import axios from "axios";

/**
 * Send HTTP request to proxmox API. Allows requests to be made with user cookie credentials or an API token for controlled priviledge elevation.
 * @param {string} path HTTP path, prepended with the proxmox API base path.
 * @param {string} method HTTP method.
 * @param {Object} auth authentication method. Set auth.cookies with user cookies or auth.token with PVE API Token. Optional.
 * @param {string} body body parameters and data to be sent. Optional.
 * @returns {Object} HTTP response object or HTTP error object.
 */
export async function requestPVE (path, method, auth = null, body = null) {
	const pveAPI = global.db.pveAPI;
	const url = `${pveAPI}${path}`;
	const content = {
		method,
		mode: "cors",
		credentials: "include",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		}
	};

	if (auth && auth.cookies) {
		content.headers.CSRFPreventionToken = auth.cookies.CSRFPreventionToken;
		content.headers.Cookie = `PVEAuthCookie=${auth.cookies.PVEAuthCookie}; CSRFPreventionToken=${auth.cookies.CSRFPreventionToken}`;
	}
	else if (auth && auth.token) {
		content.headers.Authorization = `PVEAPIToken=${auth.token.user}@${auth.token.realm}!${auth.token.id}=${auth.token.uuid}`;
	}

	if (body) {
		content.data = JSON.parse(body);
	}

	try {
		return await axios.request(url, content);
	}
	catch (error) {
		return error.response;
	}
}

/**
 * Handle various proxmox API responses. Handles sync and async responses.
 * In sync responses, responses are completed when the response arrives. Method returns the response directly.
 * In async responses, proxmox sends responses with a UPID to track process completion. Method returns the status of the proxmox process once it completes.
 * @param {string} node response originates from.
 * @param {Object} result response from proxmox.
 * @param {Object} res response object of ProxmoxAAS API call.
 */
export async function handleResponse (node, result, res) {
	const pveAPIToken = global.db.pveAPIToken;
	const waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
	if (result.data.data && typeof (result.data.data) === "string" && result.data.data.startsWith("UPID:")) {
		const upid = result.data.data;
		let taskStatus = await requestPVE(`/nodes/${node}/tasks/${upid}/status`, "GET", { token: pveAPIToken });
		while (taskStatus.data.data.status !== "stopped") {
			await waitFor(1000);
			taskStatus = await requestPVE(`/nodes/${node}/tasks/${upid}/status`, "GET", { token: pveAPIToken });
		}
		if (taskStatus.data.data.exitstatus === "OK") {
			const result = taskStatus.data.data;
			const taskLog = await requestPVE(`/nodes/${node}/tasks/${upid}/log`, "GET", { token: pveAPIToken });
			result.log = taskLog.data.data;
			res.status(200).send(result);
			res.end();
		}
		else {
			const result = taskStatus.data.data;
			const taskLog = await requestPVE(`/nodes/${node}/tasks/${upid}/log`, "GET", { token: pveAPIToken });
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

/**
 * Get meta data for a specific disk. Adds info that is not normally available in a instance's config.
 * @param {string} node containing the query disk.
 * @param {string} config of instance with query disk.
 * @param {string} disk name of the query disk, ie. sata0.
 * @returns {Objetc} k-v pairs of specific disk data, including storage and size of unused disks.
 */
export async function getDiskInfo (node, config, disk) {
	const pveAPIToken = global.db.pveAPIToken;
	try {
		const storageID = config[disk].split(":")[0];
		const volID = config[disk].split(",")[0];
		const volInfo = await requestPVE(`/nodes/${node}/storage/${storageID}/content/${volID}`, "GET", { token: pveAPIToken });
		volInfo.data.data.storage = storageID;
		return volInfo.data.data;
	}
	catch {
		return null;
	}
}

/**
 * Get meta data for a specific pci device. Adds info that is not normally available in a instance's config.
 * @param {string} node containing the query device.
 * @param {string} qid pci bus id number of the query device, ie. 89ab:cd:ef.0.
 * @returns {Object} k-v pairs of specific device data, including device name and manufacturer.
 */
export async function getDeviceInfo (node, qid) {
	const pveAPIToken = global.db.pveAPIToken;
	try {
		const result = (await requestPVE(`/nodes/${node}/hardware/pci`, "GET", { token: pveAPIToken })).data.data;
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

/**
 * Get available devices on specific node.
 * @param {string} node to get devices from.
 * @returns {Array.<Object>} array of k-v pairs of specific device data, including device name and manufacturer, which are available on the specified node.
 */
export async function getNodeAvailDevices (node) {
	const pveAPIToken = global.db.pveAPIToken;
	// get node pci devices
	let nodeAvailPci = requestPVE(`/nodes/${node}/hardware/pci`, "GET", { token: pveAPIToken });
	// for each node container, get its config and remove devices which are already used
	const vms = (await requestPVE(`/nodes/${node}/qemu`, "GET", { token: pveAPIToken })).data.data;

	const promises = [];
	for (const vm of vms) {
		promises.push(requestPVE(`/nodes/${node}/qemu/${vm.vmid}/config`, "GET", { token: pveAPIToken }));
	}
	const configs = await Promise.all(promises);
	configs.forEach((e, i) => {
		configs[i] = e.data.data;
	});

	nodeAvailPci = (await nodeAvailPci).data.data;

	for (const config of configs) {
		Object.keys(config).forEach((key) => {
			if (key.startsWith("hostpci")) {
				const deviceID = config[key].split(",")[0];
				nodeAvailPci = nodeAvailPci.filter(element => !element.id.includes(deviceID));
			}
		});
	}
	return nodeAvailPci;
}
