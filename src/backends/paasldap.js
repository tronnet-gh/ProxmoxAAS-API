import axios from "axios";
import { AUTH_BACKEND } from "./backends.js";
import * as setCookie from "set-cookie-parser";

export default class PAASLDAP extends AUTH_BACKEND {
	#url = null;

	constructor (config) {
		super();
		this.#url = config.url;
	}

	/**
	 * Send HTTP request to paas-LDAP API.
	 * @param {*} path  HTTP path, prepended with the paas-LDAP API base url
	 * @param {*} method HTTP method
	 * @param {*} body body parameters and data to be sent. Optional.
	 * @returns {Object} HTTP response object or HTTP error object.
	 */
	async #request (path, method, auth = null, body = null) {
		const url = `${this.#url}${path}`;
		const content = {
			method,
			mode: "cors",
			credentials: "include",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded"
			},
			data: body
		};

		if (auth) {
			content.headers.Cookie = `PAASLDAPAuthTicket=${auth.PAASLDAPAuthTicket};`;
		}

		try {
			const result = await axios.request(url, content);
			result.ok = result.status === 200;
			return result;
		}
		catch (error) {
			error.ok = false;
			error.status = 500;
			error.data = {
				error: error.code
			};
			return error;
		}
	}

	async openSession (credentials) {
		const userRealm = credentials.username.split("@").at(-1);
		const uid = credentials.username.replace(`@${userRealm}`, "");
		const content = { uid, password: credentials.password };
		const result = await this.#request("/ticket", "POST", null, content);
		if (result.ok) {
			const cookies = setCookie.parse(result.headers["set-cookie"]);
			cookies.forEach((e) => {
				e.expiresMSFromNow = e.expires - Date.now();
			});
			return {
				ok: true,
				status: result.status,
				cookies
			};
		}
		else {
			return result;
		}
	}

	async addUser (user, attributes, params = null) {
		return await this.#request(`/users/${user.id}`, "POST", params, attributes);
	}

	async getUser (user, params = null) {
		return await this.#request(`/users/${user.id}`, "GET", params);
	}

	async setUser (user, attributes, params = null) {
		return await this.#request(`/users/${user.id}`, "POST", params, attributes);
	}

	async delUser (user, params = null) {
		return await this.#request(`/users/${user.id}`, "DELETE", params);
	}

	async addGroup (group, attributes, params = null) {
		return await this.#request(`/groups/${group.id}`, "POST", params);
	}

	async getGroup (group, params = null) {
		return await this.#request(`/groups/${group.id}`, "GET", params);
	}

	async setGroup (group, attributes, params = null) {
		// not implemented, LDAP groups do not have any attributes to change
	}

	async delGroup (group, params = null) {
		return await this.#request(`/groups/${group.id}`, "DELETE", params);
	}

	async addUserToGroup (user, group, params = null) {
		return await this.#request(`/groups/${group.id}/members/${user.id}`, "POST", params);
	}
	
	async delUserFromGroup (user, group, params = null) {
		return await this.#request(`/groups/${group.id}/members/${user.id}`, "DELETE", params);
	}
}
