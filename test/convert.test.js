import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { convertMessage } from '../lib/convert.js';
import { indexMbox, readMessage } from '../lib/mbox.js';
import { openFileSource } from '../lib/node-source.js';

const fixture = fileURLToPath(new URL('./fixtures/sample.mbox', import.meta.url));

async function indexedFixture() {
  const source = await openFileSource(fixture);
  return { source, messages: await indexMbox(source) };
}

function datedPath(iso, slug) {
  const date = new Date(iso);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${year}-${month}-${day}-${slug}.md`;
}

test('converts html mail to markdown with attachment links', async () => {
  const { source, messages } = await indexedFixture();
  const raw = await readMessage(source, messages[0].start, messages[0].end);
  const used = new Set();
  const converted = await convertMessage(raw, { used });

  assert.equal(converted.markdownPath, datedPath('2024-01-01T12:00:00Z', 'invoice-from-acme'));
  assert.match(converted.markdown, /^---\ntype: email\n/);
  assert.match(converted.markdown, /^subject: "Invoice from Acme"$/m);
  assert.match(converted.markdown, /^labels:\n  - "Inbox"\n  - "Finance"$/m);
  assert.match(converted.markdown, /^date: "\d{4}-\d{2}-\d{2}"$/m);
  assert.match(converted.markdown, /^time: "\d{2}:\d{2}"$/m);
  assert.match(converted.markdown, /\nHello there\n/);
  assert.doesNotMatch(converted.markdown, /\|/);
  assert.match(converted.markdown, /\[invoice\.pdf\]\(attachments\/invoice\.pdf\)/);
  assert.match(converted.previewHtml, /data:image\/png;base64,/);
  assert.equal(converted.attachments.map((item) => item.filename).sort().join(','), 'invoice.pdf,logo.png');

  const again = await convertMessage(raw, { used });
  assert.equal(again.markdownPath, datedPath('2024-01-01T12:00:00Z', 'invoice-from-acme-2'));
  assert.equal(again.attachments.some((item) => item.filename === 'invoice-2.pdf'), true);
});

test('uses the plain-text part when there is no html', async () => {
  const { source, messages } = await indexedFixture();
  const raw = await readMessage(source, messages[1].start, messages[1].end);
  const converted = await convertMessage(raw);
  assert.match(converted.markdown, /^From the archives, this line should be unquoted\.$/m);
  assert.match(converted.markdown, /^>From a nested quote\.$/m);
  assert.equal(converted.attachments.length, 0);
  assert.equal(converted.markdownPath, datedPath('2024-01-02T12:00:00Z', 'weekly-notes'));
});

test('writes html tables as plain text', async () => {
  const raw = [
    'From: Ada <ada@example.com>',
    'To: Bob <bob@example.com>',
    'Subject: Table note',
    'Date: Mon, 1 Jan 2024 12:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="utf-8"',
    '',
    '<html><body><table><tr><td>Left cell</td><td>Right cell</td></tr></table><p>After the table</p></body></html>',
    '',
  ].join('\n');
  const converted = await convertMessage(raw);
  assert.match(converted.markdown, /Left cell/);
  assert.match(converted.markdown, /Right cell/);
  assert.match(converted.markdown, /After the table/);
  assert.doesNotMatch(converted.markdown, /\|/);
});
