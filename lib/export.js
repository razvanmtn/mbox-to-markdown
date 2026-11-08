import archiver from 'archiver';
import { convertMessage } from './convert.js';
import { readMessage } from './mbox.js';

export async function writeZip({ filePath, messages, ids, output }) {
  const archive = archiver('zip', { zlib: { level: 6 } });
  const failure = new Promise((resolve, reject) => {
    archive.on('error', reject);
    output.on('error', reject);
    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT') reject(error);
    });
    archive.once('end', resolve);
  });

  archive.pipe(output);
  const used = new Set();
  const errors = [];

  for (const message of chooseMessages(messages, ids)) {
    if (message.error) {
      errors.push(`${message.subject || `Message ${message.id}`}: ${message.error}`);
      continue;
    }
    try {
      const raw = await readMessage(filePath, message.start, message.end);
      const converted = await convertMessage(raw, { used });
      archive.append(converted.markdown, { name: converted.markdownPath });
      for (const attachment of converted.attachments) {
        archive.append(attachment.content, { name: attachment.zipPath });
      }
    } catch (error) {
      errors.push(`${message.subject || `Message ${message.id}`}: ${error.message}`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  if (errors.length) {
    archive.append(`${errors.join('\n')}\n`, { name: 'export-errors.txt' });
  }

  await archive.finalize();
  await failure;
}

function chooseMessages(messages, ids) {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const chosen = [];
  const seen = new Set();
  for (const id of ids) {
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
