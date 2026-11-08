import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { indexMbox, readMessage, unescapeMbox } from '../lib/mbox.js';

const fixture = fileURLToPath(new URL('./fixtures/sample.mbox', import.meta.url));

test('removes one level of mboxrd From quoting', () => {
  const raw = Buffer.from('Hello\n>From the archives\n>>From nested\n>Not from here\n');
  assert.equal(unescapeMbox(raw).toString('utf8'), 'Hello\nFrom the archives\n>From nested\n>Not from here\n');
});

test('indexes headers without decoding bodies', async () => {
  const messages = await indexMbox(fixture, { highWaterMark: 32 });
  assert.equal(messages.length, 4);
  assert.deepEqual(messages.map((message) => message.subject), [
    'Invoice from Acme',
    'Weekly notes',
    'Café notes',
    '(no subject)',
  ]);
  assert.deepEqual(messages[0].labels, ['Inbox', 'Finance']);
  assert.equal(messages[0].hasAttachments, true);
  assert.equal(messages[1].hasAttachments, false);
  assert.equal(messages[2].from.includes('Café'), true);
  assert.equal(messages[3].error, 'Empty message');
  assert.equal(messages[0].end > messages[0].start, true);
});

test('reads a message back with From lines restored', async () => {
  const messages = await indexMbox(fixture);
  const raw = await readMessage(fixture, messages[1].start, messages[1].end);
  const text = raw.toString('utf8');
  assert.match(text, /^From the archives, this line should be unquoted\.$/m);
  assert.match(text, /^>From a nested quote\.$/m);
  assert.equal(text.includes('>From the archives'), false);
});

test('indexes CRLF mailboxes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbox-crlf-'));
  const filePath = path.join(dir, 'crlf.mbox');
  const raw = [
    'From ada@example.com Mon Jan  1 12:00:00 2024',
    'From: Ada <ada@example.com>',
    'Subject: Line endings',
    'Date: Mon, 1 Jan 2024 12:00:00 +0000',
    '',
    'Hello from CRLF',
    '',
  ].join('\r\n');
  await fs.writeFile(filePath, raw);
  try {
    const messages = await indexMbox(filePath);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].subject, 'Line endings');
    const body = await readMessage(filePath, messages[0].start, messages[0].end);
    assert.match(body.toString('utf8'), /Hello from CRLF/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
