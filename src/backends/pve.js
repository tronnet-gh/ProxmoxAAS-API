import axios from "axios";
import { PVE_BACKEND } from "./backends.js";

export default class PVE extends PVE_BACKEND {
	#pveAPIURL = null;
	#pveAPIToken = null;
	#pveRoot = null;
	#paasFabric = null;

	constructor (config) {
		super();
		this.#pveAPIURL = config.url;
		this.#pveAPIToken = config.token;
		this.#pveRoot = config.root;
		this.#paasFabric = config.fabric;
	}

	async openSession (user, password) {
		const credentials = { username: `${user.id}@${user.realm}`, password };
		const response = await global.pve.requestPVE("/access/ticket", "POST", null, credentials);
		if (!(response.status === 200)) {
			return {
				ok: false,
				status: response.status,
				message: "Authorization failed",
				cookies: []
			};
		}
		const ticket = response.data.data.ticket;
		const csrftoken = response.data.data.CSRFPreventionToken;
		return {
			ok: true,
			status: response.status,
			cookies: [
				{
					name: "PVEAuthCookie",
					value: ticket,
					expiresMSFromNow: 2 * 60 * 60 * 1000
				},
				{
					name: "CSRFPreventionToken",
					value: csrftoken,
					expiresMSFromNow: 2 * 60 * 60 * 1000
				}
			]
		};
	}

	/**
	 * Send HTTP request to proxmox API. Allows requests to be made with user cookie credentials or an API token for controlled priviledge elevation.
	 * @param {string} path HTTP path, prepended with the proxmox API base url.
	 * @param {string} method HTTP method.
	 * @param {Object} auth authentication method. Set auth.cookies with user cookies or auth.token with PVE API Token. Optional.
	 * @param {string} body body parameters and data to be sent. Optional.
	 * @returns {Object} HTTP response object or HTTP error object.
	 */
	async requestPVE (path, method, auth = null, body = null) {
		const url = `${this.#pveAPIURL}${path}`;
		const content = {
			method,
			mode: "cors",
			credentials: "include",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded"
			},
			data: body
		};

		if (auth && auth.cookies) {
			content.headers.CSRFPreventionToken = auth.cookies.CSRFPreventionToken;
			content.headers.Cookie = `PVEAuthCookie=${auth.cookies.PVEAuthCookie}; CSRFPreventionToken=${auth.cookies.CSRFPreventionToken}`;
		}
		else if (auth && auth.token) {
			const token = this.#pveAPIToken;
			content.headers.Authorization = `PVEAPIToken=${token.user}@${token.realm}!${token.id}=${token.uuid}`;
		}
		else if (auth && auth.root) {
			const rootauth = await global.pve.requestPVE("/access/ticket", "POST", null, this.#pveRoot);
			if (!(rootauth.status === 200)) {
				return rootauth.response;
			}
			const rootcookie = rootauth.data.data.ticket;
			const rootcsrf = rootauth.data.data.CSRFPreventionToken;
			content.headers.CSRFPreventionToken = rootcsrf;
			content.headers.Cookie = `PVEAuthCookie=${rootcookie}; CSRFPreventionToken=${rootcsrf}`;
		}

		try {
			return await axios.request(url, content);
		}
		catch (error) {
			console.log(`backends: error ocuured in pve.requestPVE: ${error}`);
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
	async handleResponse (node, result, res) {
		const waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
		if (result.status !== 200) {
			res.status(result.status).send({ error: result.statusText });
			res.end();
		}
		else if (result.data.data && typeof (result.data.data) === "string" && result.data.data.startsWith("UPID:")) {
			const upid = result.data.data;
			let taskStatus = await this.requestPVE(`/nodes/${node}/tasks/${upid}/status`, "GET", { token: true });
			while (taskStatus.data.data.status !== "stopped") {
				await waitFor(100);
				taskStatus = await this.requestPVE(`/nodes/${node}/tasks/${upid}/status`, "GET", { token: true });
			}
			if (taskStatus.data.data.exitstatus === "OK") {
				const result = taskStatus.data.data;
				const taskLog = await this.requestPVE(`/nodes/${node}/tasks/${upid}/log`, "GET", { token: true });
				result.log = taskLog.data.data;
				res.status(200).send(result);
				res.end();
			}
			else {
				const result = taskStatus.data.data;
				const taskLog = await this.requestPVE(`/nodes/${node}/tasks/${upid}/log`, "GET", { token: true });
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
	 * Send HTTP request to PAAS Fabric
	 * @param {string} path HTTP path, prepended with the proxmox API base url.
	 * @param {string} method HTTP method.
	 * @param {Object} auth authentication method. Set auth.cookies with user cookies or auth.token with PVE API Token. Optional.
	 * @param {string} body body parameters and data to be sent. Optional.
	 * @returns {Object} HTTP response object or HTTP error object.
	 */
	async requestFabric (path, method, body = null) {
		const url = `${this.#paasFabric}${path}`;
		const content = {
			method,
			mode: "cors",
			credentials: "include",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded"
			},
			data: body
		};

		try {
			return await axios.request(url, content);
		}
		catch (error) {
			return error;
		}
	}

	async getNode (node) {
		const res = await this.requestFabric(`/nodes/${node}`, "GET");
		if (res.status !== 200) {
			console.error(res);
			return null;
		}

		return res.data.node;
	}

	async syncNode (node) {
		this.requestFabric(`/nodes/${node}/sync`, "POST");
	}

	async getInstance (node, instance) {
		const res = await this.requestFabric(`/nodes/${node}/instances/${instance}`, "GET");
		if (res.status !== 200) {
			console.error(res);
			return null;
		}

		return res.data.instance;
	}

	async syncInstance (node, vmid) {
		this.requestFabric(`/nodes/${node}/instances/${vmid}/sync`, "POST");
	}

	async getDisk (node, instance, disk) {
		const config = await this.getInstance(node, instance);
		if (config != null && config.volumes[disk] != null) {
			return config.volumes[disk];
		}
		else {
			return null;
		}
	}

	async getNet (node, instance, netid) {
		const config = await this.getInstance(node, instance);
		if (config != null && config.nets[netid] != null) {
			return config.nets[netid];
		}
		else {
			return null;
		}
	}

	async getDevice (node, instance, deviceid) {
		const config = await this.getInstance(node, instance);
		if (config != null && config.devices[deviceid] != null) {
			return config.devices[deviceid];
		}
		else {
			return null;
		}
	}

	async getUserResources (user, cookies) {
		// get user resources with vm filter
		const res = await this.requestPVE("/cluster/resources?type=vm", "GET", { cookies });
		if (res.status !== 200) {
			return null;
		}

		const userPVEResources = res.data.data;

		const resources = {};

		// for each resource, add to the object
		for (const resource of userPVEResources) {
			const instance = await this.getInstance(resource.node, resource.vmid);
			if (instance) {
				instance.node = resource.node;
				resources[resource.vmid] = instance;
			}
		}

		return resources;
	}
}
