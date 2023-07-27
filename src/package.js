import { readFileSync } from "fs";
export default JSON.parse(readFileSync("package.json"));
