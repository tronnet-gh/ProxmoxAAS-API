# ProxmoxAAS API - Client REST API
ProxmoxAAS API provides functionality to the Client by both providing a proxy API for the Proxmox API, and an API for requesting resources within a defined quota.

## Prerequisites
- [ProxmoxAAS-Client](https://github.com/tronnet-gh/ProxmoxAAS-Client)
- Proxmox VE Cluster (v7.0+)
- Reverse proxy server which can proxy the client and API
	- FQDN
- Server with NodeJS (v18.0+) and NPM installed

## Configuring API Token and Permissions
In Proxmox VE, follow the following steps:
1. Add a new user `proxmoxaas-api` to Proxmox VE
2. Create a new API token for the user `proxmoxaas-api` and copy the secret key to a safe location
3. Create a new role `proxmoxaas-api` with at least the following permissions: 
    - VM.* except VM.Audit, VM.Backup, VM.Clone, VM.Console, VM.Monitor, VM.PowerMgmt, VM.Snapshot, VM.Snapshot.Rollback
    - Datastore.Allocate, Datastore.AllocateSpace, Datastore.Audit
    - User.Modify
4. Add a new API Token Permission with path: `/`, select the API token created previously, and role: `proxmoxaas-api`
5. Add a new User Permission with  path: `/`, select the `proxmoxaas-api` user, and role: `proxmoxaas-api`

## Installation - API
1. Clone this repo onto `Client Host`
2. Run `npm install` to initiaze the package requirements
3. Copy `localdb.json.template` as `localdb.json` and modify the following values under `pveAPIToken`:
    - pveAPI - the URI to the Proxmox API, ie `<proxmoxhost>:8006/api2/json` or `<proxmox URL>/api2/json` if Proxmox VE is behind a reverse proxy. 
    - hostname - the ProxmoxAAS-Client URL, ie `host.domain.tld`
	- domain - the base domain for the client and proxmox, ie `domain.tld`
    - listenPort - the port you want the API to listen on, ie `8080`
    - pveAPIToken - the user(name), authentication realm, token id, and token secrey key (uuid)
4. (Optional) In order to allow users to customize instance pcie devices, the API must use the root credentials for privilege elevation. Modify the following values under `pveroot` in order to use this feature:
	- username: root user, typically `root@pam`
	- password: root user password
5. You may also wish to configure users at this point as well. An example user config is shown in the template.
6. Start the service using `node .`, or call the provided shell script, or use the provided systemctl service script

## Installation - Reverse Proxy
1. Configure nginx or preferred reverse proxy to reverse proxy the client. The configuration should include at least the following:
```
server {
	listen 443 ssl;
	server_name client.<FQDN>;
	location / {
		proxy_pass http://<Client Host>:80;
	}
	location /api/ {
		proxy_pass http://<Client Host>:8080;
	}
}
```
2. Start nginx with the new configurations by running `systemctl reload nginx`

## Result
After these steps, the ProxmoxAAS Client should be available and fully functional at `client.<FQDN>`. 