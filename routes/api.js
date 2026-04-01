/**
 * Created by Hongcai Deng on 2015/12/28.
 */

'use strict';

let express = require('express');
let router = express.Router();
const crypto = require('node:crypto');
const shortid = require('shortid');

const config = require('../modules/config');
const { getStore, DEFAULT_EXPIRY_MS, ALLOWED_EXPIRY_TIMES } = require('../modules/db');

function getDomains() {
  if (process.env.FORSAKEN_MAIL_DOMAINS) {
    return process.env.FORSAKEN_MAIL_DOMAINS
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  if (config.domains && Array.isArray(config.domains) && config.domains.length > 0) {
    return config.domains.map((item) => item.toLowerCase());
  }

  if (config.host) {
    return [String(config.host).toLowerCase()];
  }

  return [];
}

function getApiKeyHeader() {
  return process.env.FORSAKEN_MAIL_API_KEY_HEADER || 'X-API-Key';
}

function getConfiguredApiKey() {
  return process.env.FORSAKEN_MAIL_API_KEY || '';
}

function createApiStore() {
  return getStore({
    dbPath: process.env.FORSAKEN_MAIL_DB_PATH,
  });
}

const userTokenStore = new Map();

function getAdminPassword() {
  return process.env.FORSAKEN_MAIL_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';
}

function buildErrorPayload(error, message) {
  return { error, message };
}

function createUserToken(address) {
  const token = crypto.randomBytes(24).toString('base64url');
  userTokenStore.set(token, address.toLowerCase());
  return token;
}

function getBearerToken(req) {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function resolveInboxFromCompatRequest(req, store) {
  const bearerToken = getBearerToken(req);
  if (bearerToken) {
    const addressFromToken = userTokenStore.get(bearerToken);
    if (!addressFromToken) {
      return { error: buildErrorPayload('invalid_token', 'invalid or expired token'), status: 401 };
    }

    const inbox = store.getInboxByAddress(addressFromToken);
    if (!inbox) {
      return { error: buildErrorPayload('inbox_not_found', 'mailbox not found'), status: 404 };
    }

    return { inbox };
  }

  const address = String(req.query.address || '').trim().toLowerCase();
  if (address) {
    const inbox = store.getInboxByAddress(address);
    if (!inbox) {
      return { error: buildErrorPayload('inbox_not_found', 'mailbox not found'), status: 404 };
    }

    return { inbox };
  }

  return { error: buildErrorPayload('missing_mailbox_auth', 'missing bearer token or address'), status: 401 };
}

function getPositiveLimit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, 100);
}

function getNonNegativeOffset(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function requireAdminAuth(req, res) {
  const configuredPassword = getAdminPassword();
  const providedPassword = req.headers['x-admin-auth'];

  if (configuredPassword && providedPassword !== configuredPassword) {
    res.status(403).json(buildErrorPayload('invalid_admin_auth', 'admin auth failed'));
    return false;
  }

  return true;
}

function mapEmail(email) {
  return {
    id: email.id,
    address: email.address,
    createdAt: email.createdAt,
    expiresAt: email.expiresAt,
  };
}

function mapMessage(message) {
  return {
    id: message.id,
    from_address: message.fromAddress,
    to_address: message.toAddress,
    subject: message.subject,
    content: message.content,
    html: message.html,
    sent_at: message.sentAt,
    received_at: message.receivedAt,
    type: message.type,
  };
}

function getRawMessageValue(message) {
  if (!message || !message.rawJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(message.rawJson);
    if (typeof parsed.raw === 'string' && parsed.raw.trim()) {
      return parsed.raw;
    }
  } catch (error) {
    return message.rawJson;
  }

  return message.rawJson;
}

function mapCompatMessage(message) {
  const fromValue = message.fromAddress || null;
  const subjectValue = message.subject || null;
  const textValue = message.content || '';
  const htmlValue = message.html || '';
  const rawValue = getRawMessageValue(message);

  return {
    id: message.id,
    source: fromValue,
    from: fromValue,
    from_address: fromValue,
    fromAddress: fromValue,
    subject: subjectValue,
    title: subjectValue,
    text: textValue,
    body: textValue,
    content: textValue,
    html: htmlValue,
    raw: rawValue,
  };
}

function mapAdminCompatMail(message) {
  const rawValue = getRawMessageValue(message);

  return {
    id: message.id,
    address: message.address || message.toAddress || null,
    source: message.fromAddress || null,
    subject: message.subject || null,
    text: message.content || '',
    html: message.html || '',
    raw: rawValue,
    createdAt: message.receivedAt || null,
    created_at: message.receivedAt || null,
  };
}

function getInboxName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized) {
    return normalized;
  }

  return shortid.generate().toLowerCase();
}

router.use(function(req, res, next) {
  const apiKey = getConfiguredApiKey();
  if (!apiKey) {
    return next();
  }

  const headerName = getApiKeyHeader().toLowerCase();
  const providedKey = req.headers[headerName];
  if (providedKey !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
});

router.get('/', function(req, res) {
  res.json({ success: true });
});

router.post('/emails/generate', function(req, res) {
  const store = createApiStore();
  const domains = getDomains();
  const payload = req.body || {};
  const name = getInboxName(payload.name);
  const domain = String(payload.domain || domains[0] || '').trim().toLowerCase();
  const expiryTime = payload.expiryTime === undefined ? DEFAULT_EXPIRY_MS : Number(payload.expiryTime);

  if (!/^[a-z0-9._-]+$/.test(name)) {
    return res.status(400).json({ error: '邮箱名称格式无效' });
  }

  if (!domain || !domains.includes(domain)) {
    return res.status(400).json({ error: '无效的域名' });
  }

  if (!ALLOWED_EXPIRY_TIMES.has(expiryTime)) {
    return res.status(400).json({ error: '无效的过期时间' });
  }

  try {
    const inbox = store.createInbox({ name, domain, expiryTime });
    return res.json({
      id: inbox.id,
      email: inbox.address,
    });
  } catch (error) {
    if (/already exists/i.test(error.message)) {
      return res.status(409).json({ error: '该邮箱地址已被使用' });
    }

    return res.status(500).json({ error: '创建邮箱失败' });
  }
});

router.post('/admin/new_address', function(req, res) {
  if (!requireAdminAuth(req, res)) {
    return;
  }

  const store = createApiStore();
  const domains = getDomains();
  const payload = req.body || {};
  const name = getInboxName(payload.name);
  const domain = String(payload.domain || '').trim().toLowerCase();

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json(buildErrorPayload('invalid_payload', 'request body must be a json object'));
  }

  if (payload.enablePrefix !== undefined && typeof payload.enablePrefix !== 'boolean') {
    return res.status(400).json(buildErrorPayload('invalid_enable_prefix', 'enablePrefix must be boolean'));
  }

  if (!/^[a-z0-9._-]+$/.test(name)) {
    return res.status(400).json(buildErrorPayload('invalid_name', 'invalid mailbox name'));
  }

  if (!domain || !domains.includes(domain)) {
    return res.status(400).json(buildErrorPayload('invalid_domain', 'invalid domain'));
  }

  try {
    const inbox = store.createInbox({ name, domain, expiryTime: DEFAULT_EXPIRY_MS });
    const jwt = createUserToken(inbox.address);
    return res.status(200).json({
      address: inbox.address,
      jwt,
    });
  } catch (error) {
    if (/already exists/i.test(error.message)) {
      return res.status(409).json(buildErrorPayload('address_already_exists', 'mailbox already exists'));
    }

    return res.status(500).json(buildErrorPayload('create_address_failed', 'failed to create mailbox'));
  }
});

router.get('/admin/mails', function(req, res) {
  if (!requireAdminAuth(req, res)) {
    return;
  }

  const store = createApiStore();
  const limit = getPositiveLimit(req.query.limit, 20);
  const offset = getNonNegativeOffset(req.query.offset, 0);
  const address = String(req.query.address || '').trim().toLowerCase();

  const result = address
    ? store.listMessagesByAddress(address, { limit, offset })
    : store.listAllMessages({ limit, offset });

  return res.json({
    results: result.messages.map(mapAdminCompatMail),
    total: result.total,
  });
});

router.get('/emails', function(req, res) {
  const store = createApiStore();
  const result = store.listInboxes({
    limit: getPositiveLimit(req.query.limit, 20),
    cursor: req.query.cursor,
  });

  return res.json({
    emails: result.emails.map(mapEmail),
    nextCursor: result.nextCursor,
    total: result.total,
  });
});

router.get('/health', function(req, res) {
  return res.json({
    status: 'ok',
    storage: 'sqlite',
  });
});

function sendConfig(res) {
  const domains = getDomains();
  return res.json({
    primaryDomain: domains[0] || null,
    domains,
    emailDomains: domains.join(','),
  });
}

router.get('/config', function(req, res) {
  return sendConfig(res);
});

router.post('/config', function(req, res) {
  return sendConfig(res);
});

router.get('/mails', function(req, res) {
  const store = createApiStore();
  const resolved = resolveInboxFromCompatRequest(req, store);

  if (resolved.error) {
    return res.status(resolved.status).json(resolved.error);
  }

  const result = store.listMessages(resolved.inbox.id, {
    limit: getPositiveLimit(req.query.limit, 20),
    cursor: req.query.cursor,
  });

  return res.json(result.messages.map(mapCompatMessage));
});

router.get('/mails/:id', function(req, res) {
  const store = createApiStore();
  const resolved = resolveInboxFromCompatRequest(req, store);
  const message = resolved.inbox ? store.getMessage(resolved.inbox.id, req.params.id) : store.getMessageById(req.params.id);

  if (resolved.error && !message) {
    return res.status(resolved.status).json(resolved.error);
  }

  if (!message) {
    return res.status(404).json(buildErrorPayload('mail_not_found', 'mail not found'));
  }

  if (resolved.inbox && message.emailId !== resolved.inbox.id) {
    return res.status(404).json(buildErrorPayload('mail_not_found', 'mail not found'));
  }

  return res.json(mapCompatMessage(message));
});

router.get('/emails/:id', function(req, res) {
  const store = createApiStore();
  const inbox = store.getInboxById(req.params.id);

  if (!inbox) {
    return res.status(404).json({ error: '邮箱不存在' });
  }

  const result = store.listMessages(inbox.id, {
    limit: getPositiveLimit(req.query.limit, 20),
    cursor: req.query.cursor,
  });
  return res.json({
    messages: result.messages.map(mapMessage),
    nextCursor: result.nextCursor,
    total: result.total,
  });
});

router.delete('/emails/:id', function(req, res) {
  const store = createApiStore();
  const deleted = store.deleteInbox(req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: '邮箱不存在' });
  }

  return res.json({ success: true });
});

router.get('/emails/:id/:messageId', function(req, res) {
  const store = createApiStore();
  const inbox = store.getInboxById(req.params.id);

  if (!inbox) {
    return res.status(404).json({ error: '邮箱不存在' });
  }

  const message = store.getMessage(inbox.id, req.params.messageId);
  if (!message) {
    return res.status(404).json({ error: 'Message not found' });
  }

  return res.json({
    message: mapMessage(message),
  });
});

router.delete('/emails/:id/:messageId', function(req, res) {
  const store = createApiStore();
  const inbox = store.getInboxById(req.params.id);

  if (!inbox) {
    return res.status(404).json({ error: '邮箱不存在' });
  }

  const deleted = store.deleteMessage(inbox.id, req.params.messageId);
  if (!deleted) {
    return res.status(404).json({ error: 'Message not found or already deleted' });
  }

  return res.json({ success: true });
});

module.exports = router;
