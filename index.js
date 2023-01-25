const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser")
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const https = require("https");
var package = require("./package.json");

const {pveAPI, pveAPIToken, listenPort} = require("./vars.js")

const app = express();
app.use(helmet());
app.use(bodyParser.urlencoded({extended: true}));
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
		res.send({auth: result});
	});
});

app.post("/api/disk/detach", (req, res) => {
	let vmpath = `nodes/${req.body.node}/${req.body.type}/${req.body.vmid}`;
	checkAuth(req.cookies, (result) => {
		if (result) {
			requestPVE(`/${vmpath}/config`, "POST", req.cookies, (result) => {
				res.send(result);
			}, body = req.body.action, token = pveAPIToken);
		}
		else {
			res.send({auth: result});
		}
	}, vmpath);
});

function checkAuth (cookies, callback, vmpath = null) {
	if (vmpath) {
		requestPVE(`/${vmpath}/config`, "GET", cookies, (result) => {
			if(result.status === 200){
				callback(true);
			}
			else {
				callback(false);
			}
		})
	}
	else { // if no path is specified, then do a simple authentication
		requestPVE("/version", "GET", cookies, (result) => {
			if(result.status === 200){
				callback(true);
			}
			else {
				callback(false);
			}
		});
	}
}

function requestPVE (path, method, cookies, callback, body = null, token = null) {
	let url = `${pveAPI}${path}`;
	let content = {
		method: method,
		mode: "cors",
		credentials: "include",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		}
	}
	if (method === "POST") {
		content.headers.CSRFPreventionToken = cookies.CSRFPreventionToken;
	}

	if (token) {
		content.headers.Authorization = `PVEAPIToken=${token.user}@${token.realm}!${token.id}=${token.uuid}`;
	}
	else {
		content.headers.Cookie = `PVEAuthCookie=${cookies.PVEAuthCookie}; CSRFPreventionToken=${cookies.CSRFPreventionToken}`;
	}

	const promiseResponse = new Promise((resolve, reject) => {
		const fullResponse = {
			status: "",
			body: "",
			headers: ""
		};
	  
		const request = https.request(url, content);
		request.on("error", reject);
		request.on("response", response => {
			response.setEncoding("utf8");
			fullResponse.status = response.statusCode;
			fullResponse.headers = response.headers;
			response.on("data", chunk => { fullResponse.body += chunk; });
			response.on("end", () => {
				if(fullResponse.body){
					fullResponse.body = JSON.parse(fullResponse.body);
				}
				resolve(fullResponse);
			});
		});

		if (method === "POST") {
			request.write(body);
		}
	  
		request.end();
	});
		
	promiseResponse.then(
		response => {callback(response);},
		error => {callback(error);}
	);
}

app.listen(listenPort, () => {
	console.log(`listening on port ${listenPort}`);
});