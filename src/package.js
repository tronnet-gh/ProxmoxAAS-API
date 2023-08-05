import { readFileSync } from "fs";
export default (path) => {
	return JSON.parse(readFileSync(path));
};
