import { Router } from "express";
export const router = Router();

const nodeRegexP = "[\\w-]+";
const typeRegexP = "qemu|lxc";
const vmidRegexP = "\\d+";

const basePath = `/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})`;

import("./cluster/disk.js").then((module) => {
	router.use(`${basePath}/disk`, (req, res, next) => {
		req.routeparams = Object.assign({}, req.routeparams, req.params); 
		next(); 
	}, module.router);
});

import("./cluster/net.js").then((module) => {
	router.use(`${basePath}/net`, (req, res, next) => {
		req.routeparams = Object.assign({}, req.routeparams, req.params); 
		next(); 
	}, module.router);
});

import("./cluster/pci.js").then((module) => {
	router.use(`${basePath}/pci`,(req, res, next) => {
		req.routeparams = Object.assign({}, req.routeparams, req.params); 
		next(); 
	},  module.router);
});