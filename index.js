const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser")
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
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
	res.send({recieved: {body: req.body, cookies: req.cookies}});
});

app.listen(80, () => {
	console.log("listening on port 80");
});