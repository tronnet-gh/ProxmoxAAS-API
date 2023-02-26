/**
 * called at app startup, can be used to initialize any variables needed for database access
 */
function init () {}

/**
 * user requests additional resources specified in k-v pairs
 * @param {string} user user's proxmox username in the form username@authrealm
 * @param {Object} resources k-v pairs with resource name as keys and resource ammount as values
 */
function requestResources (user, resources) {}

/**
 * user releases allocated resources specified in k-v pairs
 * @param {string} user user's proxmox username in the form username@authrealm
 * @param {Object} resources k-v pairs with resource name as keys and resource ammount as values
 */
function releaseResources (user, resources) {}

module.exports = {init, requestResources, releaseResources};