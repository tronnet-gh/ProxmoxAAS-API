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
In Proxmox VE, follow the following steps:
1. Add a new user `proxmoxaas-api` to Proxmox VE
2. Create a new API token for the user `proxmoxaas-api` and copy the secret key to a safe location
3. Create a new role `proxmoxaas-api` with at least the following permissions: 
    - VM.* except VM.Audit, VM.Backup, VM.Clone, VM.Console, VM.Monitor, VM.PowerMgmt, VM.Snapshot, VM.Snapshot.Rollback
    - Datastore.Allocate, Datastore.AllocateSpace, Datastore.Audit
    - User.Modify
	- Pool.Audit
4. Add a new API Token Permission with path: `/`, select the API token created previously, and role: `proxmoxaas-api`
5. Add a new User Permission with  path: `/`, select the `proxmoxaas-api` user, and role: `proxmoxaas-api`

### Installation - API
1. Clone this repo onto `Dashboard Host`
2. Run `npm install` to initiaze the package requirements
3. Copy `template.config.json` as `config.json` and modify the following values:
	1. In `backends/pve/config`:
		- url: the URI to the Proxmox API, ie `http://<proxmoxhost>:8006/api2/json` or `http://<proxmox URL>/api2/json` if Proxmox VE is behind a reverse proxy. 
		- token: the user(name), authentication realm (pam), token id, and token secrey key (uuid)
		- root (**Optional**): In order to allow users to customize instance pcie devices, the API must use the root credentials for privilege elevation. Provide the root username, ie. `root@pam`, and root user password
	2. In `backends/paasldap/config` (**Optional**):
		- url: url to a PAAS-LDAP server API ie. `http://<paasldap-host>:8082`
	3. In `handlers/auth`:
		- Add any authentication handlers to be used by the API. Add the realm name (ie. `pve`) as the key and the handler name as provided in `backends`. For example, a PAAS-LDAP handler could be added as `"paas-ldap": "paasldap"` and users in the realm `user@paas-ldap` will use this handler to perform auth actions. Refer to [backends](#Backends)
	4. In `application`:
		- hostname - the ProxmoxAAS-Dashboard URL, ie `host.domain.tld`
		- domain - the base domain for the dashboard and proxmox, ie `domain.tld`
    	- listenPort - the port you want the API to listen on, ie `8081`
	5. In `useriso`:
		- node: host of storage with user accessible iso files
		- storage: name of storage with user accessible iso files
4. Start the service using `node .`, or call the provided shell script, or use the provided systemctl service script

### Installation - Reverse Proxy
1. Configure nginx or preferred reverse proxy to reverse proxy the dashboard. The configuration should include at least the following:
```
server {
	listen 443 ssl;
	server_name paas.<FQDN>;
	location / {
		return 301 "/dashboard/";
	}
	location /dashboard/ {
		proxy_pass http://proxmoxaas.dmz:8080/;
		proxy_redirect default;
	}
	location /api/ {
		proxy_pass http://proxmoxaas.dmz:80/api/;
		proxy_redirect default;
	}
}
```
2. Start nginx with the new configurations

### Result
After these steps, the ProxmoxAAS Dashboard should be available and fully functional at `paas.<FQDN>` or `paas.<FQDN>/dashboard/`.

# Backends

Backend handlers are used to interface with any number and type of backend data source used to store ProxmoxAAS data. Most data involves users, groups, and membership relationships. The default backends are sufficient to run a small cluster, but additional backend handlers can be created. 

## Interface

Each backend must implement the following methods:

|||
|-|-|
|openSession|opens a session to the backend by creating a session token|
|closeSession|closes a session to the backend|

Additionally, backends dealing with user data may also need to implement:

|||
|-|-|
|addUser|create a user|
|getUser|retrieve user data including membership|
|setUser|modify a user|
|delUser|delete a user|
|addGroup|create a group|
|getGroup|retrieve group data including members|
|setGroup|modify group data except membership|
|delGroup|delete group|
|addUserToGroup|add user to group as member|
|deluserFromGroup|remove user from group|

Not all user backends will necessarily implement all the methods fully. For example, backends which do not store group data may not need to implement the group related methods.

Specific documentation can be found in `src/backends/backends.js`.

## Multiple Interfaces

Multiple backends can be specified using the config. During a backend operation involving users, each backend method will be called in the order specified in the config. If the operation is to retrieve user data, the responses will be merged favoring the last backend called. 