import axios from "axios";
import { ACCESS_BACKEND } from "./backends.js";
import * as setCookie from "set-cookie-parser";

export default class ACCESS_MANAGER_API extends ACCESS_BACKEND {
	#apiURL = null;

	constructor (config) {
		super();
		this.#apiURL = config.url;
	}

	/**
	 * Send HTTP request to paas-LDAP API.
	 * @param {*} path  HTTP path, prepended with the paas-LDAP API base url
	 * @param {*} method HTTP method
	 * @param {*} auth HTTP auth cookies
	 * @param {*} body body parameters and data to be sent. Optional.
	 * @returns {Object} HTTP response object
	 */
	async #requestAPI (path, method, auth = null, body = null) {
		const url = `${this.#apiURL}${path}`;
		const content = {
			method,
			mode: "cors",
			credentials: "include",
			headers: {
				"Content-Type": "application/json"
			},
			data: body
		};

		if (auth) {
			content.headers.Cookie = `PAASAccessManagerTicket=${auth.PAASAccessManagerTicket};`;
		}

		try {
			const result = await axios.request(url, content);
			return {
				ok: result.status === 200,
				status: result.status,
				data: result.data,
				headers: result.headers
			};
		}
		catch (error) {
			console.log(`access: error ocuured in access.requestAPI: ${method} ${path} resulted in ${error}`);
			const result = error.response;
			result.ok = result.status === 200;
			return result;
		}
	}

	async openSession (user, password) {
		const credentials = { username: `${user.id}@${user.realm}`, password };
		const response = await this.#requestAPI("/ticket", "POST", null, credentials);
		if (response.ok) {
			const cookies = setCookie.parse(response.headers["set-cookie"]);
			cookies.forEach((e) => {
				e.expiresMSFromNow = e.expires - Date.now();
			});
			return {
				ok: true,
				status: response.status,
				message: "",
				cookies
			};
		}
		else {
			return {
				ok: false,
				status: response.status,
				message: response.data.error,
				cookies: []
			};
		}
	}

	async closeSession(tokens) {
		const response = await this.#requestAPI("/ticket", "DELETE", tokens);
		return response;
	}

	async addUser (_user, _attributes, _params) {}

	async getUser (user, params) {
		const response = await this.#requestAPI(`/users/${user.id}@${user.realm}`, "GET", params);
		if (response.ok) { // if ok, return user data
			return {
				ok: true,
				status: response.status,
				user: response.data.user
			};
		}
		else { // else return null
			return {
				ok: false,
				status: response.status,
				message: response.data.error
			};
		}
	}

	async setUser (_user, _attributes, _params) {}

	async delUser (_user, _params) {}

	async addGroup (_group, _attributes, _params) {}

	async getGroup (group, params) {
		const response = await this.#requestAPI(`/groups/${group.id}-${group.realm}`, "GET", params);
		if (response.ok) { // if ok, return user data
			return {
				ok: true,
				status: response.status,
				group: response.data.group
			};
		}
		else { // else return null
			return {
				ok: false,
				status: response.status,
				message: response.data.error
			};
		}
	}

	async setGroup (_group, _attributes, _params) {}

	async delGroup (_group, _attributes, _params) {}

	async addUserToGroup (_user, _group, _params) {}

	async delUserFromGroup (_user, _group, _params) {}

	async addPool (_pool, _attributes, _params) {}

	async getPool (pool, params) {
		const response = await this.#requestAPI(`/pools/${pool}`, "GET", params);
		if (response.ok) { // if ok, return user data
			return {
				ok: true,
				status: response.status,
				pool: response.data.pool
			};
		}
		else { // else return null
			return {
				ok: false,
				status: response.status,
				message: response.data.error
			};
		}
	}

	async setPool (_pool, _attributes, _params) {}

	async delPool (_pool, _params) {}

	async addGroupToPool (_group, _pool, _params) {}

	async delGroupFromPool (_group, _pool, _params) {}
}