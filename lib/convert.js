import { htmlToText } from 'html-to-text';
import { simpleParser } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import { reserveAttachmentName, reserveEmailPath, slugify } from './filenames.js';

const sanitizeOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'span', 'h1', 'h2', 'font', 'center']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'target'],
    img: ['src', 'alt', 'width', 'height', 'title'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'data'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
  },
};

const EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/html': '.html',
};

export async function convertMessage(raw, { used = new Set() } = {}) {
  const mail = await simpleParser(raw, { keepCidLinks: true });
  const date = messageDate(mail);
  const subject = textOf(mail.subject) || '(no subject)';
  const paths = reserveEmailPath(date, subject, used);
  const named = nameAttachments(mail.attachments || [], paths.attachmentDir, used);
  const html = typeof mail.html === 'string' ? mail.html : '';
  const previewHtml = buildPreviewHtml(html, mail.text || '', named);
  const body = markdownBody(html, mail.text || '');
  const when = date ? dateParts(date) : null;
  const markdown = renderMarkdown({
    from: addressText(mail.from),
    to: addressText(mail.to),
    cc: addressText(mail.cc),
    bcc: addressText(mail.bcc),
    date: when?.date || '',
    time: when?.time || '',
    subject,
    labels: splitLabels(headerValue(mail, 'x-gmail-labels')),
    messageId: textOf(mail.messageId),
    body,
    attachments: named,
  });

  return {
    markdown,
    markdownPath: paths.markdownPath,
    attachments: named.map((item) => ({
      filename: item.filename,
      content: item.content,
      contentType: item.contentType,
      size: item.content.length,
      zipPath: `${paths.attachmentDir}/${item.filename}`,
    })),
    previewHtml,
    from: addressText(mail.from),
    to: addressText(mail.to),
    cc: addressText(mail.cc),
    bcc: addressText(mail.bcc),
    subject,
    date: date ? date.toISOString() : null,
    labels: splitLabels(headerValue(mail, 'x-gmail-labels')),
    messageId: textOf(mail.messageId),
  };
}

function nameAttachments(attachments, attachmentDir, used) {
  return attachments.map((attachment, index) => {
    const filename = reserveAttachmentName(attachmentDir, fallbackName(attachment, index), used);
    const content = asBuffer(attachment.content);
    return {
      filename,
      content,
      contentType: attachment.contentType || 'application/octet-stream',
      cidKey: normalizeCid(attachment.cid || attachment.contentId),
    };
  });
}

function fallbackName(attachment, index) {
  if (attachment.filename) return attachment.filename;
  const extension = extensionFor(attachment.contentType);
  if (attachment.cid) return `${slugify(attachment.cid) || 'inline'}${extension}`;
  return `attachment-${index + 1}${extension}`;
}

function extensionFor(contentType) {
  const base = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (EXTENSIONS[base]) return EXTENSIONS[base];
  const subtype = base.split('/')[1] || '';
  if (/^[a-z0-9.+-]{1,10}$/.test(subtype) && subtype !== 'octet-stream') return `.${subtype}`;
  return '';
}

function markdownBody(html, text) {
  if (html.trim()) return plainFromHtml(html);
  return String(text || '').trim();
}

function plainFromHtml(html) {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'table', format: 'block' },
      { selector: 'thead', format: 'block' },
      { selector: 'tbody', format: 'block' },
      { selector: 'tfoot', format: 'block' },
      { selector: 'tr', format: 'block' },
      { selector: 'td', format: 'block' },
      { selector: 'th', format: 'block' },
      { selector: 'img', format: 'skip' },
    ],
  }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildPreviewHtml(html, text, named) {
  if (html.trim()) {
    const withImages = html.replace(/\bcid:([^'"\s]+)/gi, (match, raw) => {
      const attachment = named.find((item) => item.cidKey && item.cidKey === normalizeCid(raw));
      if (!attachment) return match;
      const type = attachment.contentType.split(';')[0];
      return `data:${type};base64,${attachment.content.toString('base64')}`;
    });
    return sanitizeHtml(withImages, sanitizeOptions);
  }
  const plain = String(text || '').trim();
  if (!plain) return '';
  return sanitizeHtml(`<pre>${escapeHtml(plain)}</pre>`, sanitizeOptions);
}

function renderMarkdown({ from, to, cc, bcc, date, time, subject, labels, messageId, body, attachments }) {
  const lines = ['---', 'type: email'];
  pushField(lines, 'subject', subject);
  pushField(lines, 'from', from);
  pushField(lines, 'to', to);
  pushField(lines, 'cc', cc);
  pushField(lines, 'bcc', bcc);
  pushField(lines, 'date', date);
  pushField(lines, 'time', time);
  if (labels.length) {
    lines.push('labels:');
    for (const label of labels) lines.push(`  - ${yamlQuote(label)}`);
  }
  pushField(lines, 'message_id', messageId);
  lines.push('---', '');

  let markdown = lines.join('\n');
  if (body) markdown += `${body}\n`;
  if (attachments.length) {
    const links = attachments.map((item) => `- [${item.filename}](attachments/${item.filename})`).join('\n');
    markdown += `\n## Attachments\n\n${links}\n`;
  }
  return markdown.endsWith('\n') ? markdown : `${markdown}\n`;
}

function pushField(lines, key, value) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  lines.push(`${key}: ${yamlQuote(clean)}`);
}

function yamlQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function messageDate(mail) {
  const value = mail.date;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function dateParts(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function addressText(value) {
  if (!value) return '';
  const text = typeof value === 'string' ? value : (value.text || '');
  return text.replace(/"([^"]+)"\s*(?=<)/g, '$1 ').replace(/\s+/g, ' ').trim();
}

function headerValue(mail, name) {
  const value = mail.headers?.get(name);
  return textOf(value);
}

function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(', ');
  if (typeof value.text === 'string') return value.text;
  return String(value);
}

function splitLabels(value) {
  if (!value) return [];
  return value.split(',').map((label) => label.trim()).filter(Boolean);
}

function normalizeCid(value) {
  if (!value) return '';
  let cid = String(value).trim();
  if (cid.startsWith('<') && cid.endsWith('>')) cid = cid.slice(1, -1);
  try {
    cid = decodeURIComponent(cid);
  } catch {
    // Keep the raw content id when it is not URL-encoded.
  }
  return cid.toLowerCase();
}

function asBuffer(content) {
  if (Buffer.isBuffer(content)) return content;
  if (typeof content === 'string') return Buffer.from(content);
  return Buffer.alloc(0);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}
