import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexMbox } from '../lib/mbox.js';
import { openFileSource } from '../lib/node-source.js';
import { site } from '../site.config.mjs';

const origin = site.origin;
const guideCss = readFileSync(new URL('../public/guide.css', import.meta.url), 'utf8');
const siteCss = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

const pages = [
  ['home', '../index.html', origin],
  ['guides', '../public/guides/index.html', `${origin}guides/`],
  ['media-kit', '../public/media-kit/index.html', `${origin}media-kit/`],
  ['how-it-works', '../public/guides/how-it-works/index.html', `${origin}guides/how-it-works/`],
  ['export-gmail-mbox', '../public/guides/export-gmail-mbox/index.html', `${origin}guides/export-gmail-mbox/`],
  ['what-is-mbox', '../public/guides/what-is-mbox/index.html', `${origin}guides/what-is-mbox/`],
  ['markdown-output', '../public/guides/markdown-output/index.html', `${origin}guides/markdown-output/`],
].map(([id, file, canonical]) => ({
  id,
  canonical,
  html: readFileSync(new URL(file, import.meta.url), 'utf8'),
}));

function page(id) {
  return pages.find((entry) => entry.id === id);
}

function jsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1);
  return JSON.parse(blocks[0][1]);
}

function file(name) {
  return readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
}

test('every crawlable page has one h1 and a complete head', () => {
  for (const entry of pages) {
    const { id, html, canonical } = entry;
    assert.equal([...html.matchAll(/<h1[\s>]/g)].length, 1, id);
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}">`), id);
    assert.match(html, /<meta name="description" content="[^"]+"/, id);
    assert.match(html, /<meta name="robots" content="index, follow">/, id);
    assert.match(html, /<meta property="og:title" content="[^"]+"/, id);
    assert.match(html, /<meta property="og:description" content="[^"]+"/, id);
    assert.match(html, /<meta property="og:type" content="(?:website|article)">/, id);
    assert.match(html, new RegExp(`<meta property="og:url" content="${canonical}">`), id);
    assert.match(html, /<meta property="og:site_name" content="Mbox to markdown">/, id);
    assert.match(html, /<meta property="og:locale" content="en_US">/, id);
    assert.match(html, new RegExp(`<meta property="og:image" content="${origin}ogimage.png">`), id);
    assert.match(html, /<meta property="og:image:alt" content="[^"]+"/, id);
    assert.match(html, /<meta property="og:image:width" content="1200">/, id);
    assert.match(html, /<meta property="og:image:height" content="630">/, id);
    assert.match(html, new RegExp(`<link rel="icon" href="${origin}favicon-32x32.png" type="image/png" sizes="32x32">`), id);
    assert.match(html, new RegExp(`<link rel="icon" href="${origin}favicon-16x16.png" type="image/png" sizes="16x16">`), id);
    assert.match(html, new RegExp(`<link rel="icon" href="${origin}favicon.ico" sizes="48x48">`), id);
    assert.match(html, new RegExp(`<link rel="apple-touch-icon" href="${origin}apple-touch-icon.png">`), id);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, id);
    assert.match(html, /<meta name="theme-color" media="\(prefers-color-scheme: light\)"/, id);
    assert.match(html, /<meta name="theme-color" media="\(prefers-color-scheme: dark\)"/, id);
    assert.doesNotMatch(html, /rel="alternate" type="text\/markdown"/, id);
    assert.match(html, new RegExp(`<link rel="describedby" href="${origin}llms.txt">`), id);
    assert.equal(jsonLd(html)['@context'], 'https://schema.org', id);
  }
});

test('home, guides, and articles use the right structured data', () => {
  const homeHtml = page('home').html;
  const home = jsonLd(homeHtml);
  assert.equal(home['@type'], 'WebApplication');
  assert.equal(home.name, site.name);
  assert.equal(home.url, origin);
  assert.equal(home.isAccessibleForFree, true);
  assert.equal(home.offers.price, '0');
  assert.equal(home.author.name, 'Razvan Muntian');
  assert.equal(home.author.url, 'https://razvan.page');
  assert.equal(home.license, 'https://opensource.org/licenses/MIT');
  assert.equal(home.codeRepository, 'https://github.com/razvanmtn/mbox-to-markdown');
  assert.match(homeHtml, /<title>Mbox to markdown — mailbox exports as notes<\/title>/);
  assert.match(homeHtml, /<img class="logo" src="logo.svg" alt="" width="36" height="36">/);
  assert.match(homeHtml, /href="guides\/">Guides<\/a>/);
  assert.match(homeHtml, /<noscript>/);
  assert.match(homeHtml, /class="site-footer"/);
  assert.match(homeHtml, /<h2>Links<\/h2>/);
  assert.match(homeHtml, /href="guides\/how-it-works\/">How this app works<\/a>/);
  assert.match(homeHtml, /href="guides\/export-gmail-mbox\/">Export mbox from Gmail<\/a>/);
  assert.match(homeHtml, /href="guides\/what-is-mbox\/">What mbox is<\/a>/);
  assert.match(homeHtml, /href="guides\/markdown-output\/">Markdown output<\/a>/);
  assert.match(homeHtml, /href="https:\/\/lostcause\.dev\?ref=mboxtomarkdown"/);
  assert.match(homeHtml, /<img src="lostcause-logo\.webp" alt="" width="20" height="20">/);
  assert.match(homeHtml, /href="\.\/" aria-current="page">Home<\/a>/);
  assert.match(homeHtml, /href="https:\/\/github\.com\/razvanmtn\/mbox-to-markdown"/);
  assert.match(homeHtml, /<span>GitHub<\/span>/);
  assert.match(homeHtml, /&copy; 2026 MBOX to Markdown/);
  assert.match(homeHtml, /Made with ❤️ by <a href="https:\/\/razvan\.page\?ref=mboxtomarkdown"/);
  assert.match(siteCss, /\.footer-column h2 \{[^}]*font-weight: 600;/);

  const index = page('guides');
  const indexTypes = jsonLd(index.html)['@graph'].map((node) => node['@type']);
  assert.deepEqual(indexTypes, ['CollectionPage', 'BreadcrumbList']);
  assert.equal(jsonLd(index.html)['@graph'][0].mainEntity.itemListElement.length, 4);
  assert.match(index.html, /href="\.\.\/styles\.css"/);

  const article = page('how-it-works');
  const articleLd = jsonLd(article.html);
  assert.deepEqual(articleLd['@graph'].map((node) => node['@type']), ['TechArticle', 'BreadcrumbList']);
  assert.equal(articleLd['@graph'][0].headline, 'How this app works');
  assert.equal(articleLd['@graph'][0].datePublished, '2026-11-09');
  assert.equal(articleLd['@graph'][0].dateModified, '2026-11-09');
  assert.equal(articleLd['@graph'][1].itemListElement.length, 3);
  assert.match(article.html, /property="og:type" content="article"/);
  assert.match(article.html, /article:published_time" content="2026-11-09"/);
  assert.match(article.html, /article:modified_time" content="2026-11-09"/);
  assert.match(article.html, /href="\.\.\/\.\.\/styles\.css"/);
  assert.match(article.html, /src="\.\.\/\.\.\/logo\.svg"/);
  assert.match(article.html, /width="36" height="36"/);
  assert.match(article.html, /<nav class="crumbs" aria-label="Breadcrumb"><span aria-hidden="true">\/<\/span><a href="\.\.\/">Guides<\/a><\/nav>/);
  assert.equal([...article.html.matchAll(/<h1[\s>]/g)].length, 1);
  assert.match(article.html, /href="\.\.\/\.\.\/media-kit\/">Media kit<\/a>/);
  assert.match(article.html, /href="\.\.\/\.\.\/guides\/" aria-current="page">Guides<\/a>/);
  assert.match(article.html, /class="shot-open"/);
  assert.match(article.html, /class="shot-lightbox"/);
  assert.match(article.html, /src="\.\.\/\.\.\/guide\.js"/);
  assert.match(guideCss, /border-radius:\s*0/);
  assert.match(guideCss, /cursor:\s*zoom-in/);
  assert.match(article.html, /href="\.\.\/how-it-works\/" aria-current="page">How this app works<\/a>/);
  assert.match(article.html, /href="\.\.\/export-gmail-mbox\/"/);
  assert.doesNotMatch(article.html, /href="\/guides\//);
  assert.match(homeHtml, /href="media-kit\/">Media kit<\/a>/);
  assert.match(guideCss, /min-height:\s*100dvh/);
  assert.match(guideCss, /justify-content:\s*flex-start/);
});

test('the media kit gives posting copy, type, and downloads', () => {
  const kit = page('media-kit');
  const kitLd = jsonLd(kit.html);
  assert.equal([...kit.html.matchAll(/<h1[\s>]/g)].length, 1);
  assert.ok(kit.html.includes(site.description));
  assert.match(kit.html, /Iowan Old Style/);
  assert.match(kit.html, /Avenir Next/);
  assert.match(kit.html, /Segoe UI/);
  assert.match(kit.html, /#e9e2d6/);
  assert.match(kit.html, /#1b1815/);
  assert.match(kit.html, /href="\.\.\/logo\.svg" download/);
  assert.match(kit.html, /href="\.\.\/ogimage\.png" download/);
  assert.doesNotMatch(kit.html, /<nav class="crumbs"/);
  assert.deepEqual(kitLd['@graph'].map((node) => node['@type']), ['WebPage', 'BreadcrumbList']);
  assert.equal(kitLd['@graph'][1].itemListElement[1].name, 'Media kit');
  assert.equal(kitLd['@graph'][1].itemListElement[1].item, `${origin}media-kit/`);
});

test('llms.txt points at the html pages', () => {
  const text = file('llms.txt');
  assert.match(text, /^# Mbox to markdown\n\n> Turn an mbox export into Markdown in the browser\./);
  const beforeLists = text.split(/^## /m)[0];
  assert.match(beforeLists, /not uploaded/);
  assert.match(beforeLists, /1 GB/);
  assert.doesNotMatch(beforeLists, /^#{2,}/m);
  assert.deepEqual([...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]), ['Guides', 'Optional']);
  const items = [...text.matchAll(/^- \[([^\]]+)\]\(([^)]+)\): (.+)$/gm)];
  assert.equal(items.length, 9);
  for (const item of items) assert.match(item[2], /^https:\/\//);
  const guides = text.slice(text.indexOf('## Guides'), text.indexOf('## Optional'));
  assert.match(guides, new RegExp(`${origin}guides/\\)`));
  for (const slug of ['how-it-works', 'export-gmail-mbox', 'what-is-mbox', 'markdown-output']) {
    assert.match(guides, new RegExp(`${origin}guides/${slug}/\\)`));
  }
  const optional = text.slice(text.indexOf('## Optional'));
  assert.match(optional, new RegExp(`${origin}media-kit/\\)`));
  assert.doesNotMatch(text, /index\.md/);
  assert.doesNotMatch(guides, /media-kit/);
  assert.match(optional, /https:\/\/github.com\/razvanmtn\/mbox-to-markdown/);
  assert.match(optional, /https:\/\/razvan.page/);
  assert.match(optional, /https:\/\/lostcause.dev/);
  assert.doesNotMatch(optional, /\n## /);
});

test('sitemap and robots cover the html pages only', () => {
  const xml = file('sitemap.xml');
  assert.equal([...xml.matchAll(/<loc>/g)].length, pages.length);
  for (const entry of pages) {
    assert.ok(xml.includes(`<loc>${entry.canonical}</loc>`), entry.canonical);
    assert.match(xml, new RegExp(`<loc>${entry.canonical}</loc>\\n\\s*<lastmod>2026-11-09</lastmod>`));
  }
  assert.doesNotMatch(xml, /\.md</);
  assert.match(file('robots.txt'), new RegExp(`User-agent: \\*\\nAllow: /\\n\\nSitemap: ${origin}sitemap\\.xml\\n`));
});

test('the sample mailbox is linked and has three messages', async () => {
  const sample = fileURLToPath(new URL('../public/sample.mbox', import.meta.url));
  const messages = await indexMbox(await openFileSource(sample));
  assert.equal(messages.length, 3);
  assert.equal(messages.every((message) => !message.error), true);
  assert.equal(messages[0].hasAttachments, true);
  assert.equal(messages[0].subject, 'Notes from the archive');
  assert.deepEqual(messages.map((message) => message.subject), [
    'Notes from the archive',
    'Re: Notes from the archive',
    'A short follow-up',
  ]);

  assert.match(page('home').html, /href="sample\.mbox" download>Download a sample mbox file</);
  assert.match(page('how-it-works').html, /href="\.\.\/\.\.\/sample\.mbox"/);
  assert.match(page('guides').html, /href="\.\.\/sample\.mbox"/);
});

test('markdown output treats Obsidian as one example', () => {
  const output = page('markdown-output').html;
  assert.match(output, /<h1>Markdown output<\/h1>/);
  assert.doesNotMatch(output, /Markdown output in Obsidian/);
  assert.match(output, /many editors and note apps can open/);
  assert.match(output, /One example is Obsidian/);
  assert.match(page('guides').html, /how to open the Markdown\./);
  assert.doesNotMatch(page('guides').html, /in Obsidian/);
});

test('diagrams render and placed screenshots replace the labeled gaps', () => {
  const how = page('how-it-works').html;
  const gmail = page('export-gmail-mbox').html;
  const output = page('markdown-output').html;
  const html = pages.map((entry) => entry.html).join('\n');
  assert.match(how, /src="\.\.\/\.\.\/images\/how-it-works-flow\.svg"/);
  for (const image of ['app-idle.png', 'app-mailbox.png', 'app-filters.png']) {
    assert.match(how, new RegExp(`src="\\.\\./\\.\\./images/${image.replaceAll('.', '\\.')}"`));
  }
  assert.match(gmail, /src="\.\.\/\.\.\/images\/gmail-takeout-mail\.png"/);
  assert.match(output, /src="\.\.\/\.\.\/images\/obsidian-note\.png"/);
  assert.match(gmail, /href="\.\.\/what-is-mbox\/"/);
  assert.doesNotMatch(html, /Screenshot needed/);
  assert.doesNotMatch(html, /public\/images\//);
  assert.doesNotMatch(html, /gmail-takeout-options\.png/);
  assert.doesNotMatch(html, /gmail-mbox-file\.png/);
});

test('manifest names the app and keeps a relative start url', () => {
  const manifest = JSON.parse(file('site.webmanifest'));
  assert.equal(manifest.name, 'Mbox to markdown');
  assert.equal(manifest.short_name, 'Mbox');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#e9e2d6');
  assert.equal(manifest.theme_color, '#e9e2d6');
  assert.equal(manifest.icons[0].src, 'android-chrome-192x192.png');
  assert.equal(manifest.icons[0].sizes, '192x192');
  assert.equal(manifest.icons[0].purpose, 'any');
  assert.equal(manifest.icons[1].src, 'android-chrome-512x512.png');
  assert.equal(manifest.icons[1].sizes, '512x512');
});
