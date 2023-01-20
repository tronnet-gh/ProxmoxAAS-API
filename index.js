const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser")
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const https = require("https");
var package = require("./package.json");

const app = express();
app.use(helmet());
app.use(bodyParser.json());
app.use(cookieParser())
app.use(cors());
app.use(morgan("combined"));


app.get("/api/version", (req, res) => {
	res.send({version: package.version});
});

app.get("/api/echo", (req, res) => {
	res.send({body: req.body, cookies: req.cookies});
});

app.get("/api/auth", (req, res) => {
	checkAuth(req.cookies, (result) => {
		res.send(result);
	});
});

function checkAuth (cookies, callback, vmpath = null) {
	if (vmpath) {}
	else { // if no path is specified, then do a simple authentication
		requestPVE("/version", "GET", cookies, (result) => {
			callback(result);
		});
	}
}

function requestPVE (path, method, cookies, callback, body = null, auth = true) {
	let prms = new URLSearchParams(body);
	let content = {
		hostname: "pve.tronnet.net",
		port: 443,
		path: `/api2/json${path}`,
		method: method,
		mode: "cors",
		credentials: "include",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Cookie: `PVEAuthCookie=${cookies.PVEAuthCookie}; CSRFPreventionToken=${cookies.CSRFPreventionToken}`
		}
	}
	if (method === "POST") {
		content.body = prms.toString();
		content.headers.CSRFPreventionToken = cookies.CSRFPreventionToken;
	}
	https.request(content, (res) => {
		let data = "";
		res.on("data", (d) => {
			data += d.toString();
		});
		res.on("end", () => {
			try{
				callback(JSON.parse(data));
			}
			catch (e) {
				callback(e);
			}
		});
	}).on("error", (e) => {callback(e)}).end();
}

app.listen(80, () => {
	console.log("listening on port 80");
});