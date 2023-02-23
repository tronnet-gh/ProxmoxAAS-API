## Configuring API Token and Permissions

1. Add a new user `proxmoxaas-api` to proxmox
2. Create a new API token for the user `proxmoxaas-api` and copy the secret key to a safe location
3. Create a new role `proxmoxaas-api` with at least the following permissions: 
- VM.* except VM.Audit, VM.Backup, VM.Console, VM.Monitor, VM.PowerMgmt, VM.Snapshot, VM.Snapshot.Rollback
4. Add a new API Token Permission with path: `/`, select the API token created previously, and role: `proxmoxaas-api