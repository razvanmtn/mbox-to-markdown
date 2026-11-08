import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { convertMessage } from './lib/convert.js';
import { sanitizeFilename } from './lib/filenames.js';
import { writeZip } from './lib/export.js';
import { indexMbox, readMessage } from './lib/mbox.js';

const ONE_GB = 1024 * 1024 * 1024;
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));

export async function createApp({ tempRoot } = {}) {
  const root = tempRoot || path.join(os.tmpdir(), 'mbox-to-markdown');
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false, limit: '10mb' }));

  let session = null;

  app.get('/api/status', (_req, res) => {
    res.json(sessionStatus(session));
  });

  app.get('/api/messages', (_req, res) => {
    if (!session || session.status !== 'ready') {
      return res.status(409).json({ error: 'No mailbox is ready' });
    }
    res.json({ messages: session.messages.map(summarize) });
  });

  app.get('/api/messages/:id/attachments/:index', async (req, res) => {
    if (!session || session.status !== 'ready') {
      return res.status(409).json({ error: 'No mailbox is ready' });
    }
    const id = Number(req.params.id);
    const index = Number(req.params.index);
    const message = session.messages.find((item) => item.id === id);
    if (!message) return res.status(404).json({ error: 'Email not found' });
    if (!Number.isInteger(index) || index < 0) return res.status(404).json({ error: 'Attachment not found' });
    if (message.error) return res.status(422).json({ error: message.error });

    try {
      const raw = await readMessage(session.filePath, message.start, message.end);
      const converted = await convertMessage(raw);
      const attachment = converted.attachments[index];
      if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
      const filename = sanitizeFilename(attachment.filename);
      res.setHeader('Content-Type', attachment.contentType.split(';')[0] || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename.replaceAll('"', '')}"`);
      res.send(attachment.content);
    } catch (error) {
      res.status(422).json({ error: error.message });
    }
  });

  app.get('/api/messages/:id', async (req, res) => {
    if (!session || session.status !== 'ready') {
      return res.status(409).json({ error: 'No mailbox is ready' });
    }
    const id = Number(req.params.id);
    const message = session.messages.find((item) => item.id === id);
    if (!message) return res.status(404).json({ error: 'Email not found' });
    if (message.error) return res.status(422).json({ error: message.error, message: summarize(message) });

    try {
      const raw = await readMessage(session.filePath, message.start, message.end);
      const converted = await convertMessage(raw);
      res.json({
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
        })),
      });
    } catch (error) {
      res.status(422).json({ error: error.message });
    }
  });

  app.delete('/api/session', async (_req, res) => {
    if (session) {
      session.replaced = true;
      await fs.rm(session.dir, { recursive: true, force: true });
      session = null;
    }
    res.json({ ok: true });
  });

  app.post('/api/upload', (req, res) => {
    const dir = path.join(root, randomUUID());
    const upload = multer({
      storage: multer.diskStorage({
        destination: dir,
        filename: (_req, _file, callback) => callback(null, 'mailbox.mbox'),
      }),
      limits: { fileSize: ONE_GB, files: 1 },
    }).single('file');

    upload(req, res, async (error) => {
      if (error || !req.file) {
        await fs.rm(dir, { recursive: true, force: true });
        const tooLarge = error?.code === 'LIMIT_FILE_SIZE';
        const message = tooLarge ? 'File exceeds the 1 GB limit' : (error?.message || 'Choose an mbox file');
        return res.status(tooLarge ? 413 : 400).json({ error: message });
      }

      if (session) {
        session.replaced = true;
        await fs.rm(session.dir, { recursive: true, force: true });
      }

      const next = {
        id: path.basename(dir),
        dir,
        filePath: req.file.path,
        status: 'scanning',
        bytesRead: 0,
        size: req.file.size,
        found: 0,
        messages: [],
        error: null,
        replaced: false,
      };
      session = next;
      res.json({ ok: true });

      indexMbox(next.filePath, {
        onProgress(progress) {
          if (next.replaced) return;
          next.bytesRead = progress.bytesRead;
          next.size = progress.size;
          next.found = progress.count;
        },
      }).then((messages) => {
        if (next.replaced) return;
        next.messages = messages;
        next.found = messages.length;
        next.bytesRead = next.size;
        next.status = 'ready';
      }).catch((scanError) => {
        if (next.replaced) return;
        next.status = 'error';
        next.error = scanError.message;
      });
    });
  });

  app.post('/api/export', async (req, res) => {
    if (!session || session.status !== 'ready') {
      return res.status(409).json({ error: 'No mailbox is ready' });
    }
    const known = new Set(session.messages.map((message) => message.id));
    const ids = parseIds(req.body).filter((id) => known.has(id));
    if (!ids.length) return res.status(400).json({ error: 'Select at least one email' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="emails.zip"');
    try {
      await writeZip({
        filePath: session.filePath,
        messages: session.messages,
        ids,
        output: res,
      });
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ error: error.message });
      else res.destroy(error);
    }
  });

  app.use(express.static(publicDir));
  return app;
}

function sessionStatus(session) {
  if (!session) return { status: 'empty' };
  return {
    status: session.status,
    bytesRead: session.bytesRead,
    size: session.size,
    messageCount: session.status === 'ready' ? session.messages.length : session.found,
    error: session.error,
  };
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

function parseIds(body) {
  const raw = body?.ids;
  const values = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
  const ids = [];
  for (const value of values) {
    if (value === '' || value === null || value === undefined) continue;
    const id = Number(value);
    if (Number.isInteger(id) && id >= 0) ids.push(id);
  }
  return [...new Set(ids)];
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const app = await createApp();
  app.listen(3000, '127.0.0.1', () => {
    console.log('Mbox to markdown is running at http://127.0.0.1:3000');
  });
}
