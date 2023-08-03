import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import morgan from "morgan";

import api from "./package.js";
import * as pve from "./pve.js";
import * as utils from "./utils.js";
import db from "./db.js";

import parseArgs from "minimist";
global.argv = parseArgs(process.argv.slice(2), {
	default: {
		localdb: "config/localdb.json"
	}
});

global.api = api;
global.pve = pve;
global.utils = utils;
global.db = new db(global.argv.localdb);

const app = express();
global.app = app;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({ origin: db.hostname }));
app.use(morgan("combined"));

global.server = app.listen(db.listenPort, () => {
	console.log(`proxmoxaas-api v${api.version} listening on port ${global.db.listenPort}`);
});

import("./routes/auth.js").then((module) => {
	app.use("/api/auth", module.router);
});

import("./routes/cluster.js").then((module) => {
	app.use("/api/cluster", module.router);
});

import("./routes/global.js").then((module) => {
	app.use("/api/global", module.router);
});

import("./routes/proxmox.js").then((module) => {
	app.use("/api/proxmox", module.router);
});

import("./routes/sync.js").then((module) => {
	app.use("/api/sync", module.router);
});

import("./routes/user.js").then((module) => {
	app.use("/api/user", module.router);
});

/**
 * GET - get API version
 * responses:
 * - 200: {version: string}
 */
app.get("/api/version", (req, res) => {
	res.status(200).send({ version: api.version });
});

/**
 * GET - echo request
 * responses:
 * - 200: {body: request.body, cookies: request.cookies}
 */
app.get("/api/echo", (req, res) => {
	res.status(200).send({ body: req.body, cookies: req.cookies });
});
