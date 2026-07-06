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
    - VM.* except VM.Clone, VM.Console, VM.Monitor, VM.PowerMgmt, VM.Snapshot, VM.Snapshot.Rollback
    - Datastore.Allocate, Datastore.AllocateSpace, Datastore.AllocateTemplate, Datastore.Audit
    - User.Modify
	- Pool.Audit
	- SDN.Use (if instances use SDN networks)
	- Sys.Audit
4. Add a new API Token Permission with path: `/`, select the API token created previously, and role: `proxmoxaas-api`
5. Add a new User Permission with  path: `/`, select the `proxmoxaas-api` user, and role: `proxmoxaas-api`
6. To prevent users from bypassing the API provided methods, create a new role `PAAS-Client` with only the following permssions:
	- Datastore.Audit
	- Pool.Audit
	- VM.Audit
	- VM.Console
	- VM.PowerMgmt

### Installation - API
1. Clone this repo onto the `ProxmoxAAS-API` host
2. Run `npm install` to initiaze the package requirements
3. Copy `template.config.json` as `config.json` and modify the following values:
	1. In `application`:
		- hostname - the ProxmoxAAS-Dashboard URL, ie `paas.domain.net`
		- domain - the base domain for the dashboard and proxmox, ie `domain.net`
    	- listenPort - the port you want the API to listen on, ie `8081`
	1. In `backends/pve/config`:
		- url: the URI to the Proxmox API, ie `https://pve.domain.net/api2/json`
		- fabric: the URL to the ProxmoxAAS-Fabric, ie `https://fabric.local`
		- token: the `proxmoxaas-api` user(name), authentication realm (pam), token id, and token secrey key (uuid)
		- root (**Optional**): In order to allow users to customize instance pcie devices, the API must use the root credentials for privilege elevation. Provide the root username, ie. `root@pam`, and root user password
	2. In `backends/access_manager/config`:
		- url: url to a access-mamanger-api server API ie. `http://access.local`
	4. In `useriso`:
		- node: host of storage with user accessible iso files
		- storage: name of storage with user accessible iso files
	5. In `backups`:
		- storage: name of storage for instance backups
4. Start the service using `node .`, or call the provided shell script, or use the provided systemctl service script