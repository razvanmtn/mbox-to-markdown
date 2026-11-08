const SLUG_LENGTH = 60;
const FILENAME_LENGTH = 120;
const EMOJI = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D/gu;
const INVISIBLE = /[\u0000-\u001f\u007f\u200B-\u200D\uFEFF\uFE0E\uFE0F]/g;
const OBSIDIAN_UNSAFE = /[#^[\]|\\/:*?"<>]/g;

export function slugify(value) {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug || 'no-subject';
}

export function sanitizeFilename(name) {
  const original = basename(String(name || 'attachment'));
  const extensionMatch = original.match(/(\.[a-zA-Z0-9]{1,10})$/);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
  const stemSource = extension ? original.slice(0, -extension.length) : original;
  const stem = cleanText(stemSource)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, Math.max(1, FILENAME_LENGTH - extension.length))
    .replace(/-+$/g, '');
  return `${stem || 'attachment'}${extension}`;
}

function basename(name) {
  const value = String(name || '');
  const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return slash === -1 ? value : value.slice(slash + 1);
}

function extname(filename) {
  const base = basename(filename);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot);
}

function cleanText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(EMOJI, '')
    .replace(INVISIBLE, '')
    .replace(OBSIDIAN_UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function reserveEmailPath(date, subject, used) {
  let folder;
  let stem;
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    folder = `${year}/${month}`;
    stem = `${year}-${month}-${day}-${slugify(subject)}`;
  } else {
    folder = 'undated';
    stem = `undated-${slugify(subject)}`;
  }

  let name = stem;
  let suffix = 2;
  while (used.has(`${folder}/${name}.md`)) {
    name = `${stem}-${suffix}`;
    suffix += 1;
  }
  const markdownPath = `${folder}/${name}.md`;
  used.add(markdownPath);
  return {
    markdownPath,
    attachmentDir: `${folder}/attachments`,
  };
}

export function reserveAttachmentName(attachmentDir, filename, used) {
  const safe = sanitizeFilename(filename);
  const ext = extname(safe);
  const stem = ext ? safe.slice(0, -ext.length) : safe;
  let candidate = safe;
  let suffix = 2;
  while (used.has(`${attachmentDir}/${candidate}`)) {
    candidate = `${stem}-${suffix}${ext}`;
    suffix += 1;
  }
  used.add(`${attachmentDir}/${candidate}`);
  return candidate;
}
