import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import morgan from "morgan";
import parseArgs from "minimist";

import * as utils from "./utils.js";
import _backends from "./backends/backends.js";

global.argv = parseArgs(process.argv.slice(2), {
	default: {
		package: "package.json",
		config: "config/config.json"
	}
});

global.utils = utils;
global.package = global.utils.readJSONFile(global.argv.package);
global.config = global.utils.readJSONFile(global.argv.config);
await _backends();

const app = express();
global.app = app;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({ origin: global.config.application.hostname }));
app.use(morgan("combined"));

global.server = app.listen(global.config.application.listenPort, () => {
	console.log(`proxmoxaas-api v${global.package.version} listening on port ${global.config.application.listenPort}`);
});

global.utils.recursiveImportRoutes(app, "/api", "routes");

/**
 * GET - get API version
 * responses:
 * - 200: {version: string}
 */
app.get("/api/version", (req, res) => {
	res.status(200).send({ version: global.package.version });
});

/**
 * GET - echo request
 * responses:
 * - 200: {body: request.body, cookies: request.cookies}
 */
app.get("/api/echo", (req, res) => {
	res.status(200).send({ body: req.body, cookies: req.cookies });
});
