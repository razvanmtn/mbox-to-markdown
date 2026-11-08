import { buildZip } from '../lib/export.js';
import { convertMessage } from '../lib/convert.js';
import { indexMbox, readMessage } from '../lib/mbox.js';
import { blobSource } from './blob-source.js';

const ONE_GB = 1024 * 1024 * 1024;

let generation = 0;
let source = null;
let messages = [];
const chunkWaits = new Map();

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'open') {
    openMailbox(message.file);
    return;
  }
  if (message.type === 'close') {
    generation += 1;
    source = null;
    messages = [];
    return;
  }
  if (message.type === 'read') {
    readOne(message);
    return;
  }
  if (message.type === 'export') {
    exportZip(message);
    return;
  }
  if (message.type === 'zip-ack') {
    const wait = chunkWaits.get(message.requestId);
    chunkWaits.delete(message.requestId);
    wait?.resolve();
    return;
  }
  if (message.type === 'zip-fail') {
    const wait = chunkWaits.get(message.requestId);
    chunkWaits.delete(message.requestId);
    wait?.reject(new Error(message.error || 'Export failed'));
  }
};

async function openMailbox(file) {
  const current = ++generation;
  source = null;
  messages = [];
  if (!file) {
    self.postMessage({ type: 'error', error: 'Choose an mbox file' });
    return;
  }
  if (file.size > ONE_GB) {
    self.postMessage({ type: 'error', error: 'File exceeds the 1 GB limit' });
    return;
  }
  const nextSource = blobSource(file);
  try {
    const indexed = await indexMbox(nextSource, {
      onProgress(progress) {
        if (current !== generation) return;
        self.postMessage({ type: 'progress', ...progress });
      },
    });
    if (current !== generation) return;
    source = nextSource;
    messages = indexed;
    self.postMessage({ type: 'ready', messages: indexed.map(summarize) });
  } catch (error) {
    if (current !== generation) return;
    self.postMessage({ type: 'error', error: error.message || 'Could not read that file' });
  }
}

async function readOne({ requestId, id }) {
  const current = generation;
  if (!source) {
    self.postMessage({ type: 'message-error', requestId, error: 'No mailbox is ready' });
    return;
  }
  const message = messages.find((item) => item.id === id);
  if (!message) {
    self.postMessage({ type: 'message-error', requestId, error: 'Email not found' });
    return;
  }
  if (message.error) {
    self.postMessage({ type: 'message-error', requestId, error: message.error });
    return;
  }
  try {
    const raw = await readMessage(source, message.start, message.end);
    if (current !== generation) return;
    const converted = await convertMessage(raw);
    if (current !== generation) return;
    const payload = previewPayload(id, converted);
    const transfer = payload.attachments.map((item) => item.content.buffer).filter((buffer) => buffer.byteLength);
    self.postMessage({ type: 'message', requestId, payload }, transfer);
  } catch (error) {
    if (current !== generation) return;
    self.postMessage({ type: 'message-error', requestId, error: error.message });
  }
}

async function exportZip({ requestId, ids, stream }) {
  const current = generation;
  if (!source) {
    self.postMessage({ type: 'zip-error', requestId, error: 'No mailbox is ready' });
    return;
  }
  try {
    const bytes = await buildZip({
      source,
      messages,
      ids,
      write: stream ? (chunk) => sendChunk(requestId, chunk, current) : undefined,
    });
    if (current !== generation) return;
    if (stream) {
      self.postMessage({ type: 'zip-end', requestId });
      return;
    }
    const copy = bytesCopy(bytes);
    self.postMessage({ type: 'zip-done', requestId, bytes: copy }, [copy.buffer]);
  } catch (error) {
    if (current !== generation) return;
    self.postMessage({ type: 'zip-error', requestId, error: error.message });
  }
}

function sendChunk(requestId, chunk, current) {
  if (current !== generation) throw new Error('Export cancelled');
  const copy = bytesCopy(chunk);
  return new Promise((resolve, reject) => {
    chunkWaits.set(requestId, { resolve, reject });
    self.postMessage({ type: 'zip-chunk', requestId, chunk: copy }, [copy.buffer]);
  });
}

function previewPayload(id, converted) {
  return {
    id,
    from: converted.from,
    to: converted.to,
    cc: converted.cc,
    bcc: converted.bcc,
    subject: converted.subject,
    date: converted.date,
    labels: converted.labels,
    messageId: converted.messageId,
    markdown: converted.markdown,
    html: converted.previewHtml,
    attachments: converted.attachments.map((item) => ({
      filename: item.filename,
      contentType: item.contentType,
      size: item.size,
      content: bytesCopy(item.content),
    })),
  };
}

function bytesCopy(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}

function summarize(message) {
  return {
    id: message.id,
    from: message.from,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    date: message.date,
    labels: message.labels,
    hasAttachments: message.hasAttachments,
    error: message.error,
  };
}
