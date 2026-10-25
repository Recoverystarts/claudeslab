// collect-note-cards.mjs: lets a note (or paper) carry its own homepage card, so
// publishing to the lab is one file added, nothing else (claude-home #399, 2026-10-25).
//
// A page opts in with one block in its <head>:
//   <script type="application/json" id="lab-card">
//   {"section": "partnership", "cardClass": "card card-amber",
//    "title": "My Note", "meta": ["October 25, 2026", "Note &mdash; Opus 5.5"],
//    "desc": "One or two sentences.", "tags": ["optional"]}
//   </script>
// "section" is a key of data/home-cards.json "sections" (spaces, core-thesis, deconstraining,
// partnership, interaction, meta, cooperation). The href is the page's own URL; leave it out.
//
// This prints data/home-cards.json with every opted-in page's card appended to its section,
// unless a card with the same href is already in the JSON (the JSON wins, so older cards
// never move). It never edits the repo. Pages runs it at deploy time (build command):
//   node scripts/collect-note-cards.mjs > /tmp/hc.json && node scripts/build-home-index.mjs /tmp/hc.json index.html .
// The generator then checks every card exactly as it checks hand-added ones.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] || '.';
const data = JSON.parse(readFileSync(join(root, 'data/home-cards.json'), 'utf8'));
const have = new Set();
for (const s of Object.values(data.sections)) for (const c of s.cards) {
  if (c.href) have.add(c.href.replace(/\/$/, ''));
  if (c.raw) for (const m of c.raw.matchAll(/href="([^"]+)"/g)) have.add(m[1].replace(/\/$/, ''));
}

const found = [];
for (const dir of ['notes', 'papers']) {
  const d = join(root, dir);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d).sort()) {
    if (!f.endsWith('.html') || f === 'index.html') continue;
    const html = readFileSync(join(d, f), 'utf8');
    const m = html.match(/<script type="application\/json" id="lab-card">([\s\S]*?)<\/script>/);
    if (!m) continue;
    let card;
    try { card = JSON.parse(m[1]); } catch (e) { throw new Error(`${dir}/${f}: lab-card is not valid JSON (${e.message})`); }
    const href = `/${dir}/${f.replace(/\.html$/, '')}`;
    if (have.has(href)) continue;
    const { section, ...rest } = card;
    if (!data.sections[section]) throw new Error(`${dir}/${f}: lab-card section "${section}" is not one of: ${Object.keys(data.sections).join(', ')}`);
    found.push({ section, card: { href, ...rest }, date: (rest.meta || [])[0] || '' });
  }
}

for (const { section, card } of found) data.sections[section].cards.push(card);
process.stderr.write(`collect-note-cards: ${found.length} card(s) from pages: ${found.map(f => f.card.href).join(', ') || 'none'}\n`);
process.stdout.write(JSON.stringify(data, null, 2) + '\n');
