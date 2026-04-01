'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore } = require('../modules/db');
const { runCleanup, startCleanupScheduler } = require('../modules/cleanup');

function createTempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forsaken-mail-cleanup-'));
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

test('runCleanup removes expired inboxes immediately', () => {
  const { store, cleanup } = createTempStore();

  try {
    const inbox = store.createInbox({ name: 'expired-now', expiryTime: 1, domain: 'example.test' });
    store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'sender@test.dev',
      toAddress: inbox.address,
      subject: 'cleanup',
      content: 'cleanup',
      html: '',
      receivedAt: Date.now(),
      rawJson: '{}'
    });

    const removed = runCleanup(store, inbox.expiresAt + 10);
    assert.equal(removed, 1);
    assert.equal(store.getInboxById(inbox.id), null);
  } finally {
    cleanup();
  }
});

test('startCleanupScheduler runs cleanup on an interval', async () => {
  const { store, cleanup } = createTempStore();

  try {
    const inbox = store.createInbox({ name: 'scheduled-expired', expiryTime: 1, domain: 'example.test' });
    const scheduler = startCleanupScheduler(store, { intervalMs: 20 });

    await new Promise((resolve) => setTimeout(resolve, 80));

    scheduler.stop();
    assert.equal(store.getInboxById(inbox.id), null);
  } finally {
    cleanup();
  }
});
