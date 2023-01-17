const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
var package = require('./package.json');

const app = express();
app.use(helmet());
app.use(bodyParser.json());
app.use(cors());
app.use(morgan('combined'));


app.get('/api/version', (req, res) => {
	res.send({version: package.version});
});

app.listen(80, () => {
	console.log('listening on port 80');
});