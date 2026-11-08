import fs from 'node:fs';
import libmime from 'libmime';

const FROM_PREFIX = 'From ';

export function unescapeMbox(buffer) {
  const parts = [];
  let start = 0;
  for (let index = 0; index <= buffer.length; index += 1) {
    if (index !== buffer.length && buffer[index] !== 0x0a) continue;
    let lineEnd = index;
    const hadNewline = index < buffer.length;
    if (lineEnd > start && buffer[lineEnd - 1] === 0x0d) lineEnd -= 1;
    parts.push(unescapeLine(buffer.subarray(start, lineEnd)));
    if (hadNewline) parts.push(Buffer.from('\n'));
    start = index + 1;
  }
  return Buffer.concat(parts);
}

function unescapeLine(line) {
  if (line.length < FROM_PREFIX.length + 1 || line[0] !== 0x3e) return line;
  let marker = 0;
  while (marker < line.length && line[marker] === 0x3e) marker += 1;
  const rest = line.subarray(marker, marker + FROM_PREFIX.length);
  if (rest.length === FROM_PREFIX.length && rest.toString('latin1') === FROM_PREFIX) {
    return line.subarray(1);
  }
  return line;
}

export async function readMessage(filePath, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    throw new Error('Invalid message range');
  }
  const length = end - start;
  const buffer = Buffer.alloc(length);
  const handle = await fs.promises.open(filePath, 'r');
  try {
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return unescapeMbox(offset === length ? buffer : buffer.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

export async function indexMbox(filePath, { onProgress } = {}) {
  const { size } = await fs.promises.stat(filePath);
  const stream = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 });
  const parser = createParser();
  let bytesRead = 0;

  for await (const chunk of stream) {
    parser.push(chunk, false);
    bytesRead += chunk.length;
    onProgress?.({ bytesRead, size, count: parser.count() });
    await new Promise((resolve) => setImmediate(resolve));
  }

  parser.push(Buffer.alloc(0), true);
  onProgress?.({ bytesRead: size, size, count: parser.count() });
  return parser.messages();
}

function createParser() {
  const messages = [];
  let pending = Buffer.alloc(0);
  let fileOffset = 0;
  let open = false;
  let contentStart = 0;
  let headerLines = [];
  let headerDone = false;
  let hasAttachments = false;

  function count() {
    return messages.length + (open ? 1 : 0);
  }

  function close(end) {
    if (!open) return;
    const parsed = parseHeaders(headerLines.join('\n'));
    messages.push({
      id: messages.length,
      start: contentStart,
      end,
      ...parsed,
      hasAttachments,
      error: end <= contentStart ? 'Empty message' : null,
    });
    open = false;
    headerLines = [];
  }

  function handleLine(line, lineStart, nextOffset) {
    if (startsWithFrom(line)) {
      close(lineStart);
      open = true;
      contentStart = nextOffset;
      headerLines = [];
      headerDone = false;
      hasAttachments = false;
      return;
    }
    if (!open) return;
    if (!headerDone) {
      if (line.length === 0) headerDone = true;
      else headerLines.push(line.toString('latin1'));
      return;
    }
    if (looksLikeAttachment(line)) hasAttachments = true;
  }

  function push(chunk, eof) {
    if (chunk.length) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    }

    let searchFrom = 0;
    while (searchFrom < pending.length) {
      const newline = pending.indexOf(0x0a, searchFrom);
      if (newline === -1) break;
      let line = pending.subarray(searchFrom, newline);
      if (line.length && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
      handleLine(line, fileOffset + searchFrom, fileOffset + newline + 1);
      searchFrom = newline + 1;
    }

    if (searchFrom > 0) {
      pending = pending.subarray(searchFrom);
      fileOffset += searchFrom;
    }
    if (pending.length && pending.buffer.byteLength > pending.length + 64 * 1024) {
      pending = Buffer.from(pending);
    }

    if (eof) {
      if (pending.length) {
        let line = pending;
        if (line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
        handleLine(line, fileOffset, fileOffset + pending.length);
        fileOffset += pending.length;
        pending = Buffer.alloc(0);
      }
      close(fileOffset);
    }
  }

  return {
    push,
    count,
    messages: () => messages,
  };
}

function startsWithFrom(line) {
  return line.length >= FROM_PREFIX.length && line.subarray(0, FROM_PREFIX.length).toString('latin1') === FROM_PREFIX;
}

function looksLikeAttachment(line) {
  const sample = line.subarray(0, 200).toString('latin1').toLowerCase();
  if (sample.startsWith('content-disposition:') && (sample.includes('attachment') || sample.includes('filename'))) {
    return true;
  }
  return sample.startsWith('content-type:') && sample.includes('name=');
}

function parseHeaders(text) {
  const rawLines = text.split('\n');
  const lines = [];
  for (const raw of rawLines) {
    if (!raw) continue;
    if ((raw[0] === ' ' || raw[0] === '\t') && lines.length) {
      lines[lines.length - 1] += ` ${raw.trim()}`;
    } else {
      lines.push(raw);
    }
  }

  const headers = new Map();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!headers.has(key)) headers.set(key, []);
    headers.get(key).push(value);
  }

  const get = (key) => decodeHeader((headers.get(key) || []).join(', '));
  const subject = get('subject');
  return {
    from: get('from'),
    to: get('to'),
    cc: get('cc'),
    bcc: get('bcc'),
    subject: subject || '(no subject)',
    date: toIso(get('date')),
    labels: splitLabels(get('x-gmail-labels')),
    messageId: get('message-id'),
  };
}

function decodeHeader(value) {
  if (!value) return '';
  try {
    return libmime.decodeWords(value).replace(/\s+/g, ' ').trim();
  } catch {
    return value.replace(/\s+/g, ' ').trim();
  }
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function splitLabels(value) {
  if (!value) return [];
  return value.split(',').map((label) => label.trim()).filter(Boolean);
}
