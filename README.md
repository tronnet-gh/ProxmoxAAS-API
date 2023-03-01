# ProxmoxAAS API - Client REST API
ProxmoxAAS API provides functionality to the Client by both providing a proxy API for the Proxmox API, and an API for requesting resources within a defined quota.

## Prerequisites
- Proxmox VE Cluster (v7.0+)
- (ProxmoxAAS-Client)[https://github.com/tronnet-gh/ProxmoxAAS-Client]
- Server with NodeJS and NPM installed

## Configuring API Token and Permissions
In the proxmox web ui, follow the following steps:
1. Add a new user `proxmoxaas-api` to proxmox
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
3. Copy `vars.js.template` as `vars.js` and modify the following values:
    - pveAPI - the URI to the Proxmox API, ie `pve.<FQDN>/api2/json`
    - domain - your domain name
    - listenPort - the port you want the API to listen on, ie `8080`
    - pveAPIToken - the user(name), authentication realm, token id, and token secrey key (uuid)
4. Start the service using `node .`, or call the provided shell script, or use the provided systemctl service script

## Result
After these steps, the ProxmoxAAS Client should be avaliable and fully functional at `client.<FQDN>`. 
