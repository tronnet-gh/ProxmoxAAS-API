import axios from "axios";
import { AtomicChange, AUTH_BACKEND, doNothingCallback } from "./backends.js";
import * as setCookie from "set-cookie-parser";

export default class PAASLDAP extends AUTH_BACKEND {
	#url = null;
	#realm = null;

	constructor (config) {
		super();
		this.#url = config.url;
		this.#realm = config.realm;
	}

	/**
	 * Send HTTP request to paas-LDAP API.
	 * @param {*} path  HTTP path, prepended with the paas-LDAP API base url
	 * @param {*} method HTTP method
	 * @param {*} body body parameters and data to be sent. Optional.
	 * @returns {Object} HTTP response object
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
			const result = error.response;
			result.ok = result.status === 200;
			return result;
		}
	}

	#handleGenericReturn (res) {
		return {
			ok: res.ok,
			status: res.status,
			message: res.ok ? "" : res.data.error
		};
	}

	async openSession (user, password) {
		const username = user.id;
		const content = { username, password };
		const result = await this.#request("/ticket", "POST", null, content);
		if (result.ok) {
			const cookies = setCookie.parse(result.headers["set-cookie"]);
			cookies.forEach((e) => {
				e.expiresMSFromNow = e.expires - Date.now();
			});
			return {
				ok: true,
				status: result.status,
				message: "",
				cookies
			};
		}
		else {
			return {
				ok: false,
				status: result.status,
				message: result.data.error,
				cookies: []
			};
		}
	}

	async addUser (user, attributes, params) {}

	async getUser (user, params) {
		if (!params) { // params required, do nothing if params are missing
			return null;
		}
		const res = await this.#request(`/users/${user.id}`, "GET", params);
		if (res.ok) { // if ok, return user data
			return res.data.user;
		}
		else { // else return null
			return null;
		}
	}

	async getAllUsers (params) {
		if (!params) {
			return null;
		}
		const res = await this.#request("/users", "GET", params);
		if (res.ok) { // if ok, return user data
			const users = res.data.users;
			const usersFormatted = {};
			// label each user object by user@realm
			for (const user of users) {
				usersFormatted[`${user.attributes.uid}@${this.#realm}`] = user;
			}
			return usersFormatted;
		}
		else { // else return null
			return null;
		}
	}

	async setUser (user, attributes, params) {
		if (!attributes.userpassword && !attributes.cn && attributes.sn) {
			return new AtomicChange(true, {}, doNothingCallback, null); // change has no ldap attributes
		}
		const ldapAttributes = {};
		if (attributes.userpassword) {
			ldapAttributes.userpassword = attributes.userpassword;
		}
		if (attributes.cn) {
			ldapAttributes.cn = attributes.cn;
		}
		if (attributes.sn) {
			ldapAttributes.sn = attributes.sn;
		}
		return new AtomicChange(
			true,
			{
				user,
				ldapAttributes,
				params
			},
			async (delta) => {
				const res = await this.#request(`/users/${delta.user.id}`, "POST", delta.params, delta.ldapAttributes);
				return this.#handleGenericReturn(res);
			},
			{ ok: true, status: 200, message: "" }
		);
	}

	async delUser (user, params) {}

	async addGroup (group, attributes, params) {}

	async getGroup (group, params) {
		return await this.#request(`/groups/${group.id}`, "GET", params);
	}

	async getAllGroups (params) {
		if (!params) {
			return null;
		}
		const res = await this.#request("/groups", "GET", params);
		if (res.ok) { // if ok, return user data
			const groups = res.data.groups;
			const groupsFormatted = {};
			// label each user object by user@realm
			for (const group of groups) {
				groupsFormatted[`${group.attributes.cn}@${this.#realm}`] = group;
			}
			return groupsFormatted;
		}
		else { // else return null
			return null;
		}
	}

	async setGroup (group, attributes, params) {
		// not implemented, LDAP groups do not have any attributes to change
		return new AtomicChange(true, {}, doNothingCallback, null); ;
	}

	async delGroup (group, params) {}

	async addUserToGroup (user, group, params) {}

	async delUserFromGroup (user, group, params) {}
}
