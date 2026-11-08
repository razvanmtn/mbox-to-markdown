import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';

const execFileAsync = promisify(execFile);
const fixture = fileURLToPath(new URL('./fixtures/sample.mbox', import.meta.url));

test('uploads an mbox, previews a message, and downloads a zip', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mbox-md-app-'));
  const app = await createApp({ tempRoot });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const port = server.address().port;
  const page = await request({ port, method: 'GET', path: '/' });
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /Open a mailbox/);

  const upload = await request({
    port,
    method: 'POST',
    path: '/api/upload',
    ...multipart(await fs.readFile(fixture)),
  });
  assert.equal(upload.status, 200);

  const status = await waitUntilReady(port);
  assert.equal(status.messageCount, 4);

  const listed = await request({ port, method: 'GET', path: '/api/messages' });
  const { messages } = JSON.parse(listed.body.toString());
  assert.equal(messages[0].subject, 'Invoice from Acme');
  assert.equal(messages[0].hasAttachments, true);
  assert.equal(messages[3].error, 'Empty message');

  const preview = await request({ port, method: 'GET', path: '/api/messages/0' });
  const email = JSON.parse(preview.body.toString());
  assert.match(email.markdown, /^type: email$/m);
  assert.match(email.markdown, /attachments\/invoice\.pdf/);
  assert.match(email.html, /data:image\/png;base64,/);

  const pdf = await request({ port, method: 'GET', path: '/api/messages/0/attachments/1' });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers['content-type'], /pdf/);
  assert.match(pdf.headers['content-disposition'], /invoice\.pdf/);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');

  const early = await request({
    port,
    method: 'POST',
    path: '/api/export',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ ids: [] })),
  });
  assert.equal(early.status, 400);

  const body = Buffer.from('ids=0,1,2,3');
  const exported = await request({
    port,
    method: 'POST',
    path: '/api/export',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': body.length },
    body,
  });
  assert.equal(exported.status, 200);
  assert.match(exported.headers['content-type'], /application\/zip/);

  const zipPath = path.join(tempRoot, 'emails.zip');
  await fs.writeFile(zipPath, exported.body);
  const listing = await execFileAsync('unzip', ['-Z1', zipPath]);
  const names = listing.stdout.split('\n').filter(Boolean);
  assert.equal(names.some((name) => name.endsWith('/2024-01-01-invoice-from-acme.md') || name.endsWith('2024-01-01-invoice-from-acme.md')), true);
  assert.equal(names.some((name) => name.endsWith('2024-01-02-weekly-notes.md')), true);
  assert.equal(names.some((name) => name.endsWith('2024-02-01-cafe-notes.md')), true);
  assert.equal(names.some((name) => name.endsWith('attachments/invoice.pdf')), true);
  assert.equal(names.some((name) => name.endsWith('attachments/logo.png')), true);
  assert.equal(names.includes('export-errors.txt'), true);

  const notesName = names.find((name) => name.endsWith('2024-01-02-weekly-notes.md'));
  const notes = await execFileAsync('unzip', ['-p', zipPath, notesName]);
  assert.match(notes.stdout, /^From the archives, this line should be unquoted\.$/m);
  assert.match(notes.stdout, /^type: email$/m);

  const cleared = await request({ port, method: 'DELETE', path: '/api/session' });
  assert.equal(cleared.status, 200);
  const after = await request({ port, method: 'GET', path: '/api/status' });
  assert.equal(JSON.parse(after.body.toString()).status, 'empty');
});

function multipart(file) {
  const boundary = '----mboxform';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.mbox"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat([head, file, tail]),
  };
}

function request({ port, method, path: requestPath, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: body ? { ...headers, 'content-length': headers['content-length'] || body.length } : headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function waitUntilReady(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await request({ port, method: 'GET', path: '/api/status' });
    const status = JSON.parse(response.body.toString());
    if (status.status === 'ready') return status;
    if (status.status === 'error') throw new Error(status.error);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the mailbox scan');
}
