import { readFileSync } from "fs";
import { exit } from "process";
export default (path) => {
	try {
		return JSON.parse(readFileSync(path));
	}
	catch (e) {
		console.log(`Error: ${path} was not found.`);
		exit(1);
	}
};
