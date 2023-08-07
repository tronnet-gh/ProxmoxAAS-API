import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import morgan from "morgan";

import api from "./package.js";
import * as pve from "./pve.js";
import * as utils from "./utils.js";
import LocalDB from "./db.js";

import parseArgs from "minimist";
global.argv = parseArgs(process.argv.slice(2), {
	default: {
		package: "package.json",
		localdb: "config/localdb.json"
	}
});

global.api = api(global.argv.package);
global.pve = pve;
global.utils = utils;
global.db = new LocalDB(global.argv.localdb);

const app = express();
global.app = app;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({ origin: global.db.hostname }));
app.use(morgan("combined"));

global.server = app.listen(global.db.listenPort, () => {
	console.log(`proxmoxaas-api v${global.api.version} listening on port ${global.db.listenPort}`);
});

global.utils.recursiveImport(app, "/api", "routes");

/**
 * GET - get API version
 * responses:
 * - 200: {version: string}
 */
app.get("/api/version", (req, res) => {
	res.status(200).send({ version: global.api.version });
});

/**
 * GET - echo request
 * responses:
 * - 200: {body: request.body, cookies: request.cookies}
 */
app.get("/api/echo", (req, res) => {
	res.status(200).send({ body: req.body, cookies: req.cookies });
});
