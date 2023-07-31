import { Router } from "express";
export const router = Router({ mergeParams: true });

const nodeRegexP = "[\\w-]+";
const typeRegexP = "qemu|lxc";
const vmidRegexP = "\\d+";

const basePath = `/:node(${nodeRegexP})/:type(${typeRegexP})/:vmid(${vmidRegexP})`;

import("./cluster/disk.js").then((module) => {
	router.use(`${basePath}/disk`, module.router);
});

import("./cluster/net.js").then((module) => {
	router.use(`${basePath}/net`, module.router);
});

import("./cluster/pci.js").then((module) => {
	router.use(`${basePath}/pci`, module.router);
});
