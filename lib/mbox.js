const FROM_PREFIX = [0x46, 0x72, 0x6f, 0x6d, 0x20];
const NEWLINE = new Uint8Array([0x0a]);
const latin1 = new TextDecoder('latin1');
const ENCODED_WORD = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;

export function unescapeMbox(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const parts = [];
  let start = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index !== bytes.length && bytes[index] !== 0x0a) continue;
    let lineEnd = index;
    const hadNewline = index < bytes.length;
    if (lineEnd > start && bytes[lineEnd - 1] === 0x0d) lineEnd -= 1;
    parts.push(unescapeLine(bytes.subarray(start, lineEnd)));
    if (hadNewline) parts.push(NEWLINE);
    start = index + 1;
  }
  return concatBytes(parts);
}

export async function readMessage(source, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    throw new Error('Invalid message range');
  }
  return unescapeMbox(await source.read(start, end));
}

export async function indexMbox(source, { onProgress } = {}) {
  const { size } = source;
  const parser = createParser();
  let bytesRead = 0;

  for await (const chunk of source.stream()) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    parser.push(bytes, false);
    bytesRead += bytes.length;
    onProgress?.({ bytesRead, size, count: parser.count() });
  }

  parser.push(new Uint8Array(0), true);
  onProgress?.({ bytesRead: size, size, count: parser.count() });
  return parser.messages();
}

function unescapeLine(line) {
  if (line.length < FROM_PREFIX.length + 1 || line[0] !== 0x3e) return line;
  let marker = 0;
  while (marker < line.length && line[marker] === 0x3e) marker += 1;
  if (marker + FROM_PREFIX.length <= line.length && hasPrefix(line.subarray(marker), FROM_PREFIX)) {
    return line.subarray(1);
  }
  return line;
}

function createParser() {
  const messages = [];
  let pending = new Uint8Array(0);
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
      else headerLines.push(latin1.decode(line));
      return;
    }
    if (looksLikeAttachment(line)) hasAttachments = true;
  }

  function push(chunk, eof) {
    if (chunk.length) {
      pending = pending.length ? concatBytes([pending, chunk]) : chunk;
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
      pending = pending.slice();
    }

    if (eof) {
      if (pending.length) {
        let line = pending;
        if (line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
        handleLine(line, fileOffset, fileOffset + pending.length);
        fileOffset += pending.length;
        pending = new Uint8Array(0);
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
  return line.length >= FROM_PREFIX.length && hasPrefix(line, FROM_PREFIX);
}

function hasPrefix(bytes, prefix) {
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
}

function looksLikeAttachment(line) {
  const sample = latin1.decode(line.subarray(0, Math.min(200, line.length))).toLowerCase();
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
    const collapsed = value.replace(/\?=\s+=\?/g, '?==?');
    const decoded = collapsed.replace(ENCODED_WORD, (_match, charset, encoding, text) => (
      decodeWord(charset, encoding, text)
    ));
    return decoded.replace(/\s+/g, ' ').trim();
  } catch {
    return String(value).replace(/\s+/g, ' ').trim();
  }
}

function decodeWord(charset, encoding, text) {
  try {
    const bytes = encoding.toUpperCase() === 'B'
      ? bytesFromBase64(text)
      : bytesFromQuoted(text);
    return decodeCharset(bytes, charset);
  } catch {
    return `=?${charset}?${encoding}?${text}?=`;
  }
}

function bytesFromQuoted(text) {
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '_') {
      bytes.push(0x20);
      continue;
    }
    if (character === '=' && index + 2 < text.length) {
      const hex = text.slice(index + 1, index + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        index += 2;
        continue;
      }
    }
    bytes.push(text.charCodeAt(index) & 0xff);
  }
  return Uint8Array.from(bytes);
}

function bytesFromBase64(text) {
  const clean = text.replace(/\s/g, '');
  const padded = clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeCharset(bytes, charset) {
  const label = String(charset || 'utf-8').trim();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch (error) {
    if (error instanceof RangeError) throw error;
    return new TextDecoder('utf-8').decode(bytes);
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
