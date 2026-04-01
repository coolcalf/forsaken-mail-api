/**
 * Created by Hongcai Deng on 2015/12/28.
 */

'use strict';

let express = require('express');
let path = require('path');
let fs = require('fs');
let debug = require('debug')('app');
let bodyParser = require('body-parser');
const { getStore } = require('./modules/db');
const { runCleanup, startCleanupScheduler } = require('./modules/cleanup');

let api = require(path.join(__dirname, 'routes/api'));
let app = express();
const indexTemplate = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const assetVersion = String(fs.statSync(path.join(__dirname, 'public', 'js', 'app.js')).mtimeMs);

function getPrimaryDomain() {
  if (process.env.FORSAKEN_MAIL_DOMAINS) {
    const domains = process.env.FORSAKEN_MAIL_DOMAINS.split(',').map((item) => item.trim()).filter(Boolean);
    return domains[0] || null;
  }

  return null;
}

function getDomains() {
  if (process.env.FORSAKEN_MAIL_DOMAINS) {
    return process.env.FORSAKEN_MAIL_DOMAINS.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

app.set('x-powered-by', false);
app.use(function(req, res, next) {
  res.locals.primaryDomain = getPrimaryDomain();
  next();
});
app.use(bodyParser.json());
app.get('/', function(req, res) {
  const domain = (res.locals.primaryDomain || req.hostname || '').replace(/"/g, '&quot;');
  const domains = JSON.stringify(getDomains());
  const html = indexTemplate
    .replace('__PRIMARY_DOMAIN__', domain)
    .replace('__DOMAINS__', domains)
    .replace(/\/css\/app\.css/g, `/css/app.css?v=${assetVersion}`)
    .replace(/\/css\/prism\.css/g, `/css/prism.css?v=${assetVersion}`)
    .replace(/\/js\/app\.js/g, `/js/app.js?v=${assetVersion}`)
    .replace(/\/js\/prism\.js/g, `/js/prism.js?v=${assetVersion}`);

  res.type('html').send(html);
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

app.use('/api', api);
app.use('/', api);

app.get('/favicon.ico', function(req, res) {
  res.status(204).end();
});

app.use(function(req, res, next) {
  let err = new Error('Not Found');
  err.status = 404;
  err.requestPath = req.originalUrl;
  err.requestMethod = req.method;
  next(err);
});

app.use(function(err, req, res, next) {
  const status = err && err.status ? err.status : 500;
  const message = err && err.message ? err.message : 'Internal Server Error';

  if (status === 404) {
    debug(`404 ${err.requestMethod || req.method} ${err.requestPath || req.originalUrl}`);
  } else {
    debug(err && err.stack ? err.stack : err);
  }

  if (res.headersSent) {
    return next(err);
  }

  if (req.originalUrl && (req.originalUrl.indexOf('/api/') === 0 || req.originalUrl.indexOf('/admin/') === 0)) {
    return res.status(status).json({ error: message });
  }

  return res.status(status).type('text').send(message);
});

let cleanupScheduler;

app.locals.startBackgroundJobs = function() {
  const store = getStore({ dbPath: process.env.FORSAKEN_MAIL_DB_PATH });
  runCleanup(store);

  if (!cleanupScheduler) {
    const intervalMs = Number(process.env.FORSAKEN_MAIL_CLEANUP_INTERVAL_MS || 5 * 60 * 1000);
    cleanupScheduler = startCleanupScheduler(store, { intervalMs });
  }

  return cleanupScheduler;
};

app.locals.stopBackgroundJobs = function() {
  if (cleanupScheduler) {
    cleanupScheduler.stop();
    cleanupScheduler = null;
  }
};

module.exports = app;
