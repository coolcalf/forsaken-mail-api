/**
 * Created by Hongcai Deng on 2015/12/28.
 */

'use strict';

let mailin = require('mailin');
let config = require('./config');

let started = false;

function formatMailinError(err) {
  if (!err) {
    return 'Unknown mailin error';
  }

  if (err.stack) {
    return err.stack;
  }

  if (typeof err === 'string') {
    return err;
  }

  if (err.message) {
    return err.message;
  }

  try {
    return JSON.stringify(err);
  } catch (jsonError) {
    return String(err);
  }
}

function getMailin() {
  if (!started) {
    mailin.start(config.mailin);
    mailin.on('error', function(err) {
      console.error(formatMailinError(err));
    });
    started = true;
  }

  return mailin;
}

module.exports = {
  getMailin,
  formatMailinError,
};
