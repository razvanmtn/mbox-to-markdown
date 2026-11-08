import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { buildZip } from '../lib/export.js';
import { indexMbox } from '../lib/mbox.js';
import { openFileSource } from '../lib/node-source.js';

const fixture = fileURLToPath(new URL('./fixtures/sample.mbox', import.meta.url));

async function indexedFixture() {
  const source = await openFileSource(fixture);
  return { source, messages: await indexMbox(source) };
}

test('exports selected messages as a zip', async () => {
  const { source, messages } = await indexedFixture();
  const zip = await buildZip({ source, messages, ids: [0, 1, 2, 3] });
  const files = unzipSync(zip);
  const names = Object.keys(files);

  assert.equal(names.some((name) => name.endsWith('invoice-from-acme.md')), true);
  assert.equal(names.some((name) => name.endsWith('weekly-notes.md')), true);
  assert.equal(names.some((name) => name.endsWith('cafe-notes.md')), true);
  assert.equal(names.some((name) => name.endsWith('attachments/invoice.pdf')), true);
  assert.equal(names.some((name) => name.endsWith('attachments/logo.png')), true);
  assert.equal(names.includes('export-errors.txt'), true);

  const notesName = names.find((name) => name.endsWith('weekly-notes.md'));
  const notes = strFromU8(files[notesName]);
  assert.match(notes, /^From the archives, this line should be unquoted\.$/m);
  assert.match(notes, /^type: email$/m);

  const pdfName = names.find((name) => name.endsWith('attachments/invoice.pdf'));
  assert.equal(strFromU8(files[pdfName].subarray(0, 4)), '%PDF');
  assert.match(strFromU8(files['export-errors.txt']), /Empty message/);
});

test('streams zip chunks that concatenate to the same archive', async () => {
  const { source, messages } = await indexedFixture();
  const chunks = [];
  await buildZip({
    source,
    messages,
    ids: [0, 1],
    write(chunk) {
      chunks.push(chunk);
    },
  });
  const whole = await buildZip({ source, messages, ids: [0, 1] });
  assert.deepEqual(concat(chunks), whole);
  assert.equal(Object.keys(unzipSync(concat(chunks))).some((name) => name.endsWith('invoice-from-acme.md')), true);
});

test('rejects an empty selection', async () => {
  const { source, messages } = await indexedFixture();
  await assert.rejects(
    () => buildZip({ source, messages, ids: [] }),
    /Select at least one email/,
  );
});

function concat(chunks) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
