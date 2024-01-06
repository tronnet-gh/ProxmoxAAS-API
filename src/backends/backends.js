import path from "path";
import url from "url";

export default async () => {
	const backends = {};
	for (const name in global.config.backends) {
		// get files and config
		const target = global.config.backends[name].import;
		const config = global.config.backends[name].config;
		// get import path
		const thisPath = path.dirname(url.fileURLToPath(import.meta.url));
		const fromPath = path.relative(".", path.dirname(url.fileURLToPath(import.meta.url)));
		const targetPath = path.relative(".", `${fromPath}/${target}`);
		const importPath = `./${path.relative(thisPath, targetPath)}`;
		// import and add to list of imported handlers
		const Backend = (await import(importPath)).default;
		backends[name] = new Backend(config);
		console.log(`backends: initialized backend ${name} from ${importPath}`);
	}
	// assign backends to handlers depending
	const handlers = global.config.handlers;
	global.pve = backends[handlers.pve];
	global.db = backends[handlers.db];
	global.auth = handlers.auth;
	Object.keys(global.auth).forEach((e) => {
		global.auth[e] = backends[global.auth[e]];
	});
};
