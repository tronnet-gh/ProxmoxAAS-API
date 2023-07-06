import { readFileSync } from "fs";
export const api = JSON.parse(readFileSync("package.json"));
