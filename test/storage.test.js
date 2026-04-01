'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore } = require('../modules/db');
const { persistInboundMessage, ensureInboxForAddress } = require('../modules/io');

function createTempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forsaken-mail-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const store = createStore({ dbPath, domain: 'example.test' });

  return {
    store,
    cleanup() {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('createInbox defaults to 24h expiry', () => {
  const { store, cleanup } = createTempStore();

  try {
    const before = Date.now();
    const inbox = store.createInbox({ name: 'demo', expiryTime: undefined, domain: 'example.test' });
    const after = Date.now();

    assert.equal(inbox.address, 'demo@example.test');
    assert.equal(inbox.expiresAt >= before + (24 * 60 * 60 * 1000), true);
    assert.equal(inbox.expiresAt <= after + (24 * 60 * 60 * 1000), true);
  } finally {
    cleanup();
  }
});

test('createInbox rejects duplicate active addresses', () => {
  const { store, cleanup } = createTempStore();

  try {
    store.createInbox({ name: 'demo', expiryTime: 60 * 60 * 1000, domain: 'example.test' });

    assert.throws(() => {
      store.createInbox({ name: 'demo', expiryTime: 60 * 60 * 1000, domain: 'example.test' });
    }, /already exists/i);
  } finally {
    cleanup();
  }
});

test('insertMessage and listMessages return newest first', () => {
  const { store, cleanup } = createTempStore();

  try {
    const inbox = store.createInbox({ name: 'demo', expiryTime: 24 * 60 * 60 * 1000, domain: 'example.test' });

    store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'first@test.dev',
      toAddress: inbox.address,
      subject: 'First',
      content: 'one',
      html: '<p>one</p>',
      receivedAt: 1000,
      rawJson: '{}'
    });

    store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'second@test.dev',
      toAddress: inbox.address,
      subject: 'Second',
      content: 'two',
      html: '<p>two</p>',
      receivedAt: 2000,
      rawJson: '{}'
    });

    const result = store.listMessages(inbox.id);

    assert.equal(result.total, 2);
    assert.equal(result.messages[0].subject, 'Second');
    assert.equal(result.messages[1].subject, 'First');
  } finally {
    cleanup();
  }
});

test('getInboxByAddress ignores expired inboxes', () => {
  const { store, cleanup } = createTempStore();

  try {
    store.createInbox({ name: 'expired', expiryTime: -1000, domain: 'example.test' });
    const inbox = store.getInboxByAddress('expired@example.test');
    assert.equal(inbox, null);
  } finally {
    cleanup();
  }
});

test('persistInboundMessage stores inbound mail for active inbox', () => {
  const { store, cleanup } = createTempStore();

  try {
    const inbox = store.createInbox({ name: 'receiver', expiryTime: 24 * 60 * 60 * 1000, domain: 'example.test' });
    const persisted = persistInboundMessage(store, {
      headers: {
        to: inbox.address,
        from: 'sender@test.dev',
        subject: 'Inbound hello',
        date: new Date(5000).toISOString()
      },
      text: 'plain body',
      html: '<p>plain body</p>'
    });

    assert.equal(persisted.subject, 'Inbound hello');

    const messages = store.listMessages(inbox.id);
    assert.equal(messages.total, 1);
    assert.equal(messages.messages[0].toAddress, inbox.address);
  } finally {
    cleanup();
  }
});

test('cleanupExpired removes expired inboxes and their messages', () => {
  const { store, cleanup } = createTempStore();

  try {
    const inbox = store.createInbox({ name: 'cleanup', expiryTime: 10, domain: 'example.test' });
    store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'sender@test.dev',
      toAddress: inbox.address,
      subject: 'Cleanup me',
      content: 'bye',
      html: '',
      receivedAt: nowPlus(20),
      rawJson: '{}'
    });

    const removed = store.cleanupExpired(inbox.expiresAt + 1);
    assert.equal(removed, 1);
    assert.equal(store.getInboxById(inbox.id), null);
    assert.equal(store.listMessages(inbox.id).total, 0);
  } finally {
    cleanup();
  }
});

test('ensureInboxForAddress creates inbox record for UI-generated address', () => {
  const { store, cleanup } = createTempStore();

  try {
    const inbox = ensureInboxForAddress(store, 'demo-ui@example.test');
    assert.equal(inbox.address, 'demo-ui@example.test');

    const persisted = store.getInboxByAddress('demo-ui@example.test');
    assert.equal(persisted.address, 'demo-ui@example.test');
  } finally {
    cleanup();
  }
});

function nowPlus(delta) {
  return Date.now() + delta;
}
