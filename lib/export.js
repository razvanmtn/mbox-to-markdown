import { Zip, ZipDeflate, strToU8 } from 'fflate';
import { convertMessage } from './convert.js';
import { readMessage } from './mbox.js';

export async function buildZip({ source, messages, ids, write } = {}) {
  const chosen = chooseMessages(messages, ids);
  if (!chosen.length) throw new Error('Select at least one email');

  const pending = [];
  const stored = [];
  let failed = null;
  const zip = new Zip((error, data) => {
    if (error) {
      failed = error instanceof Error ? error : new Error(String(error));
      return;
    }
    if (data?.length) pending.push(data.slice());
  });

  async function flush() {
    if (failed) throw failed;
    if (!pending.length) return;
    const chunk = concatBytes(pending);
    pending.length = 0;
    if (write) await write(chunk);
    else stored.push(chunk);
  }

  const used = new Set();
  const errors = [];

  for (const message of chosen) {
    if (message.error) {
      errors.push(`${message.subject || `Message ${message.id}`}: ${message.error}`);
      continue;
    }
    try {
      const raw = await readMessage(source, message.start, message.end);
      const converted = await convertMessage(raw, { used });
      addEntry(zip, converted.markdownPath, strToU8(converted.markdown));
      for (const attachment of converted.attachments) {
        addEntry(zip, attachment.zipPath, asBytes(attachment.content));
      }
    } catch (error) {
      errors.push(`${message.subject || `Message ${message.id}`}: ${error.message}`);
    }
    await flush();
  }

  if (errors.length) {
    addEntry(zip, 'export-errors.txt', strToU8(`${errors.join('\n')}\n`));
    await flush();
  }

  try {
    zip.end();
  } catch (error) {
    failed = error;
  }
  await flush();
  if (failed) throw failed;
  if (write) return undefined;
  return concatBytes(stored);
}

function addEntry(zip, name, data) {
  const entry = new ZipDeflate(name, { level: 6 });
  zip.add(entry);
  entry.push(data, true);
}

function chooseMessages(messages, ids) {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const chosen = [];
  const seen = new Set();
  for (const id of ids || []) {
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    chosen.push(byId.get(id));
  }
  chosen.sort((left, right) => stamp(left) - stamp(right) || left.id - right.id);
  return chosen;
}

function stamp(message) {
  if (!message.date) return Number.POSITIVE_INFINITY;
  const value = Date.parse(message.date);
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

function asBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return new Uint8Array(0);
}

function concatBytes(parts) {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
