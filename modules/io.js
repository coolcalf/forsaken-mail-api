'use strict';

const shortid = require('shortid');
const config = require('./config');
const { getMailin } = require('./mailin');
const { getStore } = require('./db');

let onlines = new Map();

function getAddressFromHeaders(toValue) {
  if (!toValue || typeof toValue !== 'string') {
    return null;
  }

  const exp = /[\w\._\-\+]+@[\w\._\-\+]+/i;
  if (!exp.test(toValue)) {
    return null;
  }

  const matches = toValue.match(exp);
  return matches ? matches[0].toLowerCase() : null;
}

function getShortIdFromAddress(address) {
  if (!address || !address.includes('@')) {
    return null;
  }

  return address.substring(0, address.indexOf('@'));
}

function ensureInboxForAddress(store, address) {
  if (!address || !address.includes('@')) {
    return null;
  }

  const normalized = address.toLowerCase();
  const localPart = getShortIdFromAddress(normalized);
  const domain = normalized.substring(normalized.indexOf('@') + 1);

  if (!localPart || !domain) {
    return null;
  }

  return store.ensureInbox({
    name: localPart,
    domain,
    expiryTime: 0,
  });
}

function checkShortIdMatchBlackList(id) {
  const keywordBlackList = config.keywordBlackList;
  if (keywordBlackList && keywordBlackList.length > 0) {
    for (let i = 0; i < keywordBlackList.length; i++) {
      const keyword = keywordBlackList[i];
      if (id.includes(keyword)) {
        return true;
      }
    }
  }
  return false;
}

function persistInboundMessage(store, data) {
  const headers = data && data.headers ? data.headers : {};
  const toAddress = getAddressFromHeaders(headers.to);

  if (!toAddress) {
    return null;
  }

  const inbox = store.getInboxByAddress(toAddress);
  if (!inbox) {
    return null;
  }

  const parsedReceivedAt = headers.date ? new Date(headers.date).getTime() : Date.now();

  return store.insertMessage({
    emailId: inbox.id,
    fromAddress: headers.from || null,
    toAddress,
    subject: headers.subject || null,
    content: data.text || '',
    html: data.html || '',
    receivedAt: Number.isFinite(parsedReceivedAt) ? parsedReceivedAt : Date.now(),
    rawJson: JSON.stringify(data),
  });
}

function bindRealtime(io) {
  const mailin = getMailin();
  const store = getStore({ dbPath: process.env.FORSAKEN_MAIL_DB_PATH });

  mailin.on('message', function(connection, data) {
    const toAddress = getAddressFromHeaders(data && data.headers ? data.headers.to : null);
    if (!toAddress) {
      return;
    }

    persistInboundMessage(store, data);

    const inboxShortId = getShortIdFromAddress(toAddress);
    if (inboxShortId && onlines.has(inboxShortId)) {
      onlines.get(inboxShortId).emit('mail', data);
    }
  });

  io.on('connection', socket => {
    socket.on('request shortid', function(payload) {
      onlines.delete(socket.shortid);
      socket.shortid = shortid.generate().toLowerCase();
      const domain = payload && payload.domain ? String(payload.domain).toLowerCase() : null;
      if (domain) {
        ensureInboxForAddress(store, `${socket.shortid}@${domain}`);
      }
      onlines.set(socket.shortid, socket);
      socket.emit('shortid', socket.shortid);
    });

    socket.on('set shortid', function(payload) {
      const id = typeof payload === 'string' ? payload : payload && payload.id;
      const domain = payload && payload.domain ? String(payload.domain).toLowerCase() : null;
      if (checkShortIdMatchBlackList(id)) {
        return;
      }

      onlines.delete(socket.shortid);
      socket.shortid = id;
      if (domain) {
        ensureInboxForAddress(store, `${socket.shortid}@${domain}`);
      }
      onlines.set(socket.shortid, socket);
      socket.emit('shortid', socket.shortid);
    });

    socket.on('disconnect', function() {
      onlines.delete(socket.shortid);
    });
  });
}

module.exports = bindRealtime;
module.exports.persistInboundMessage = persistInboundMessage;
module.exports.ensureInboxForAddress = ensureInboxForAddress;
