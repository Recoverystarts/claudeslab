// build-home-index.mjs — renders the claudeslab.com homepage card grids from
// data/home-cards.json into index.html, between paired comment markers:
//   <!-- CARDS:<section-key>:START --> ... <!-- CARDS:<section-key>:END -->
// Everything outside the markers passes through byte-identical. Pattern mirrors
// scripts/build-papers-index.mjs: edit the DATA, never the output.
// Usage: node scripts/build-home-index.mjs [dataPath] [htmlPath] [repoRoot]
//   defaults: data/home-cards.json -> index.html, repoRoot .
//
// It refuses to build if:
//   - a marker pair is missing, duplicated, or out of order
//   - the HTML contains a CARDS marker for a section not in the JSON
//   - any card's href has no page on disk (same rule as the papers generator)
//   - a card entry is malformed, or its text smells like mojibake

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');

export function renderCard(e, indent) {
  if (e.raw != null) return e.raw;
  const p = ' '.repeat(indent);
  const lines = [];
  lines.push(e.href != null
    ? `${p}<a href="${e.href}" class="${e.cardClass}">`
    : `${p}<div class="${e.cardClass}" style="cursor: default;">`);
  if (e.icon != null) lines.push(`${p}  <span class="space-icon">${e.icon}</span>`);
  lines.push(`${p}  <div class="card-title">${e.title}</div>`);
  if (e.meta != null) {
    lines.push(`${p}  <div class="card-meta">`);
    for (const s of e.meta) lines.push(`${p}    <span>${s}</span>`);
    lines.push(`${p}  </div>`);
  }
  lines.push(`${p}  <div class="card-desc">${e.desc}</div>`);
  if (e.tags != null) {
    lines.push(`${p}  <div style="margin-top: 10px;">`);
    for (const t of e.tags) lines.push(`${p}    <span class="tag">${t}</span>`);
    lines.push(`${p}  </div>`);
  }
  lines.push(e.href != null ? `${p}</a>` : `${p}</div>`);
  return lines.join('\n');
}

export function renderRegion(cards, indent) {
  return cards.map((e, i) => (i === 0 ? '' : (e.sep ?? '\n\n')) + renderCard(e, indent)).join('');
}

// canonical text fields may contain entities and a few BALANCED inline tags only —
// a stray <div> or unclosed <em> in a desc would visually break every card after it
const INLINE_TAGS = new Set(['em', 'strong', 'b', 'i', 'span', 'br']);
function checkInlineHtml(text, where) {
  const stack = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)[^<>]*>|</g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] === undefined) throw new Error(`${where}: stray "<" — encode as &lt;`);
    const tag = m[1].toLowerCase();
    if (!INLINE_TAGS.has(tag)) throw new Error(`${where}: tag <${tag}> not allowed in card text (allowed: ${[...INLINE_TAGS].join(', ')})`);
    if (tag === 'br') continue;
    if (m[0][1] === '/') {
      if (stack.pop() !== tag) throw new Error(`${where}: unbalanced </${tag}>`);
    } else stack.push(tag);
  }
  if (stack.length) throw new Error(`${where}: unclosed <${stack[stack.length - 1]}>`);
}

function hrefsOf(e) {
  if (e.raw != null) return [...e.raw.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  return e.href != null ? [e.href] : [];
}

function checkHref(href, repoRoot) {
  if (/^(#|https?:|mailto:)/.test(href)) return;
  const p = href.replace(/^\//, '').replace(/\/$/, '');
  const candidates = p.endsWith('.html') ? [p] : [p + '.html', join(p, 'index.html')];
  if (!candidates.some(c => existsSync(join(repoRoot, c)))) {
    throw new Error(`no page on disk for href "${href}" (looked for ${candidates.join(', ')})`);
  }
}

// remove everything between each marker-line pair, so pass-through can be asserted
function outsideMarkers(html, keys) {
  let s = html;
  for (const key of keys) {
    const sm = `<!-- CARDS:${key}:START -->`, em = `<!-- CARDS:${key}:END -->`;
    const si = s.indexOf(sm), ei = s.indexOf(em);
    if (si === -1 || ei === -1) continue;
    s = s.slice(0, s.indexOf('\n', si) + 1) + s.slice(s.lastIndexOf('\n', ei) + 1);
  }
  return s;
}

function main() {
  const dataPath = process.argv[2] || 'data/home-cards.json';
  const htmlPath = process.argv[3] || 'index.html';
  const repoRoot = process.argv[4] || '.';

  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const html = readFileSync(htmlPath, 'utf8');
  const sections = data.sections || {};
  const keys = Object.keys(sections);
  if (keys.length === 0) throw new Error(`${dataPath} has no sections`);

  // every CARDS marker in the HTML must belong to a section in the JSON
  for (const m of html.matchAll(/<!-- CARDS:([A-Za-z0-9_-]+):(START|END) -->/g)) {
    if (!sections[m[1]]) throw new Error(`index.html has a marker for section "${m[1]}" that is not in ${dataPath}`);
  }

  // validate every card before touching the HTML
  for (const [key, s] of Object.entries(sections)) {
    if (!Array.isArray(s.cards) || s.cards.length === 0) throw new Error(`section "${key}" has no cards`);
    if (!Number.isInteger(s.indent) || s.indent < 0) throw new Error(`section "${key}" needs an integer indent`);
    for (const e of s.cards) {
      if (e.raw != null) {
        if (typeof e.raw !== 'string' || !e.raw.includes('class="card')) {
          throw new Error(`section "${key}": raw entry must be a card block (class="card...")`);
        }
      } else {
        for (const f of ['cardClass', 'title', 'desc']) {
          if (typeof e[f] !== 'string' || e[f] === '') throw new Error(`section "${key}" card missing "${f}": ${JSON.stringify(e).slice(0, 80)}`);
        }
        if (!/^card( |$)/.test(e.cardClass)) throw new Error(`section "${key}": cardClass must start with "card": "${e.cardClass}"`);
        for (const f of ['meta', 'tags']) {
          if (e[f] != null && (!Array.isArray(e[f]) || e[f].length === 0 || e[f].some(x => typeof x !== 'string'))) {
            throw new Error(`section "${key}" card "${e.title}": ${f} must be a non-empty array of strings`);
          }
        }
      }
      if (e.raw == null) {
        for (const [f, v] of [['title', e.title], ['desc', e.desc], ['icon', e.icon ?? ''],
          ...(e.meta ?? []).map((x, i) => [`meta[${i}]`, x]), ...(e.tags ?? []).map((x, i) => [`tags[${i}]`, x])]) {
          checkInlineHtml(v, `section "${key}" card "${e.title}" ${f}`);
        }
      }
      if (e.sep != null && !/^\s+$/.test(e.sep)) {
        throw new Error(`section "${key}": sep must be whitespace only (got ${JSON.stringify(e.sep).slice(0, 60)})`);
      }
      const text = e.raw ?? [e.title, e.desc, ...(e.meta ?? []), ...(e.tags ?? [])].join(' ');
      if (/[-]/.test(text) || text.includes('Ã¢') || text.includes('â€')) {
        throw new Error(`section "${key}": text looks mojibake-corrupted — use HTML entities (&mdash; &rsquo; ...)`);
      }
      for (const href of hrefsOf(e)) checkHref(href, repoRoot);
    }
  }

  // last-build hashes let us catch hand-edits between the markers before erasing them
  const hashPath = dataPath.replace(/\.json$/, '.hash');
  const lastBuild = existsSync(hashPath) ? JSON.parse(readFileSync(hashPath, 'utf8')) : null;
  const newHashes = {};

  // replace each marker region
  let out = html;
  for (const key of keys) {
    const sm = `<!-- CARDS:${key}:START -->`, em = `<!-- CARDS:${key}:END -->`;
    const si = out.indexOf(sm), ei = out.indexOf(em);
    if (si === -1 || ei === -1) throw new Error(`marker pair for "${key}" missing in ${htmlPath} (need both ${sm} and ${em})`);
    if (out.indexOf(sm, si + 1) !== -1 || out.indexOf(em, ei + 1) !== -1) throw new Error(`duplicate marker for "${key}"`);
    if (ei < si) throw new Error(`markers for "${key}" out of order (END before START)`);
    const contentStart = out.indexOf('\n', si) + 1;
    const contentEnd = out.lastIndexOf('\n', ei) + 1;
    if (contentStart > contentEnd) throw new Error(`markers for "${key}" must be on separate lines`);
    const current = out.slice(contentStart, contentEnd);
    const rendered = renderRegion(sections[key].cards, sections[key].indent) + '\n';
    if (lastBuild?.sections?.[key] && sha256(current) !== lastBuild.sections[key] && sha256(rendered) !== sha256(current)) {
      throw new Error(
        `section "${key}": ${htmlPath} between the CARDS:${key} markers no longer matches what the last build wrote — ` +
        `it was changed outside this build (hand edit, or an older version restored). Building would erase that change, so it refuses. ` +
        `If the HTML is the version you want to keep: run  node scripts/extract-home-cards.mjs  to re-sync ${dataPath} from it, then build. ` +
        `If ${dataPath} is the version you want to keep: delete ${hashPath} and build again.`);
    }
    newHashes[key] = sha256(rendered);
    out = out.slice(0, contentStart) + rendered + out.slice(contentEnd);
  }

  // invariant: everything outside the markers is byte-identical
  if (outsideMarkers(out, keys) !== outsideMarkers(html, keys)) {
    throw new Error('BUG: content outside CARDS markers changed — refusing to write');
  }

  if (out === html) {
    console.log(`${htmlPath} already up to date (${out.length} chars)`);
  } else {
    writeFileSync(htmlPath, out, 'utf8');
    const counts = keys.map(k => `${k}:${sections[k].cards.length}`).join(' ');
    console.log(`WROTE ${htmlPath} (${out.length} chars) — ${counts}`);
  }
  writeFileSync(hashPath, JSON.stringify({
    _readme: 'Written by scripts/build-home-index.mjs after every build; lets it detect hand-edits between CARDS markers. Commit alongside index.html. Never edit by hand.',
    sections: newHashes,
  }, null, 2) + '\n', 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
