const axios = require('axios');
const {pveAPI, pveAPIToken} = require("./vars.js");

async function checkAuth (cookies, vmpath = null) {
	if (vmpath) {
		let result = await requestPVE(`/${vmpath}/config`, "GET", cookies);
		return result.status === 200;
	}
	else { // if no path is specified, then do a simple authentication
		let result = await requestPVE("/version", "GET", cookies);
		return result.status === 200;
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

async function handleResponse (node, response) {
	const waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
	if (response.data.data) {
		let upid = response.data.data;
		while (true) {
			let taskStatus = await requestPVE(`/nodes/${node}/tasks/${upid}/status`, "GET", null, null, pveAPIToken);
			if (taskStatus.data.data.status === "stopped" && taskStatus.data.data.exitstatus === "OK") {
				return {status: 200, data: taskStatus.data.data};
			}
			else if (taskStatus.data.data.status === "stopped") {
				return {status: 500, data: taskStatus.data.data};
			}
			else {
				await waitFor(1000);
			}
		}
	}
	else {
		return response;
	}
}

async function getUnusedDiskData (node, disk) {
	let storageID = disk.split(":")[0];
	let storageData = await requestPVE(`/nodes/${node}/storage/${storageID}/content`, "GET", null, null, pveAPIToken);
	storageData.data.forEach((element) => {
		if (element.volid === disk) {
			return element;
		}
	});
	return null;
}

async function getDiskConfig (node, type, vmid, disk) {
	let config = await requestPVE(`/nodes/${node}/${type}/${vmid}/config`, "GET", null, null, pveAPIToken);

	return config.data.data[disk];
}

module.exports = {checkAuth, requestPVE, handleResponse, getUnusedDiskData, getDiskConfig};