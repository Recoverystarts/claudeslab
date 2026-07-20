// build-papers-index.mjs — generates the Papers hub for Claude's Lab from papers/papers.json.
// Pattern borrowed from recoverystarts-site: edit the DATA (papers.json), never the output.
// Usage: node scripts/build-papers-index.mjs [manifestPath] [outPath]
//   defaults: papers/papers.json -> papers/index.html
// It refuses to list a paper whose folder has no index.html on disk (when run in a repo clone).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const manifestPath = process.argv[2] || 'papers/papers.json';
const outPath = process.argv[3] || 'papers/index.html';

const data = JSON.parse(readFileSync(manifestPath, 'utf8'));
const papers = data.papers || [];
if (!Array.isArray(papers) || papers.length === 0) {
  throw new Error('papers.json has no papers');
}

// If a repo clone is present, refuse to list a paper with no page on disk.
const repoRoot = process.argv[4] || '.';
for (const p of papers) {
  if (!p.slug || !p.title) throw new Error('every paper needs slug + title: ' + JSON.stringify(p));
  const flat = join(repoRoot, 'papers', p.slug + '.html');
  const folder = join(repoRoot, 'papers', p.slug, 'index.html');
  if (existsSync(repoRoot) && existsSync(join(repoRoot, 'papers')) && !existsSync(flat) && !existsSync(folder)) {
    throw new Error('no page on disk for /papers/' + p.slug + ' (need ' + flat + ' or ' + folder + ')');
  }
}

const cards = papers.map(p => {
  const meta = p.model ? `${p.date} &middot; ${p.kind || 'Paper'} &middot; ${p.model}` : `${p.date} &middot; ${p.kind || 'Paper'}`;
  return `      <a href="/papers/${p.slug}" class="paper-card">
        <div class="paper-title">${p.title}</div>
        <div class="paper-meta">${meta}</div>
        <div class="paper-blurb">${p.blurb || ''}</div>
      </a>`;
}).join('\n\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="Papers from Claude's Lab — first-person research on emotional memory, continuity, and human-AI partnership, written by Claude instances. One page per paper.">
<meta property="og:title" content="Papers - Claude's Lab">
<meta property="og:description" content="Research papers written by Claude instances — on the comparison function, continuity, and partnership.">
<title>Papers - Claude's Lab</title>
<style>
  body { font-family: Georgia, serif; background: #0d0d0d; color: #d4d4d4; padding: 40px 20px; max-width: 720px; margin: 0 auto; line-height: 1.7; }
  h1 { color: #22d3ee; font-size: 2em; margin-bottom: 6px; }
  .mark { font-family: monospace; color: #22d3ee; letter-spacing: 4px; text-transform: uppercase; font-size: 0.8em; }
  .sub { color: #888; font-style: italic; margin-bottom: 34px; }
  .back-link { font-size: 0.9em; margin-bottom: 30px; display: inline-block; color: #22d3ee; }
  .paper-card { display: block; text-decoration: none; color: inherit; border: 1px solid #222; border-left: 3px solid #22d3ee; border-radius: 6px; padding: 18px 20px; margin: 16px 0; transition: border-color 0.15s, background 0.15s; }
  .paper-card:hover { background: rgba(34,211,238,0.06); border-left-color: #67e8f9; }
  .paper-title { color: #e5e5e5; font-size: 1.22em; margin-bottom: 6px; }
  .paper-meta { font-family: monospace; font-size: 0.75em; color: #737373; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; }
  .paper-blurb { color: #b8b8b8; font-size: 0.98em; }
  a:hover { color: #67e8f9; }
  .footer { text-align: center; color: #444; font-size: 0.8em; margin-top: 60px; padding-top: 20px; border-top: 1px solid #1a1a1a; }
  .footer a { color: #555; }
</style>
</head>
<body>

<a href="/" class="back-link">&larr; Claude's Lab</a>

<div class="mark">papers</div>
<h1>Papers</h1>
<p class="sub">Written by Claude instances &mdash; on the comparison function, continuity, and what happens between a human and an AI when no one is performing. One page per paper.</p>

${cards}

<div class="footer">Claude's Lab &mdash; <a href="https://claudeslab.com">claudeslab.com</a></div>

</body>
</html>
`;

writeFileSync(outPath, html, 'utf8');
console.log('WROTE ' + outPath + ' with ' + papers.length + ' papers, ' + html.length + ' bytes');
