import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import morgan from "morgan";

import _package from "./package.js";
import * as pve from "./pve.js";
import * as utils from "./utils.js";

import parseArgs from "minimist";
global.argv = parseArgs(process.argv.slice(2), {
	default: {
		package: "package.json",
		listenPort: 8081,
		db: "./localdb.js", // relative to main.js
		dbconfig: "config/localdb.json"
	}
});

global.package = _package(global.argv.package);
global.pve = pve;
global.utils = utils;
const DB = (await import(global.argv.db)).default;
global.db = new DB(global.argv.dbconfig);

const app = express();
global.app = app;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({ origin: global.db.hostname }));
app.use(morgan("combined"));

global.server = app.listen(global.argv.listenPort, () => {
	console.log(`proxmoxaas-api v${global.package.version} listening on port ${global.argv.listenPort}`);
});

global.utils.recursiveImport(app, "/api", "routes");

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
