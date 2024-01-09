import axios from "axios";
import { AUTH_BACKEND } from "./backends.js";

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
			content.data.binduser = auth.binduser;
			content.data.bindpass = auth.bindpass;
		}

		try {
			return await axios.request(url, content);
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

	async modUser (userid, attributes, params = null) {
		const bind = { binduser: params.binduser, bindpass: params.bindpass };
		return await this.#request(`/users/${userid}`, "POST", bind, attributes);
	}
}
