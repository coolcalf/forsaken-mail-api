'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const appPath = path.join(__dirname, '..', 'app');
const dbModulePath = path.join(__dirname, '..', 'modules', 'db');

async function createInbox(request, payload) {
  const response = await request('/api/emails/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  assert.equal(response.status, 200);
  return response.json();
}

function loadApp() {
  const resolved = require.resolve(appPath);
  delete require.cache[resolved];
  return require(appPath);
}

async function withServer(handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forsaken-mail-api-'));
  process.env.FORSAKEN_MAIL_DB_PATH = path.join(dir, 'test.sqlite');
  process.env.FORSAKEN_MAIL_DOMAINS = 'example.test';

  const dbModule = require(dbModulePath);
  dbModule.resetStore();

  const app = loadApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler({
      request: (pathname, options) => fetch(`${baseUrl}${pathname}`, options),
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    delete process.env.FORSAKEN_MAIL_DB_PATH;
    delete process.env.FORSAKEN_MAIL_DOMAINS;
    dbModule.resetStore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('POST /api/emails/generate creates inbox with moemail-compatible response', async () => {
  await withServer(async ({ request }) => {
    const response = await request('/api/emails/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'demo',
        domain: 'example.test',
        expiryTime: 24 * 60 * 60 * 1000
      })
    });

    assert.equal(response.headers.get('content-type')?.includes('application/json'), true);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(typeof body.id, 'string');
    assert.equal(body.email, 'demo@example.test');
  });
});

test('POST /api/emails/generate defaults expiryTime to 24h when omitted', async () => {
  await withServer(async ({ request }) => {
    const response = await request('/api/emails/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'default-expiry',
        domain: 'example.test'
      })
    });

    assert.equal(response.status, 200);

    const listResponse = await request('/api/emails');
    const listBody = await listResponse.json();
    const created = listBody.emails.find((item) => item.address === 'default-expiry@example.test');

    assert.equal(Boolean(created), true);
    const ttl = created.expiresAt - created.createdAt;
    assert.equal(ttl >= 24 * 60 * 60 * 1000 - 1000, true);
    assert.equal(ttl <= 24 * 60 * 60 * 1000 + 1000, true);
  });
});

test('POST /api/emails/generate auto-generates a valid name when name is missing or blank', async () => {
  await withServer(async ({ request }) => {
    const missingNameResponse = await request('/api/emails/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        domain: 'example.test',
        expiryTime: 24 * 60 * 60 * 1000
      })
    });

    assert.equal(missingNameResponse.status, 200);

    const missingNameBody = await missingNameResponse.json();
    assert.match(missingNameBody.email, /^[a-z0-9._-]+@example\.test$/);

    const blankNameResponse = await request('/api/emails/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: '   ',
        domain: 'example.test',
        expiryTime: 24 * 60 * 60 * 1000
      })
    });

    assert.equal(blankNameResponse.status, 200);

    const blankNameBody = await blankNameResponse.json();
    assert.match(blankNameBody.email, /^[a-z0-9._-]+@example\.test$/);
  });
});

test('POST /api/emails/generate rejects invalid expiry values', async () => {
  await withServer(async ({ request }) => {
    const response = await request('/api/emails/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'bad-expiry',
        domain: 'example.test',
        expiryTime: 12345
      })
    });

    assert.equal(response.status, 400);
  });
});

test('POST /api/emails/generate rejects duplicate active addresses', async () => {
  await withServer(async ({ request }) => {
    const payload = {
      name: 'duplicate',
      domain: 'example.test',
      expiryTime: 24 * 60 * 60 * 1000
    };

    const firstResponse = await request('/api/emails/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(firstResponse.status, 200);

    const secondResponse = await request('/api/emails/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(secondResponse.status, 409);
  });
});

test('GET /api/emails returns moemail-compatible list shape', async () => {
  await withServer(async ({ request }) => {
    await request('/api/emails/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'list-demo',
        domain: 'example.test',
        expiryTime: 24 * 60 * 60 * 1000
      })
    });

    const response = await request('/api/emails');
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.ok(Array.isArray(body.emails));
    assert.equal(typeof body.total, 'number');
    assert.equal(body.nextCursor, null);
    assert.equal(body.emails[0].address, 'list-demo@example.test');
  });
});

test('GET /api/health returns service health', async () => {
  await withServer(async ({ request }) => {
    const response = await request('/api/health');
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.storage, 'sqlite');
  });
});

test('GET /api/config returns primary configured domain for frontend', async () => {
  await withServer(async ({ request }) => {
    const response = await request('/api/config');
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.primaryDomain, 'example.test');
    assert.deepEqual(body.domains, ['example.test']);
    assert.equal(body.emailDomains, 'example.test');
  });
});

test('POST /api/config returns same compatibility payload as GET', async () => {
  await withServer(async ({ request }) => {
    const response = await request('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.primaryDomain, 'example.test');
    assert.deepEqual(body.domains, ['example.test']);
    assert.equal(body.emailDomains, 'example.test');
  });
});

test('API accepts optional X-API-Key auth when configured', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forsaken-mail-api-'));
  process.env.FORSAKEN_MAIL_DB_PATH = path.join(dir, 'test.sqlite');
  process.env.FORSAKEN_MAIL_DOMAINS = 'example.test';
  process.env.FORSAKEN_MAIL_API_KEY = 'secret-key';

  const dbModule = require(dbModulePath);
  dbModule.resetStore();

  const app = loadApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const unauthorized = await fetch(`${baseUrl}/api/config`);
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${baseUrl}/api/config`, {
      headers: { 'X-API-Key': 'secret-key' }
    });
    assert.equal(authorized.status, 200);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    delete process.env.FORSAKEN_MAIL_DB_PATH;
    delete process.env.FORSAKEN_MAIL_DOMAINS;
    delete process.env.FORSAKEN_MAIL_API_KEY;
    dbModule.resetStore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /admin/new_address creates temp_mail-compatible mailbox and returns jwt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forsaken-mail-api-'));
  process.env.FORSAKEN_MAIL_DB_PATH = path.join(dir, 'test.sqlite');
  process.env.FORSAKEN_MAIL_DOMAINS = 'example.test';
  process.env.FORSAKEN_MAIL_ADMIN_PASSWORD = 'admin-secret';

  const dbModule = require(dbModulePath);
  dbModule.resetStore();

  const app = loadApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/admin/new_address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-admin-auth': 'admin-secret'
      },
      body: JSON.stringify({
        enablePrefix: true,
        name: 'demo1',
        domain: 'example.test'
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.address, 'demo1@example.test');
    assert.equal(typeof body.jwt, 'string');
    assert.ok(body.jwt.length > 10);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    delete process.env.FORSAKEN_MAIL_DB_PATH;
    delete process.env.FORSAKEN_MAIL_DOMAINS;
    delete process.env.FORSAKEN_MAIL_ADMIN_PASSWORD;
    dbModule.resetStore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /admin/new_address skips auth when admin password is unset', async () => {
  await withServer(async ({ request }) => {
    const response = await request('/admin/new_address', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-auth': 'anything'
      },
      body: JSON.stringify({
        enablePrefix: true,
        name: 'openadmin',
        domain: 'example.test'
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.address, 'openadmin@example.test');
    assert.equal(typeof body.jwt, 'string');
  });
});

test('GET /api/mails and /api/mails/:id return temp_mail-compatible message payloads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forsaken-mail-api-'));
  process.env.FORSAKEN_MAIL_DB_PATH = path.join(dir, 'test.sqlite');
  process.env.FORSAKEN_MAIL_DOMAINS = 'example.test';
  process.env.FORSAKEN_MAIL_ADMIN_PASSWORD = 'admin-secret';

  const dbModule = require(dbModulePath);
  dbModule.resetStore();

  const app = loadApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const createResponse = await fetch(`${baseUrl}/admin/new_address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-auth': 'admin-secret'
      },
      body: JSON.stringify({
        enablePrefix: true,
        name: 'demo2',
        domain: 'example.test'
      })
    });

    const created = await createResponse.json();
    const store = dbModule.getStore({ dbPath: process.env.FORSAKEN_MAIL_DB_PATH });
    const inbox = store.getInboxByAddress(created.address);
    const message = store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'OpenAI <noreply@tm.openai.com>',
      toAddress: created.address,
      subject: 'Your OpenAI verification code',
      content: 'Your verification code is 123456',
      html: '<p>Your verification code is <b>123456</b></p>',
      rawJson: JSON.stringify({ raw: 'Your verification code is 123456' })
    });

    const listResponse = await fetch(`${baseUrl}/api/mails`, {
      headers: {
        'Authorization': `Bearer ${created.jwt}`
      }
    });

    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json();
    assert.ok(Array.isArray(listBody));
    assert.equal(listBody[0].id, message.id);
    assert.equal(listBody[0].source, 'OpenAI <noreply@tm.openai.com>');
    assert.equal(listBody[0].from, 'OpenAI <noreply@tm.openai.com>');
    assert.equal(listBody[0].subject, 'Your OpenAI verification code');
    assert.equal(listBody[0].text, 'Your verification code is 123456');
    assert.equal(listBody[0].body, 'Your verification code is 123456');
    assert.equal(listBody[0].content, 'Your verification code is 123456');
    assert.match(listBody[0].html, /123456/);
    assert.match(listBody[0].raw, /123456/);

    const detailResponse = await fetch(`${baseUrl}/api/mails/${message.id}`, {
      headers: {
        'Authorization': `Bearer ${created.jwt}`
      }
    });

    assert.equal(detailResponse.status, 200);
    const detailBody = await detailResponse.json();
    assert.equal(detailBody.id, message.id);
    assert.equal(detailBody.from_address, 'OpenAI <noreply@tm.openai.com>');
    assert.equal(detailBody.fromAddress, 'OpenAI <noreply@tm.openai.com>');
    assert.equal(detailBody.title, 'Your OpenAI verification code');
    assert.equal(detailBody.text, 'Your verification code is 123456');
    assert.match(detailBody.html, /123456/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    delete process.env.FORSAKEN_MAIL_DB_PATH;
    delete process.env.FORSAKEN_MAIL_DOMAINS;
    delete process.env.FORSAKEN_MAIL_ADMIN_PASSWORD;
    dbModule.resetStore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/mails supports address lookup without bearer token', async () => {
  await withServer(async ({ request }) => {
    const dbModule = require(dbModulePath);
    const store = dbModule.getStore({ dbPath: process.env.FORSAKEN_MAIL_DB_PATH });
    const inbox = store.createInbox({
      name: 'lookup',
      domain: 'example.test',
      expiryTime: 24 * 60 * 60 * 1000
    });

    store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'sender@example.com',
      toAddress: 'lookup@example.test',
      subject: 'Code',
      content: '654321',
      html: '<p>654321</p>',
      rawJson: JSON.stringify({ raw: '654321' })
    });

    const response = await request('/api/mails?address=lookup@example.test');
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.ok(Array.isArray(body));
    assert.equal(body[0].text, '654321');
  });
});

test('GET /admin/mails returns temp_mail-compatible admin result shape', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forsaken-mail-api-'));
  process.env.FORSAKEN_MAIL_DB_PATH = path.join(dir, 'test.sqlite');
  process.env.FORSAKEN_MAIL_DOMAINS = 'example.test';
  process.env.FORSAKEN_MAIL_ADMIN_PASSWORD = 'admin-secret';

  const dbModule = require(dbModulePath);
  dbModule.resetStore();

  const app = loadApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const store = dbModule.getStore({ dbPath: process.env.FORSAKEN_MAIL_DB_PATH });
    const inboxA = store.createInbox({ name: 'admin1', domain: 'example.test', expiryTime: 24 * 60 * 60 * 1000 });
    const inboxB = store.createInbox({ name: 'admin2', domain: 'example.test', expiryTime: 24 * 60 * 60 * 1000 });

    store.insertMessage({
      emailId: inboxA.id,
      fromAddress: 'OpenAI <noreply@tm.openai.com>',
      toAddress: inboxA.address,
      subject: 'First code',
      content: '111111',
      html: '<p>111111</p>',
      rawJson: JSON.stringify({ raw: '111111' }),
      receivedAt: Date.now() - 1000
    });

    store.insertMessage({
      emailId: inboxB.id,
      fromAddress: 'OpenAI <noreply@tm.openai.com>',
      toAddress: inboxB.address,
      subject: 'Second code',
      content: '222222',
      html: '<p>222222</p>',
      rawJson: JSON.stringify({ raw: '222222' }),
      receivedAt: Date.now()
    });

    const response = await fetch(`${baseUrl}/admin/mails?limit=1&offset=0`, {
      headers: { 'x-admin-auth': 'admin-secret' }
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.results));
    assert.equal(body.results.length, 1);
    assert.equal(body.total, 2);
    assert.equal(body.results[0].address, inboxB.address);
    assert.equal(body.results[0].source, 'OpenAI <noreply@tm.openai.com>');
    assert.equal(body.results[0].subject, 'Second code');
    assert.equal(body.results[0].text, '222222');
    assert.match(body.results[0].html, /222222/);
    assert.match(body.results[0].raw, /222222/);
    assert.equal(typeof body.results[0].createdAt, 'number');
    assert.equal(typeof body.results[0].created_at, 'number');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    delete process.env.FORSAKEN_MAIL_DB_PATH;
    delete process.env.FORSAKEN_MAIL_DOMAINS;
    delete process.env.FORSAKEN_MAIL_ADMIN_PASSWORD;
    dbModule.resetStore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /admin/mails filters by address and reuses admin auth behavior', async () => {
  await withServer(async ({ request }) => {
    const dbModule = require(dbModulePath);
    const store = dbModule.getStore({ dbPath: process.env.FORSAKEN_MAIL_DB_PATH });
    const inbox = store.createInbox({
      name: 'target',
      domain: 'example.test',
      expiryTime: 24 * 60 * 60 * 1000
    });
    const other = store.createInbox({
      name: 'other',
      domain: 'example.test',
      expiryTime: 24 * 60 * 60 * 1000
    });

    store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'sender@example.com',
      toAddress: inbox.address,
      subject: 'Need code',
      content: '333333',
      html: '<p>333333</p>',
      rawJson: JSON.stringify({ raw: '333333' })
    });

    store.insertMessage({
      emailId: other.id,
      fromAddress: 'sender@example.com',
      toAddress: other.address,
      subject: 'Ignore code',
      content: '444444',
      html: '<p>444444</p>',
      rawJson: JSON.stringify({ raw: '444444' })
    });

    const response = await request('/admin/mails?limit=20&offset=0&address=target@example.test');
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.total, 1);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].address, 'target@example.test');
    assert.equal(body.results[0].text, '333333');
  });
});

test('unknown API routes return JSON 404 instead of empty reply', async () => {
  await withServer(async ({ request }) => {
    const response = await request('/api/not-found');
    assert.equal(response.status, 404);

    const body = await response.json();
    assert.equal(body.error, 'Not Found');
  });
});

test('GET / injects versioned frontend assets to avoid stale browser cache', async () => {
  await withServer(async ({ request }) => {
    const response = await request('/');
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /\/js\/app\.js\?v=/);
    assert.match(html, /\/css\/app\.css\?v=/);
  });
});

test('GET / includes domain selector markup for multi-domain frontend', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forsaken-mail-api-'));
  process.env.FORSAKEN_MAIL_DB_PATH = path.join(dir, 'test.sqlite');
  process.env.FORSAKEN_MAIL_DOMAINS = 'example.test,mail.example.test';

  const dbModule = require(dbModulePath);
  dbModule.resetStore();

  const app = loadApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /id="domainSelect"/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    delete process.env.FORSAKEN_MAIL_DB_PATH;
    delete process.env.FORSAKEN_MAIL_DOMAINS;
    dbModule.resetStore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET / includes inbox table class for refined mail list layout', async () => {
  await withServer(async ({ request }) => {
    const response = await request('/');
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /class="ui very basic selectable table inboxTable"/);
  });
});

test('GET / includes language toggle hook for bilingual UI', async () => {
  await withServer(async ({ request }) => {
    const response = await request('/');
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /id="languageToggle"/);
  });
});

test('frontend script no longer relies on full page reload for custom prefix changes', () => {
  const script = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.doesNotMatch(script, /window\.location\.reload\(/);
});

test('frontend script loads inbox history after applying custom prefix', () => {
  const script = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(script, /loadInboxHistory\(/);
});

test('frontend script exposes loading state for inbox history fetch', () => {
  const script = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(script, /setInboxLoading\(/);
});

test('frontend styles include invalid custom prefix input state', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
  assert.match(css, /addressInputWrap\.invalid/);
});

test('frontend styles include success state for applied custom prefix', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
  assert.match(css, /\.addressInputWrap\.success/);
});

test('GET /api/emails supports cursor pagination', async () => {
  await withServer(async ({ request }) => {
    const first = await createInbox(request, {
      name: 'page-a',
      domain: 'example.test',
      expiryTime: 24 * 60 * 60 * 1000
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await createInbox(request, {
      name: 'page-b',
      domain: 'example.test',
      expiryTime: 24 * 60 * 60 * 1000
    });

    const firstPageResponse = await request('/api/emails?limit=1');
    assert.equal(firstPageResponse.status, 200);
    const firstPage = await firstPageResponse.json();
    assert.equal(firstPage.emails.length, 1);
    assert.equal(firstPage.emails[0].id, second.id);
    assert.equal(typeof firstPage.nextCursor, 'string');

    const secondPageResponse = await request(`/api/emails?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`);
    assert.equal(secondPageResponse.status, 200);
    const secondPage = await secondPageResponse.json();
    assert.equal(secondPage.emails.length, 1);
    assert.equal(secondPage.emails[0].id, first.id);
  });
});

test('GET /api/emails/:id returns message list shape', async () => {
  await withServer(async ({ request }) => {
    const inbox = await createInbox(request, {
      name: 'detail-demo',
      domain: 'example.test',
      expiryTime: 24 * 60 * 60 * 1000
    });

    const dbModule = require(dbModulePath);
    const store = dbModule.getStore();
    store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'sender@test.dev',
      toAddress: inbox.email,
      subject: 'Stored message',
      content: 'plain',
      html: '<p>plain</p>',
      receivedAt: Date.now(),
      rawJson: '{}'
    });

    const response = await request(`/api/emails/${inbox.id}`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.ok(Array.isArray(body.messages));
    assert.equal(body.total, 1);
    assert.equal(body.nextCursor, null);
    assert.equal(body.messages[0].from_address, 'sender@test.dev');
  });
});

test('GET /api/emails/:id supports cursor pagination', async () => {
  await withServer(async ({ request }) => {
    const inbox = await createInbox(request, {
      name: 'message-page-demo',
      domain: 'example.test',
      expiryTime: 24 * 60 * 60 * 1000
    });

    const dbModule = require(dbModulePath);
    const store = dbModule.getStore();
    const firstMessage = store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'first@test.dev',
      toAddress: inbox.email,
      subject: 'First page message',
      content: 'one',
      html: '',
      receivedAt: 1000,
      rawJson: '{}'
    });
    const secondMessage = store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'second@test.dev',
      toAddress: inbox.email,
      subject: 'Second page message',
      content: 'two',
      html: '',
      receivedAt: 2000,
      rawJson: '{}'
    });

    const firstPageResponse = await request(`/api/emails/${inbox.id}?limit=1`);
    assert.equal(firstPageResponse.status, 200);
    const firstPage = await firstPageResponse.json();
    assert.equal(firstPage.messages.length, 1);
    assert.equal(firstPage.messages[0].id, secondMessage.id);
    assert.equal(typeof firstPage.nextCursor, 'string');

    const secondPageResponse = await request(`/api/emails/${inbox.id}?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`);
    assert.equal(secondPageResponse.status, 200);
    const secondPage = await secondPageResponse.json();
    assert.equal(secondPage.messages.length, 1);
    assert.equal(secondPage.messages[0].id, firstMessage.id);
  });
});

test('GET /api/emails/:id/:messageId returns single message shape', async () => {
  await withServer(async ({ request }) => {
    const inbox = await createInbox(request, {
      name: 'message-demo',
      domain: 'example.test',
      expiryTime: 24 * 60 * 60 * 1000
    });

    const dbModule = require(dbModulePath);
    const store = dbModule.getStore();
    const message = store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'sender@test.dev',
      toAddress: inbox.email,
      subject: 'Single message',
      content: 'plain',
      html: '<p>plain</p>',
      receivedAt: Date.now(),
      rawJson: '{}'
    });

    const response = await request(`/api/emails/${inbox.id}/${message.id}`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.message.id, message.id);
    assert.equal(body.message.subject, 'Single message');
    assert.equal(body.message.type, 'received');
  });
});

test('DELETE /api/emails/:id/:messageId deletes a single message', async () => {
  await withServer(async ({ request }) => {
    const inbox = await createInbox(request, {
      name: 'delete-message-demo',
      domain: 'example.test',
      expiryTime: 24 * 60 * 60 * 1000
    });

    const dbModule = require(dbModulePath);
    const store = dbModule.getStore();
    const message = store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'sender@test.dev',
      toAddress: inbox.email,
      subject: 'Delete me',
      content: 'plain',
      html: '',
      receivedAt: Date.now(),
      rawJson: '{}'
    });

    const response = await request(`/api/emails/${inbox.id}/${message.id}`, {
      method: 'DELETE'
    });
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(store.listMessages(inbox.id).total, 0);
  });
});

test('DELETE /api/emails/:id deletes inbox and messages', async () => {
  await withServer(async ({ request }) => {
    const inbox = await createInbox(request, {
      name: 'delete-inbox-demo',
      domain: 'example.test',
      expiryTime: 24 * 60 * 60 * 1000
    });

    const dbModule = require(dbModulePath);
    const store = dbModule.getStore();
    store.insertMessage({
      emailId: inbox.id,
      fromAddress: 'sender@test.dev',
      toAddress: inbox.email,
      subject: 'Delete inbox',
      content: 'plain',
      html: '',
      receivedAt: Date.now(),
      rawJson: '{}'
    });

    const response = await request(`/api/emails/${inbox.id}`, {
      method: 'DELETE'
    });
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(store.getInboxById(inbox.id), null);
  });
});
