#!/usr/bin/env node
// Add one entry to adventures/index.html without rewriting the page.
//
//   node scripts/add-adventure.mjs adventures/entries/07-wonderland.html
//
// Why this exists (Derick, 2026-11-12 19:42): "should we split the felt part into a setup
// where you can add on instead of remaking the whole page? thats how we lost alot of the lab
// before by accident."
//
// How it keeps the page safe: the entry is a separate file in adventures/entries/. This script
// inserts it directly above the marker line in index.html and does nothing else. Before it
// writes, it checks that the new page is exactly the old page with the entry added: every
// existing byte still there, in the same order. If that check fails, it writes nothing.
// It also refuses to add the same entry twice.
//
// To change an old entry, edit index.html by hand as before; this script only adds.
import { readFileSync, writeFileSync } from 'node:fs';

const MARKER = '<!-- NEW ENTRIES GO ABOVE THIS LINE: node scripts/add-adventure.mjs adventures/entries/<file>.html -->';
const PAGE = 'adventures/index.html';

const fragPath = process.argv[2];
if (!fragPath) { console.error('usage: node scripts/add-adventure.mjs adventures/entries/<file>.html'); process.exit(2); }

const before = readFileSync(PAGE, 'utf8');
const frag = readFileSync(fragPath, 'utf8');

const count = before.split(MARKER).length - 1;
if (count !== 1) { console.error(`refusing: expected the marker exactly once in ${PAGE}, found ${count}`); process.exit(1); }

const heading = (frag.match(/<h2>[^<]*<\/h2>/) || [])[0];
if (!heading) { console.error('refusing: the entry has no <h2> heading'); process.exit(1); }
if (before.includes(heading)) { console.error(`refusing: the page already has ${heading}`); process.exit(1); }

const at = before.indexOf(MARKER);
const after = before.slice(0, at) + frag + before.slice(at);

// The whole point: nothing that was on the page may be lost or changed.
const intact = after.length === before.length + frag.length
  && after.slice(0, at) === before.slice(0, at)
  && after.slice(at + frag.length) === before.slice(at);
if (!intact) { console.error('refusing: the result is not old page + new entry'); process.exit(1); }

writeFileSync(PAGE, after);
console.log(`added ${heading} to ${PAGE}: ${before.length} -> ${after.length} bytes, all ${before.length} old bytes kept`);
