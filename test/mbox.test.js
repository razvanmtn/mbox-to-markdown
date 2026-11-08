import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { indexMbox, readMessage, unescapeMbox } from '../lib/mbox.js';
import { bytesSource, openFileSource } from '../lib/node-source.js';

const fixture = fileURLToPath(new URL('./fixtures/sample.mbox', import.meta.url));
const utf8 = new TextDecoder();

test('removes one level of mboxrd From quoting', () => {
  const raw = new TextEncoder().encode('Hello\n>From the archives\n>>From nested\n>Not from here\n');
  assert.equal(utf8.decode(unescapeMbox(raw)), 'Hello\nFrom the archives\n>From nested\n>Not from here\n');
});

test('indexes headers without decoding bodies', async () => {
  const messages = await indexMbox(await openFileSource(fixture, { highWaterMark: 32 }));
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
  const source = await openFileSource(fixture);
  const messages = await indexMbox(source);
  const raw = await readMessage(source, messages[1].start, messages[1].end);
  const text = utf8.decode(raw);
  assert.match(text, /^From the archives, this line should be unquoted\.$/m);
  assert.match(text, /^>From a nested quote\.$/m);
  assert.equal(text.includes('>From the archives'), false);
});

test('indexes CRLF mailboxes', async () => {
  const raw = [
    'From ada@example.com Mon Jan  1 12:00:00 2024',
    'From: Ada <ada@example.com>',
    'Subject: Line endings',
    'Date: Mon, 1 Jan 2024 12:00:00 +0000',
    '',
    'Hello from CRLF',
    '',
  ].join('\r\n');
  const source = bytesSource(raw);
  const messages = await indexMbox(source);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].subject, 'Line endings');
  const body = await readMessage(source, messages[0].start, messages[0].end);
  assert.match(utf8.decode(body), /Hello from CRLF/);
});
