# ProxmoxAAS API - REST API for ProxmoxAAS Dashboard
ProxmoxAAS API provides functionality for the Dashboard by providing a proxy API for the Proxmox API, and an API for requesting resources within a defined quota.

## Installation

### Prerequisites
- [ProxmoxAAS-Dashboard](https://git.tronnet.net/tronnet/ProxmoxAAS-Dashboard)
- Proxmox VE Cluster (v7.0+)
- Reverse proxy server which can proxy the dashboard and API
	- FQDN
- Server with NodeJS (v18.0+) and NPM installed

### Configuring API Token and Permissions
In the Proxmox web GUI, perform the following steps:
1. Add a new user `proxmoxaas-api` to Proxmox VE
2. Create a new API token for the user `proxmoxaas-api` and copy the secret key to a safe location
3. Create a new role `proxmoxaas-api` with at least the following permissions: 
    - VM.* except VM.Audit, VM.Backup, VM.Clone, VM.Console, VM.Monitor, VM.PowerMgmt, VM.Snapshot, VM.Snapshot.Rollback
    - Datastore.Allocate, Datastore.AllocateSpace, Datastore.Audit
    - User.Modify
	- Pool.Audit
	- SDN.Use (if instances use SDN networks)
4. Add a new API Token Permission with path: `/`, select the API token created previously, and role: `proxmoxaas-api`
5. Add a new User Permission with  path: `/`, select the `proxmoxaas-api` user, and role: `proxmoxaas-api`

### Installation - API
1. Clone this repo onto the `ProxmoxAAS-API` host
2. Run `npm install` to initiaze the package requirements
3. Copy `template.config.json` as `config.json` and modify the following values:
	1. In `backends/pve/config`:
		- url: the URI to the Proxmox API, ie `https://pve.domain.net/api2/json`
		- fabric: the URL to the ProxmoxAAS-Fabric, ie `https://fabric.local`
		- token: the user(name), authentication realm (pam), token id, and token secrey key (uuid)
		- root (**Optional**): In order to allow users to customize instance pcie devices, the API must use the root credentials for privilege elevation. Provide the root username, ie. `root@pam`, and root user password
	2. In `backends/paasldap/config` (**Optional**):
		- url: url to a PAAS-LDAP server API ie. `http://ldap.local`
	3. In `handlers/auth`:
		- Add any authentication handlers to be used by the API. Add the realm name (ie. `pve`) as the key and the handler name as provided in `backends`. For example, a PAAS-LDAP handler could be added as `"paas-ldap": "paasldap"` and users in the realm `user@paas-ldap` will use this handler to perform auth actions. Refer to [backends](#Backends)
	4. In `application`:
		- hostname - the ProxmoxAAS-Dashboard URL, ie `paas.domain.net`
		- domain - the base domain for the dashboard and proxmox, ie `domain.net`
    	- listenPort - the port you want the API to listen on, ie `8081`
	5. In `useriso`:
		- node: host of storage with user accessible iso files
		- storage: name of storage with user accessible iso files
4. Start the service using `node .`, or call the provided shell script, or use the provided systemctl service script

# Backends

Backend handlers are used to interface with any number and type of backend data source used to store ProxmoxAAS data. Most data involves users, groups, and membership relationships. The default backends are sufficient to run a small cluster, but additional backend handlers can be created. 

## Interface

Each backend must implement the following methods:

<table>
	<tr>
		<td>openSession</td>
		<td>opens a session to the backend by creating a session token</td>
	</tr>
	<tr>
		<td>closeSession</td>
		<td>closes a session to the backend</td>
	</tr>
</table>

Additionally, backends dealing with user data may also need to implement:

<table>
	<tr>
		<td>addUser</td>
		<td>create a user</td>
	</tr>
	<tr>
		<td>getUser</td>
		<td>retrieve user data including membership</td>
	</tr>
	<tr>
		<td>setUser</td>
		<td>modify a user</td>
	</tr>
	<tr>
		<td>delUser</td>
		<td>delete a user</td>
	</tr>
	<tr>
		<td>addGroup</td>
		<td>create a group</td>
	</tr>
	<tr>
		<td>getGroup</td>
		<td>retrieve group data including members</td>
	</tr>
	<tr>
		<td>setGroup</td>
		<td>modify group data except membership</td>
	</tr>
	<tr>
		<td>delGroup</td>
		<td>delete group</td>
	</tr>
	<tr>
		<td>addUserToGroup</td>
		<td>add user to group as member</td>
	</tr>
	<tr>
		<td>delUserFromGroup</td>
		<td>remove user from group</td>
	</tr>
</table>

Not all user backends will necessarily implement all the methods fully. For example, backends which do not store group data may not need to implement the group related methods.

Specific documentation can be found in `src/backends/backends.js`.

## Multiple Interfaces

Multiple backends can be specified using the config. During a backend operation involving users, each backend method will be called in the order specified in the config. If the operation is to retrieve user data, the responses will be merged favoring the last backend called. 