// Statistiques statiques du dépôt : lignes par projet et par rôle, octets servis, historique git.
//   node tools/stats-static.mjs > stats-static.json
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const sh = (c) => execSync(c, { encoding: 'utf8', maxBuffer: 1 << 28 });
const files = sh('git ls-files').trim().split('\n');
const CODE = /\.(js|mjs|py|css|html|wgsl|glsl)$/;

function role(rel) {
  const [top, sub] = rel.split('/');
  if (rel.endsWith('.md')) return 'docs';
  if (sub === 'test' || /\.test\.mjs$/.test(rel)) return 'test';
  if (sub === 'tools') return 'tools';
  if (sub === 'proto') return 'proto';
  if (/explainer\.(html|css|js)$/.test(rel)) return 'explainer';
  return 'runtime';
}
function count(path) {
  const txt = readFileSync(path, 'utf8');
  let code = 0, comment = 0, blank = 0, inBlock = false;
  if (path.endsWith('.md')) { for (const l of txt.split('\n')) l.trim() ? code++ : blank++; return { code, comment, blank, bytes: Buffer.byteLength(txt) }; }
  for (const raw of txt.split('\n')) {
    const l = raw.trim();
    if (!l) { blank++; continue; }
    if (inBlock) { comment++; if (l.includes('*/')) inBlock = false; continue; }
    if (l.startsWith('//') || l.startsWith('#') && !path.endsWith('.css') || l.startsWith('<!--')) { comment++; continue; }
    if (l.startsWith('/*')) { comment++; if (!l.includes('*/')) inBlock = true; continue; }
    code++;
  }
  return { code, comment, blank, bytes: Buffer.byteLength(txt) };
}

const projects = {};
for (const f of files) {
  const top = f.includes('/') ? f.split('/')[0] : '(racine)';
  const p = (projects[top] ??= { files: 0, roles: {}, bytesAll: 0 });
  let size = 0; try { size = statSync(f).size; } catch { continue; }
  p.files++; p.bytesAll += size;
  if (!CODE.test(f) && !f.endsWith('.md')) continue;
  const r = role(f);
  const c = count(f);
  const acc = (p.roles[r] ??= { files: 0, code: 0, comment: 0, blank: 0, bytes: 0 });
  acc.files++; for (const k of ['code', 'comment', 'blank', 'bytes']) acc[k] += c[k];
}

// historique git par dossier : commits, premier et dernier jour
for (const top of Object.keys(projects)) {
  if (top === '(racine)') continue;
  const log = sh(`git log --format=%ad --date=short -- ${JSON.stringify(top)}`).trim().split('\n').filter(Boolean);
  projects[top].git = { commits: log.length, first: log.at(-1), last: log[0], days: new Set(log).size };
}
const total = sh('git rev-list --count HEAD').trim();
console.log(JSON.stringify({ commitsTotal: +total, projects }, null, 1));
