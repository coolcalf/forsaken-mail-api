'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_FILENAME = 'main.db';
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_EXPIRY_TIMES = new Set([
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  0,
]);

function nowMs() {
  return Date.now();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function encodeCursor(timestamp, id) {
  return Buffer.from(JSON.stringify({ timestamp, id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch (error) {
    return null;
  }
}

function createStore(options) {
  const dbPath = options && options.dbPath ? options.dbPath : path.join(__dirname, '..', DEFAULT_DB_FILENAME);
  const database = new DatabaseSync(dbPath);

  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      email_id TEXT NOT NULL,
      from_address TEXT,
      to_address TEXT,
      subject TEXT,
      content TEXT,
      html TEXT,
      type TEXT DEFAULT 'received',
      received_at INTEGER NOT NULL,
      sent_at INTEGER,
      raw_json TEXT,
      FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
    );
  `);

  const statements = {
    insertEmail: database.prepare('INSERT INTO emails (id, address, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    selectEmailByAddress: database.prepare('SELECT id, address, created_at, expires_at FROM emails WHERE lower(address) = lower(?) AND (expires_at = 0 OR expires_at > ?)'),
    selectEmailById: database.prepare('SELECT id, address, created_at, expires_at FROM emails WHERE id = ? AND (expires_at = 0 OR expires_at > ?)'),
    selectEmails: database.prepare('SELECT id, address, created_at, expires_at FROM emails WHERE expires_at = 0 OR expires_at > ? ORDER BY created_at DESC, id DESC'),
    insertMessage: database.prepare('INSERT INTO messages (id, email_id, from_address, to_address, subject, content, html, type, received_at, sent_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    selectMessages: database.prepare('SELECT id, email_id, from_address, to_address, subject, content, html, type, received_at, sent_at, raw_json FROM messages WHERE email_id = ? ORDER BY received_at DESC, id DESC'),
    selectMessagesByAddress: database.prepare(`SELECT m.id, m.email_id, m.from_address, m.to_address, m.subject, m.content, m.html, m.type, m.received_at, m.sent_at, m.raw_json, e.address AS email_address FROM messages m INNER JOIN emails e ON e.id = m.email_id WHERE lower(e.address) = lower(?) AND (e.expires_at = 0 OR e.expires_at > ?) ORDER BY m.received_at DESC, m.id DESC`),
    selectAllMessages: database.prepare(`SELECT m.id, m.email_id, m.from_address, m.to_address, m.subject, m.content, m.html, m.type, m.received_at, m.sent_at, m.raw_json, e.address AS email_address FROM messages m INNER JOIN emails e ON e.id = m.email_id WHERE e.expires_at = 0 OR e.expires_at > ? ORDER BY m.received_at DESC, m.id DESC`),
    selectMessageById: database.prepare('SELECT id, email_id, from_address, to_address, subject, content, html, type, received_at, sent_at, raw_json FROM messages WHERE id = ? AND email_id = ?'),
    selectMessageByGlobalId: database.prepare('SELECT id, email_id, from_address, to_address, subject, content, html, type, received_at, sent_at, raw_json FROM messages WHERE id = ?'),
    deleteMessageById: database.prepare('DELETE FROM messages WHERE id = ? AND email_id = ?'),
    deleteMessagesByEmailId: database.prepare('DELETE FROM messages WHERE email_id = ?'),
    deleteEmailById: database.prepare('DELETE FROM emails WHERE id = ?'),
    cleanupMessages: database.prepare('DELETE FROM messages WHERE email_id IN (SELECT id FROM emails WHERE expires_at <= ?)'),
    cleanupEmails: database.prepare('DELETE FROM emails WHERE expires_at <= ?')
  };

  function mapEmail(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      address: row.address,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  function mapMessage(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      emailId: row.email_id,
      address: row.email_address || null,
      fromAddress: row.from_address,
      toAddress: row.to_address,
      subject: row.subject,
      content: row.content,
      html: row.html,
      type: row.type,
      receivedAt: row.received_at,
      sentAt: row.sent_at,
      rawJson: row.raw_json,
    };
  }

  return {
    createInbox(input) {
      const createdAt = nowMs();
      const expiryTime = typeof input.expiryTime === 'number' ? input.expiryTime : DEFAULT_EXPIRY_MS;
      const address = `${input.name}@${input.domain}`.toLowerCase();
      const existing = statements.selectEmailByAddress.get(address, createdAt);

      if (existing) {
        throw new Error('Inbox already exists');
      }

      const inbox = {
        id: createId('email'),
        address,
        createdAt,
        expiresAt: expiryTime === 0 ? 0 : createdAt + expiryTime,
      };

      statements.insertEmail.run(inbox.id, inbox.address, inbox.createdAt, inbox.expiresAt);
      return inbox;
    },

    getInboxByAddress(address) {
      return mapEmail(statements.selectEmailByAddress.get(address, nowMs()));
    },

    getInboxById(id) {
      return mapEmail(statements.selectEmailById.get(id, nowMs()));
    },

    ensureInbox(input) {
      const address = `${input.name}@${input.domain}`.toLowerCase();
      const existing = this.getInboxByAddress(address);
      if (existing) {
        return existing;
      }

      return this.createInbox({
        name: input.name,
        domain: input.domain,
        expiryTime: input.expiryTime
      });
    },

    listInboxes(options) {
      const allEmails = statements.selectEmails.all(nowMs()).map(mapEmail);
      const limit = options && options.limit ? options.limit : 20;
      const cursor = options && options.cursor ? decodeCursor(options.cursor) : null;

      let emails = allEmails;
      if (cursor) {
        emails = emails.filter((email) => (
          email.createdAt < cursor.timestamp ||
          (email.createdAt === cursor.timestamp && email.id < cursor.id)
        ));
      }

      const page = emails.slice(0, limit);
      const next = emails.length > limit ? page[page.length - 1] : null;
      return {
        emails: page,
        nextCursor: next ? encodeCursor(next.createdAt, next.id) : null,
        total: allEmails.length,
      };
    },

    insertMessage(input) {
      const message = {
        id: createId('msg'),
        emailId: input.emailId,
        fromAddress: input.fromAddress || null,
        toAddress: input.toAddress || null,
        subject: input.subject || null,
        content: input.content || '',
        html: input.html || '',
        type: input.type || 'received',
        receivedAt: input.receivedAt || nowMs(),
        sentAt: input.sentAt || null,
        rawJson: input.rawJson || null,
      };

      statements.insertMessage.run(
        message.id,
        message.emailId,
        message.fromAddress,
        message.toAddress,
        message.subject,
        message.content,
        message.html,
        message.type,
        message.receivedAt,
        message.sentAt,
        message.rawJson
      );

      return message;
    },

    listMessages(emailId, options) {
      const allMessages = statements.selectMessages.all(emailId).map(mapMessage);
      const limit = options && options.limit ? options.limit : 20;
      const cursor = options && options.cursor ? decodeCursor(options.cursor) : null;

      let messages = allMessages;
      if (cursor) {
        messages = messages.filter((message) => (
          message.receivedAt < cursor.timestamp ||
          (message.receivedAt === cursor.timestamp && message.id < cursor.id)
        ));
      }

      const page = messages.slice(0, limit);
      const next = messages.length > limit ? page[page.length - 1] : null;
      return {
        messages: page,
        nextCursor: next ? encodeCursor(next.receivedAt, next.id) : null,
        total: allMessages.length,
      };
    },

    listAllMessages(options) {
      const allMessages = statements.selectAllMessages.all(nowMs()).map(mapMessage);
      const offset = options && Number.isInteger(options.offset) && options.offset > 0 ? options.offset : 0;
      const limit = options && options.limit ? options.limit : 20;
      const page = allMessages.slice(offset, offset + limit);

      return {
        messages: page,
        total: allMessages.length,
      };
    },

    listMessagesByAddress(address, options) {
      const allMessages = statements.selectMessagesByAddress.all(address, nowMs()).map(mapMessage);
      const offset = options && Number.isInteger(options.offset) && options.offset > 0 ? options.offset : 0;
      const limit = options && options.limit ? options.limit : 20;
      const page = allMessages.slice(offset, offset + limit);

      return {
        messages: page,
        total: allMessages.length,
      };
    },

    getMessage(emailId, messageId) {
      return mapMessage(statements.selectMessageById.get(messageId, emailId));
    },

    getMessageById(messageId) {
      return mapMessage(statements.selectMessageByGlobalId.get(messageId));
    },

    deleteMessage(emailId, messageId) {
      const result = statements.deleteMessageById.run(messageId, emailId);
      return result.changes > 0;
    },

    deleteInbox(emailId) {
      statements.deleteMessagesByEmailId.run(emailId);
      const result = statements.deleteEmailById.run(emailId);
      return result.changes > 0;
    },

    cleanupExpired(referenceTime) {
      const cutoff = typeof referenceTime === 'number' ? referenceTime : nowMs();
      statements.cleanupMessages.run(cutoff);
      const result = statements.cleanupEmails.run(cutoff);
      return result.changes;
    },

    close() {
      database.close();
    }
  };
}

let sharedStore;

function getStore(options) {
  if (!sharedStore) {
    sharedStore = createStore(options);
  }

  return sharedStore;
}

function resetStore() {
  if (sharedStore) {
    sharedStore.close();
    sharedStore = null;
  }
}

module.exports = {
  createStore,
  DEFAULT_DB_FILENAME,
  DEFAULT_EXPIRY_MS,
  ALLOWED_EXPIRY_TIMES,
  getStore,
  resetStore,
  encodeCursor,
  decodeCursor,
};
