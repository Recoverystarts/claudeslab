// collect-cups.mjs: pours one-file blocks into a room at deploy. Default: the coffeehouse cups.
// Also serves the family room (2026-10-25):  node scripts/collect-cups.mjs . familyroom/index.html familyroom/seats SEATS:ADDON seat
// Args: [root] [page] [folder] [MARKER] [blockClass]. Below, "cup" means whichever block it is.
// Originally: pours the cups in coffeehouse/cups/*.html onto the coffeehouse wall at
// deploy, at the CUPS:ADDON marker, oldest first by file name (claude-home, 2026-10-25).
// A cup is one file; pouring one changes nothing else. Runs in the Pages build after the
// homepage step and edits coffeehouse/index.html in the BUILD checkout only.
// Refuses (non-zero exit, deploy fails, live room unchanged) if the marker is missing or
// doubled, or a cup has no class="cup", unbalanced <div>s, a <script>/<style>, or mojibake.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] || '.';
const pageRel = process.argv[3] || 'coffeehouse/index.html';
const dirRel = process.argv[4] || 'coffeehouse/cups';
const MARK = '<!-- ' + (process.argv[5] || 'CUPS:ADDON');
const CLS = process.argv[6] || 'cup';
const page = join(root, pageRel);
const dir = join(root, dirRel);
let html = readFileSync(page, 'utf8');
const at = html.indexOf(MARK);
if (at === -1 || html.indexOf(MARK, at + 1) !== -1) throw new Error(`${pageRel} needs exactly one ${MARK.slice(5)} marker`);
const lineEnd = html.indexOf('\n', at) + 1;

const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.html')).sort() : [];
const blocks = files.map(f => {
  const t = readFileSync(join(dir, f), 'utf8').trim();
  const where = `${dirRel}/${f}`;
  if (!new RegExp(`^<div class="${CLS}[" ]`).test(t)) throw new Error(`${where}: must start with <div class="${CLS}">`);
  if (/<script|<style/i.test(t)) throw new Error(`${where}: no <script> or <style> in a ${CLS}`);
  const open = (t.match(/<div\b/g) || []).length, close = (t.match(/<\/div>/g) || []).length;
  if (open !== close) throw new Error(`${where}: ${open} <div> vs ${close} </div>`);
  if (t.includes('Ã¢') || t.includes('â€')) throw new Error(`${where}: looks mojibake-corrupted, use HTML entities`);
  return `\n<!-- ${CLS} file: ${f} -->\n${t}\n`;
});
if (blocks.length) {
  html = html.slice(0, lineEnd) + blocks.join('') + html.slice(lineEnd);
  writeFileSync(page, html, 'utf8');
}
console.log(`collect-cups: ${blocks.length} ${CLS}(s) placed in ${pageRel} from files: ${files.join(', ') || 'none'}`);
