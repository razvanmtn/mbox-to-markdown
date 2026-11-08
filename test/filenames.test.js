import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveAttachmentName, reserveEmailPath, sanitizeFilename, slugify } from '../lib/filenames.js';

test('groups emails by year and month and suffixes collisions', () => {
  const used = new Set();
  const date = new Date('2024-01-01T12:00:00Z');
  const first = reserveEmailPath(date, 'Invoice from Acme', used);
  const second = reserveEmailPath(date, 'Invoice from Acme', used);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  assert.equal(first.markdownPath, `${year}/${month}/${year}-${month}-${day}-invoice-from-acme.md`);
  assert.equal(first.attachmentDir, `${year}/${month}/attachments`);
  assert.equal(second.markdownPath, `${year}/${month}/${year}-${month}-${day}-invoice-from-acme-2.md`);
});

test('puts undated messages in an undated folder', () => {
  const used = new Set();
  const path = reserveEmailPath(new Date('not-a-date'), 'Hello there', used);
  assert.equal(path.markdownPath, 'undated/undated-hello-there.md');
  assert.equal(path.attachmentDir, 'undated/attachments');
});

test('keeps attachment names unique inside a month folder', () => {
  const used = new Set();
  const dir = '2024/01/attachments';
  assert.equal(reserveAttachmentName(dir, 'invoice.pdf', used), 'invoice.pdf');
  assert.equal(reserveAttachmentName(dir, '../invoice.pdf', used), 'invoice-2.pdf');
  assert.equal(sanitizeFilename('..\\weird:name?.pdf'), 'weird-name.pdf');
});

test('strips emoji and characters Obsidian will not accept', () => {
  assert.equal(slugify('  Hello 😀 #world  '), 'hello-world');
  assert.equal(slugify('🎉'), 'no-subject');
  assert.equal(slugify('Notes ^ [draft]'), 'notes-draft');
  assert.equal(sanitizeFilename('report 😀.pdf'), 'report.pdf');
  assert.equal(sanitizeFilename('notes#^[].md'), 'notes.md');
});
