const fileInput = document.querySelector('#file');
const clearButton = document.querySelector('#clear');
const progress = document.querySelector('#progress');
const progressBar = document.querySelector('#progress-bar');
const statusLine = document.querySelector('#status');
const idle = document.querySelector('#idle');
const workspace = document.querySelector('#workspace');
const searchInput = document.querySelector('#search');
const rulesElement = document.querySelector('#rules');
const hideMatchesButton = document.querySelector('#hide-matches');
const hideSelectedButton = document.querySelector('#hide-selected');
const restoreHiddenButton = document.querySelector('#restore-hidden');
const list = document.querySelector('#list');
const spacer = document.querySelector('#spacer');
const rows = document.querySelector('#rows');
const counts = document.querySelector('#counts');
const downloadButton = document.querySelector('#download');
const reader = document.querySelector('#reader');
const renderedTab = document.querySelector('#tab-rendered');
const markdownTab = document.querySelector('#tab-markdown');
const copyButton = document.querySelector('#copy-markdown');
const attachmentDownload = document.querySelector('#attachment-download');
const downloadAttachmentButton = document.querySelector('#download-attachment');
const attachmentMenu = document.querySelector('#attachment-menu');

const ROW_HEIGHT = 72;
let messages = [];
let selected = new Set();
let hidden = new Set();
let rules = [];
let ruleSerial = 1;
let selectionAnchor = null;
let query = '';
let currentId = null;
let mode = 'rendered';
const cache = new Map();
const ONE_GB = 1024 * 1024 * 1024;
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let requestSerial = 0;
const reads = new Map();
const exportsWaiting = new Map();
let frame = 0;
let renderedKey = '';
let copyTimer = 0;
let suppressCheckboxChange = false;

fileInput.addEventListener('change', () => {
  const chosen = fileInput.files?.[0];
  fileInput.value = '';
  if (chosen) upload(chosen);
});

clearButton.addEventListener('click', clearMailbox);
searchInput.addEventListener('input', () => {
  query = fold(searchInput.value.trim());
  list.scrollTop = 0;
  renderList();
});
document.querySelector('#add-rule').addEventListener('click', () => {
  rules.push({ id: ruleSerial, field: 'from', operator: 'contains', value: '' });
  ruleSerial += 1;
  renderRules();
  renderList();
});
hideMatchesButton.addEventListener('click', () => {
  hideIds(filtered().map((message) => message.id));
  rules = [];
  query = '';
  searchInput.value = '';
  renderRules();
  list.scrollTop = 0;
  renderList();
});
hideSelectedButton.addEventListener('click', () => {
  hideIds([...selected]);
  renderList();
});
restoreHiddenButton.addEventListener('click', () => {
  hidden.clear();
  renderList();
});
document.querySelector('#select-all').addEventListener('click', () => {
  selected = new Set(selectable(messages).map((message) => message.id));
  renderList();
});
document.querySelector('#select-matching').addEventListener('click', () => {
  selected = new Set(selectable(filtered()).map((message) => message.id));
  renderList();
});
document.querySelector('#select-none').addEventListener('click', () => {
  selected = new Set();
  renderList();
});
downloadButton.addEventListener('click', downloadSelected);
copyButton.addEventListener('click', copyMarkdown);
downloadAttachmentButton.addEventListener('click', () => {
  const payload = currentPayload();
  if (!payload?.attachments?.length) return;
  if (payload.attachments.length > 1) {
    attachmentMenu.hidden = !attachmentMenu.hidden;
    return;
  }
  saveAttachment(payload.id, 0, payload.attachments[0].filename);
});
attachmentMenu.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  const payload = currentPayload();
  if (!button || !payload) return;
  const index = Number(button.dataset.index);
  saveAttachment(payload.id, index, payload.attachments[index]?.filename);
  attachmentMenu.hidden = true;
});
document.addEventListener('click', (event) => {
  if (!attachmentDownload.contains(event.target)) attachmentMenu.hidden = true;
});
rulesElement.addEventListener('change', (event) => {
  const ruleElement = event.target.closest('.rule');
  if (!ruleElement) return;
  const rule = rules.find((item) => item.id === Number(ruleElement.dataset.id));
  if (!rule) return;
  if (event.target.dataset.part === 'field') {
    rule.field = event.target.value;
    rule.operator = defaultOperator(rule.field);
    rule.value = '';
    renderRules();
  } else if (event.target.dataset.part === 'operator') {
    rule.operator = event.target.value;
  } else if (event.target.dataset.part === 'value') {
    rule.value = event.target.value;
  }
  list.scrollTop = 0;
  renderList();
});
rulesElement.addEventListener('input', (event) => {
  if (event.target.dataset.part !== 'value') return;
  const ruleElement = event.target.closest('.rule');
  const rule = rules.find((item) => item.id === Number(ruleElement?.dataset.id));
  if (!rule) return;
  rule.value = event.target.value;
  list.scrollTop = 0;
  renderList();
});
rulesElement.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove]');
  if (!remove) return;
  rules = rules.filter((rule) => rule.id !== Number(remove.dataset.remove));
  renderRules();
  renderList();
});
renderedTab.addEventListener('click', () => setMode('rendered'));
markdownTab.addEventListener('click', () => setMode('markdown'));

list.addEventListener('scroll', scheduleRender);
window.addEventListener('resize', scheduleRender);
list.addEventListener('change', (event) => {
  if (suppressCheckboxChange) return;
  const input = event.target.closest('input[type="checkbox"]');
  if (!input || input.disabled) return;
  const id = Number(input.closest('.row')?.dataset.id);
  if (input.checked) selected.add(id);
  else selected.delete(id);
  selectionAnchor = id;
  updateCounts(filtered().length);
});
list.addEventListener('click', (event) => {
  const input = event.target.closest('input[type="checkbox"]');
  if (input) {
    if (input.disabled) return;
    const id = Number(input.closest('.row')?.dataset.id);
    if (event.shiftKey && selectionAnchor !== null) {
      event.preventDefault();
      suppressCheckboxChange = true;
      selectRange(selectionAnchor, id);
      selectionAnchor = id;
      renderedKey = '';
      renderList();
      queueMicrotask(() => {
        suppressCheckboxChange = false;
      });
    }
    return;
  }
  const row = event.target.closest('.row');
  if (!row) return;
  openMessage(Number(row.dataset.id));
});

worker.addEventListener('message', onWorkerMessage);
worker.addEventListener('error', () => {
  hideProgress();
  setStatus('Could not start the mailbox reader.', true);
});
setStatus('Open an mbox file. It is read on this computer.');

function onWorkerMessage(event) {
  const message = event.data;
  if (message.type === 'progress') {
    const ratio = message.size ? message.bytesRead / message.size : 0;
    showProgress(ratio, `Reading ${message.count || 0} emails`);
    return;
  }
  if (message.type === 'ready') {
    hideProgress();
    loadMessages(message.messages);
    return;
  }
  if (message.type === 'error') {
    hideProgress();
    setStatus(message.error || 'Could not read that file', true);
    return;
  }
  if (message.type === 'message') {
    const pending = reads.get(message.requestId);
    if (!pending) return;
    reads.delete(message.requestId);
    pending.resolve(message.payload);
    return;
  }
  if (message.type === 'message-error') {
    const pending = reads.get(message.requestId);
    if (!pending) return;
    reads.delete(message.requestId);
    pending.reject(new Error(message.error || 'Could not open this email'));
    return;
  }
  if (message.type === 'zip-chunk') {
    const pending = exportsWaiting.get(message.requestId);
    if (!pending) return;
    Promise.resolve(pending.onChunk?.(message.chunk)).then(() => {
      worker.postMessage({ type: 'zip-ack', requestId: message.requestId });
    }, (error) => {
      worker.postMessage({ type: 'zip-fail', requestId: message.requestId, error: error.message });
      exportsWaiting.delete(message.requestId);
      pending.reject(error);
    });
    return;
  }
  if (message.type === 'zip-done') {
    const pending = exportsWaiting.get(message.requestId);
    if (!pending) return;
    exportsWaiting.delete(message.requestId);
    pending.resolve(message.bytes);
    return;
  }
  if (message.type === 'zip-end') {
    const pending = exportsWaiting.get(message.requestId);
    if (!pending) return;
    exportsWaiting.delete(message.requestId);
    pending.resolve();
    return;
  }
  if (message.type === 'zip-error') {
    const pending = exportsWaiting.get(message.requestId);
    if (!pending) return;
    exportsWaiting.delete(message.requestId);
    pending.reject(new Error(message.error || 'Export failed'));
  }
}

function upload(file) {
  if (file.size > ONE_GB) {
    hideProgress();
    setStatus('File exceeds the 1 GB limit', true);
    return;
  }
  showProgress(0.02, `Reading ${file.name}`);
  worker.postMessage({ type: 'open', file });
}

function loadMessages(nextMessages) {
  messages = nextMessages;
  selected = new Set();
  hidden = new Set();
  rules = [];
  selectionAnchor = null;
  cache.clear();
  currentId = null;
  query = '';
  searchInput.value = '';
  renderRules();
  idle.hidden = true;
  workspace.hidden = false;
  clearButton.hidden = false;
  setStatus('');
  list.scrollTop = 0;
  renderList();
  requestAnimationFrame(renderList);
  setCopyEnabled(false);
  updateAttachmentControl(null);
  reader.replaceChildren(emptyRead('Select an email to read it.'));
}

function renderRules() {
  rulesElement.innerHTML = rules.map((rule) => {
    const valueControl = rule.field === 'attachments'
      ? ''
      : `<input data-part="value" type="${rule.field === 'date' ? 'date' : 'text'}" value="${escapeHtml(rule.value)}" placeholder="Value" aria-label="Filter value">`;
    return `<div class="rule" data-id="${rule.id}">
      <select data-part="field" aria-label="Filter field">${fieldOptions(rule.field)}</select>
      <select data-part="operator" aria-label="Filter operator">${operatorOptions(rule)}</select>
      ${valueControl}
      <button type="button" data-remove="${rule.id}">Remove</button>
    </div>`;
  }).join('');
}

function fieldOptions(selected) {
  return [
    ['from', 'From'],
    ['to', 'To'],
    ['cc', 'Cc'],
    ['subject', 'Subject'],
    ['label', 'Label'],
    ['date', 'Date'],
    ['attachments', 'Attachments'],
  ].map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
}

function operatorOptions(rule) {
  const options = rule.field === 'attachments'
    ? [['any', 'Has any'], ['none', 'Has none']]
    : rule.field === 'date'
      ? [['on', 'On'], ['before', 'Before'], ['after', 'After']]
      : [['contains', 'Contains'], ['not-contains', 'Does not contain']];
  return options.map(([value, label]) => `<option value="${value}"${value === rule.operator ? ' selected' : ''}>${label}</option>`).join('');
}

function defaultOperator(field) {
  if (field === 'attachments') return 'any';
  if (field === 'date') return 'on';
  return 'contains';
}

function ruleSignature() {
  return rules.map((rule) => `${rule.field}:${rule.operator}:${rule.value}`).join('|');
}

function updateAttachmentControl(payload) {
  const files = payload?.attachments || [];
  attachmentMenu.hidden = true;
  attachmentMenu.innerHTML = '';
  if (!files.length) {
    attachmentDownload.hidden = true;
    return;
  }
  attachmentDownload.hidden = false;
  downloadAttachmentButton.textContent = files.length > 1 ? 'Download attachment' : 'Download attachment';
  if (files.length > 1) {
    attachmentMenu.innerHTML = files.map((file, index) =>
      `<button type="button" data-index="${index}">${escapeHtml(file.filename)}</button>`).join('');
  }
}

function currentPayload() {
  return currentId === null ? null : cache.get(currentId);
}

function saveAttachment(id, index, filename) {
  const attachment = cache.get(id)?.attachments?.[index];
  if (!attachment?.content) return;
  const type = attachment.contentType?.split(';')[0] || 'application/octet-stream';
  saveBytes(attachment.content, filename || attachment.filename || 'attachment', type);
}

function saveBytes(bytes, filename, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dayKey(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function filtered() {
  return messages.filter((message) => !hidden.has(message.id) && matchesQuery(message) && matchesRules(message));
}

function selectable(list) {
  return list.filter((message) => !message.error && !hidden.has(message.id));
}

function matchesQuery(message) {
  if (!query) return true;
  const haystack = fold([message.from, message.subject, ...(message.labels || [])].join('\n'));
  return haystack.includes(query);
}

function matchesRules(message) {
  return rules.every((rule) => matchesRule(message, rule));
}

function matchesRule(message, rule) {
  if (rule.field === 'attachments') {
    return rule.operator === 'none' ? !message.hasAttachments : Boolean(message.hasAttachments);
  }
  if (rule.field === 'date') {
    if (!rule.value) return true;
    const day = dayKey(message.date);
    if (!day) return false;
    if (rule.operator === 'before') return day < rule.value;
    if (rule.operator === 'after') return day > rule.value;
    return day === rule.value;
  }
  const needle = fold(rule.value).trim();
  if (!needle) return true;
  const haystack = fold(rule.field === 'label' ? (message.labels || []).join('\n') : message[rule.field]);
  const found = haystack.includes(needle);
  return rule.operator === 'not-contains' ? !found : found;
}

function hasActiveFilter() {
  if (query) return true;
  return rules.some((rule) => rule.field === 'attachments' || String(rule.value || '').trim());
}

function hideIds(ids) {
  for (const id of ids) {
    hidden.add(id);
    selected.delete(id);
  }
  renderedKey = '';
}

function selectRange(fromId, toId) {
  const ids = selectable(filtered()).map((message) => message.id);
  const start = ids.indexOf(fromId);
  const end = ids.indexOf(toId);
  if (start === -1 || end === -1) {
    selected.add(toId);
    return;
  }
  const [low, high] = start < end ? [start, end] : [end, start];
  for (let index = low; index <= high; index += 1) selected.add(ids[index]);
}

function renderList() {
  const visible = filtered();
  const height = visible.length * ROW_HEIGHT;
  spacer.style.height = `${height}px`;
  if (!visible.length) {
    spacer.style.height = 'auto';
    rows.style.transform = 'none';
    if (renderedKey !== 'empty') {
      renderedKey = 'empty';
      rows.innerHTML = '<p class="empty-list">No emails to show.</p>';
    }
    updateCounts(0);
    return;
  }
  const start = Math.max(0, Math.floor(list.scrollTop / ROW_HEIGHT) - 8);
  const end = Math.min(visible.length, Math.ceil((list.scrollTop + list.clientHeight) / ROW_HEIGHT) + 8);
  const key = `${start}:${end}:${query}:${ruleSignature()}:${hidden.size}:${currentId}:${[...selected].join(',')}`;
  rows.style.transform = `translateY(${start * ROW_HEIGHT}px)`;
  if (key !== renderedKey) {
    renderedKey = key;
    rows.innerHTML = visible.slice(start, end).map(renderRow).join('');
  }
  updateCounts(visible.length);
}

function renderRow(message) {
  const open = message.id === currentId ? ' is-open' : '';
  const checked = selected.has(message.id) ? ' checked' : '';
  const disabled = message.error ? ' disabled' : '';
  const attachment = message.hasAttachments ? '<span class="clip">Attachment</span>' : '';
  return `<article class="row${open}" data-id="${message.id}" style="height:${ROW_HEIGHT}px">
    <input type="checkbox" aria-label="Select ${escapeHtml(message.subject)}"${checked}${disabled}>
    <button type="button" class="row-open">
      <span class="row-top"><span class="from">${escapeHtml(shortFrom(message.from))}</span><time class="when">${escapeHtml(formatWhen(message.date))}</time></span>
      <span class="row-subject"><span>${escapeHtml(message.error || message.subject || '(no subject)')}</span>${attachment}</span>
    </button>
  </article>`;
}

function updateCounts(shown) {
  const noun = messages.length === 1 ? 'email' : 'emails';
  const hiddenCount = hidden.size ? ` · ${hidden.size} hidden` : '';
  counts.textContent = `${shown} shown · ${messages.length} ${noun}${hiddenCount} · ${selected.size} selected`;
  downloadButton.disabled = selected.size === 0;
  hideMatchesButton.disabled = !hasActiveFilter() || shown === 0;
  hideSelectedButton.disabled = selected.size === 0;
  restoreHiddenButton.hidden = hidden.size === 0;
  restoreHiddenButton.textContent = `Restore hidden (${hidden.size})`;
}

async function openMessage(id) {
  currentId = id;
  renderList();
  const cached = cache.get(id);
  if (cached) {
    showPreview(cached);
    return;
  }
  setCopyEnabled(false);
  updateAttachmentControl(null);
  reader.replaceChildren(emptyRead('Opening…'));
  try {
    const payload = await requestMessage(id);
    cache.set(id, payload);
    if (currentId === id) showPreview(payload);
  } catch (error) {
    if (currentId === id) {
      setCopyEnabled(false);
      updateAttachmentControl(null);
      reader.replaceChildren(emptyRead(error.message || 'Could not open this email'));
    }
  }
}

function requestMessage(id) {
  const requestId = ++requestSerial;
  return new Promise((resolve, reject) => {
    reads.set(requestId, { resolve, reject });
    worker.postMessage({ type: 'read', requestId, id });
  });
}

function showPreview(payload) {
  setCopyEnabled(Boolean(payload.markdown));
  updateAttachmentControl(payload);
  reader.replaceChildren();
  if (mode === 'markdown') {
    const pre = document.createElement('pre');
    pre.className = 'markdown';
    pre.textContent = payload.markdown;
    reader.append(pre);
    return;
  }
  const frameElement = document.createElement('iframe');
  frameElement.className = 'mail-frame';
  frameElement.title = payload.subject || 'Email';
  frameElement.setAttribute('sandbox', '');
  const body = payload.html || '<p><em>This email has no body.</em></p>';
  frameElement.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:28px;font:17px/1.55 Georgia,serif;color:#231f1b;background:#fff;}
    img{max-width:100%;height:auto;} a{color:#1d5c45;} pre{white-space:pre-wrap;font:15px/1.5 ui-monospace,monospace;}
  </style></head><body>${body}</body></html>`;
  reader.append(frameElement);
}

function setMode(next) {
  mode = next;
  renderedTab.setAttribute('aria-selected', String(next === 'rendered'));
  markdownTab.setAttribute('aria-selected', String(next === 'markdown'));
  if (currentId !== null && cache.has(currentId)) showPreview(cache.get(currentId));
}

async function copyMarkdown() {
  const payload = currentId === null ? null : cache.get(currentId);
  if (!payload?.markdown) return;
  const copied = await writeClipboard(payload.markdown);
  copyButton.textContent = copied ? 'Copied' : 'Copy failed';
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copyButton.textContent = 'Copy markdown';
  }, 1500);
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      window.focus();
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through when the page is not allowed to write the clipboard.
    }
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    document.body.append(area);
    area.focus();
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (copied) return true;
  } catch {
    // The selection fallback can fail when the page is not focused.
  }
  return false;
}

function setCopyEnabled(enabled) {
  copyButton.disabled = !enabled;
  if (!enabled) {
    clearTimeout(copyTimer);
    copyButton.textContent = 'Copy markdown';
  }
}

async function downloadSelected() {
  const ids = [...selected].filter((id) => !hidden.has(id));
  if (!ids.length) return;
  downloadButton.disabled = true;
  let writable = null;
  try {
    writable = await chooseSaveTarget();
    if (writable) {
      await requestExport(ids, async (chunk) => {
        await writable.write(chunk);
      });
      await writable.close();
      writable = null;
      setStatus('');
      return;
    }
    const bytes = await requestExport(ids);
    saveBytes(bytes, 'emails.zip', 'application/zip');
    setStatus('');
  } catch (error) {
    if (writable) await writable.abort().catch(() => {});
    if (error?.name !== 'AbortError') setStatus(error.message || 'Export failed', true);
  } finally {
    downloadButton.disabled = selected.size === 0;
  }
}

async function chooseSaveTarget() {
  if (typeof window.showSaveFilePicker !== 'function') return null;
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'emails.zip',
      types: [{
        description: 'Zip archive',
        accept: { 'application/zip': ['.zip'] },
      }],
    });
    return await handle.createWritable();
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return null;
  }
}

function requestExport(ids, onChunk) {
  const requestId = ++requestSerial;
  return new Promise((resolve, reject) => {
    exportsWaiting.set(requestId, { resolve, reject, onChunk });
    worker.postMessage({ type: 'export', requestId, ids, stream: Boolean(onChunk) });
  });
}

function clearMailbox() {
  worker.postMessage({ type: 'close' });
  messages = [];
  selected = new Set();
  hidden = new Set();
  rules = [];
  selectionAnchor = null;
  cache.clear();
  currentId = null;
  setCopyEnabled(false);
  updateAttachmentControl(null);
  renderRules();
  hideProgress();
  showIdle();
}

function showIdle() {
  workspace.hidden = true;
  idle.hidden = false;
  clearButton.hidden = true;
  setStatus('Open an mbox file. It is read on this computer.');
}

function showProgress(ratio, label) {
  progress.hidden = false;
  progressBar.style.transform = `scaleX(${Math.max(0.02, Math.min(1, ratio || 0))})`;
  setStatus(label);
}

function hideProgress() {
  progress.hidden = true;
  progressBar.style.transform = 'scaleX(0)';
}

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle('is-error', isError);
}

function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!workspace.hidden) renderList();
  });
}

function fold(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function shortFrom(from) {
  if (!from) return 'Unknown sender';
  const name = from.replace(/<[^>]+>/g, '').replaceAll('"', '').trim();
  return name || from;
}

function formatWhen(iso) {
  if (!iso) return 'No date';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'No date';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function emptyRead(text) {
  const paragraph = document.createElement('p');
  paragraph.className = 'empty-read';
  paragraph.textContent = text;
  return paragraph;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}
