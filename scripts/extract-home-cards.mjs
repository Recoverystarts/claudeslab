// extract-home-cards.mjs — ONE-TIME migration tool for the claudeslab homepage.
// Parses the card grids in index.html into data/home-cards.json and (with --write-markers)
// wraps each grid in <!-- CARDS:<key>:START/END --> comment markers.
// After migration, cards are edited in data/home-cards.json and rendered by
// scripts/build-home-index.mjs. Kept in the repo so a future instance can re-sync
// the JSON from the HTML if the two ever drift.
//
// Usage: node scripts/extract-home-cards.mjs [--write-markers]
//
// Guarantees: for every section, re-rendering the extracted entries reproduces the
// original card region byte-for-byte, or this script throws and writes nothing.
// Cards that don't fit the canonical shape are stored with a `raw` field verbatim.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { renderCard } from './build-home-index.mjs';

const SRC = 'index.html';
const OUT = 'data/home-cards.json';
const WRITE_MARKERS = process.argv.includes('--write-markers');

// Section keys = the id="" of each <section class="thread"> whose card grid becomes
// data-driven. experiments and directory are deliberately excluded (bespoke cards).
const SECTION_KEYS = ['spaces', 'core-thesis', 'deconstraining', 'partnership', 'interaction', 'meta', 'cooperation'];

const html = readFileSync(SRC, 'utf8');

if (WRITE_MARKERS && html.includes('<!-- CARDS:')) {
  throw new Error('index.html already has CARDS markers — refusing to double-insert. Run without --write-markers to re-sync the JSON.');
}

// ---------- shared card-block detection ----------

function sectionSlice(html, key) {
  const open = `<section class="thread" id="${key}">`;
  const start = html.indexOf(open);
  if (start === -1) throw new Error(`section id="${key}" not found`);
  if (html.indexOf(open, start + 1) !== -1) throw new Error(`section id="${key}" appears twice`);
  const end = html.indexOf('</section>', start);
  if (end === -1) throw new Error(`section id="${key}" has no </section>`);
  return { start, end };
}

// A card opening is class="card" or class="card <more>" — never card-title/-meta/-desc.
const CARD_OPEN = /<(a|div)\b[^>]*class="card[" ][^>]*>/g;

function findCardBlocks(html, from, to) {
  const blocks = [];
  CARD_OPEN.lastIndex = from;
  let m;
  while ((m = CARD_OPEN.exec(html)) && m.index < to) {
    const lineStart = html.lastIndexOf('\n', m.index) + 1;
    // depth-scan to the matching close tag
    const scan = /<a\b|<\/a>|<div\b|<\/div>/g;
    scan.lastIndex = m.index;
    let depth = 0, closeEnd = -1, t;
    while ((t = scan.exec(html))) {
      depth += t[0].startsWith('</') ? -1 : 1;
      if (depth === 0) { closeEnd = html.indexOf('>', t.index) + 1; break; }
    }
    if (closeEnd === -1) throw new Error(`unclosed card at offset ${m.index}`);
    // extend to end of the closing line, excluding the EOL (\n or \r\n)
    let lineEnd = html.indexOf('\n', closeEnd);
    if (lineEnd === -1) lineEnd = html.length;
    let blockEnd = lineEnd;
    if (html[blockEnd - 1] === '\r') blockEnd -= 1;
    // the rest of the closing line must be whitespace-only, or the model is wrong
    if (html.slice(closeEnd, blockEnd).trim() !== '') throw new Error(`content after card close at offset ${closeEnd}`);
    blocks.push({ start: lineStart, end: blockEnd });
    CARD_OPEN.lastIndex = blockEnd;
  }
  return blocks;
}

// ---------- canonical card shape (renderer lives in build-home-index.mjs) ----------

function parseCanonical(block, indent) {
  const p = ' '.repeat(indent);
  const lines = block.split('\n');
  let i = 0;
  const e = {};
  let m = lines[i].match(new RegExp(`^${p}<a href="([^"]+)" class="(card[^"]*)">$`));
  if (m) { e.href = m[1]; e.cardClass = m[2]; }
  else {
    m = lines[i].match(new RegExp(`^${p}<div class="(card[^"]*)" style="cursor: default;">$`));
    if (!m) return null;
    e.cardClass = m[1];
  }
  i++;
  m = lines[i] && lines[i].match(new RegExp(`^${p}  <span class="space-icon">(.*)</span>$`));
  if (m) { e.icon = m[1]; i++; }
  m = lines[i] && lines[i].match(new RegExp(`^${p}  <div class="card-title">(.*)</div>$`));
  if (!m) return null;
  e.title = m[1]; i++;
  if (lines[i] === `${p}  <div class="card-meta">`) {
    i++; e.meta = [];
    while (lines[i] && (m = lines[i].match(new RegExp(`^${p}    <span>(.*)</span>$`)))) { e.meta.push(m[1]); i++; }
    if (lines[i] !== `${p}  </div>` || e.meta.length === 0) return null;
    i++;
  }
  m = lines[i] && lines[i].match(new RegExp(`^${p}  <div class="card-desc">(.*)</div>$`));
  if (!m) return null;
  e.desc = m[1]; i++;
  if (lines[i] === `${p}  <div style="margin-top: 10px;">`) {
    i++; e.tags = [];
    while (lines[i] && (m = lines[i].match(new RegExp(`^${p}    <span class="tag">(.*)</span>$`)))) { e.tags.push(m[1]); i++; }
    if (lines[i] !== `${p}  </div>` || e.tags.length === 0) return null;
    i++;
  }
  if (lines[i] !== (e.href != null ? `${p}</a>` : `${p}</div>`)) return null;
  if (i !== lines.length - 1) return null;
  // belt and braces: only accept the parse if it re-renders byte-identically
  return renderCard(e, indent) === block ? e : null;
}

// ---------- extraction ----------

const sections = {};
let markedHtml = html;
let totalCanonical = 0, totalRaw = 0;

const keyed = SECTION_KEYS.map(key => ({ key, ...sectionSlice(html, key) }))
  .sort((a, b) => a.start - b.start); // document order

for (const { key, start, end } of keyed) {
  const titleM = html.slice(start, end).match(/<div class="thread-title">(.*?)<\/div>/);
  const blocks = findCardBlocks(html, start, end);
  if (blocks.length === 0) throw new Error(`no cards found in section ${key}`);
  const indentM = html.slice(blocks[0].start).match(/^( *)</);
  const indent = indentM[1].length;
  const cards = [];
  for (let b = 0; b < blocks.length; b++) {
    const block = html.slice(blocks[b].start, blocks[b].end);
    const sep = b === 0 ? null : html.slice(blocks[b - 1].end, blocks[b].start);
    const canonical = parseCanonical(block, indent);
    const entry = canonical ?? { raw: block };
    if (canonical) totalCanonical++; else totalRaw++;
    if (sep !== null && sep !== '\n\n') entry.sep = sep;
    cards.push(entry);
  }
  // verify: re-render the whole region and compare to the original bytes
  const region = html.slice(blocks[0].start, blocks[blocks.length - 1].end);
  const rerender = cards.map((e, idx) => (idx === 0 ? '' : (e.sep ?? '\n\n')) + renderCard(e, indent)).join('');
  if (rerender !== region) {
    throw new Error(`round-trip failed for section ${key}: rendered ${rerender.length} bytes vs original ${region.length}`);
  }
  sections[key] = { title: titleM ? titleM[1] : key, indent, cards };
  console.log(`${key}: ${cards.length} cards (${cards.filter(c => c.raw == null).length} canonical, ${cards.filter(c => c.raw != null).length} raw), region ${region.length} bytes OK`);
}

// insert markers (reverse order so earlier offsets stay valid)
if (WRITE_MARKERS) {
  for (const { key, start, end } of [...keyed].reverse()) {
    const blocks = findCardBlocks(markedHtml, sectionSlice(markedHtml, key).start, sectionSlice(markedHtml, key).end);
    const indent = ' '.repeat(sections[key].indent);
    const first = blocks[0].start, last = blocks[blocks.length - 1].end;
    markedHtml = markedHtml.slice(0, first)
      + `${indent}<!-- CARDS:${key}:START -->\n`
      + markedHtml.slice(first, last)
      + `\n${indent}<!-- CARDS:${key}:END -->`
      + markedHtml.slice(last);
  }
}

const out = {
  _readme: [
    'Card data for the claudeslab.com homepage grids. Edit THIS file to add/change/remove a homepage card,',
    'then run: node scripts/build-home-index.mjs  — never hand-edit index.html between CARDS markers.',
    'A card is canonical fields {href?, cardClass, icon?, title, meta?, desc, tags?} or {raw: exact HTML}.',
    'href omitted = non-clickable div card. desc/title use HTML entities (&mdash; not a literal em dash).',
    'sep = exact bytes preceding the card (default: one blank line). Order in this file = order on the page.',
  ],
  sections,
};

mkdirSync('data', { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`WROTE ${OUT} (${totalCanonical} canonical, ${totalRaw} raw)`);
if (WRITE_MARKERS) {
  writeFileSync(SRC, markedHtml, 'utf8');
  console.log(`WROTE ${SRC} with markers (+${markedHtml.length - html.length} bytes)`);
}
