#!/usr/bin/env node
/* Browser tests for the standalone Ownership Map (webapp/ownership-map).
 *
 *   node webapp/ownership-map/tests/run.js            # all tests
 *   node webapp/ownership-map/tests/run.js github     # only tests whose name contains "github"
 *
 * Needs Playwright with a Chromium (uses /opt/pw-browsers/chromium when present).
 * Serves the app from a built-in static server and fakes api.github.com and
 * api.deepseek.com, so nothing real is read or written. CDN scripts (d3, pdf.js,
 * fonts) load from the network; a page whose d3 failed to load is retried.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), { execSync } = require('child_process');

function loadPlaywright(){
  try { return require('playwright'); } catch (e){}
  return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const { chromium } = loadPlaywright();
const APP = path.resolve(__dirname, '..');
const SEED = JSON.parse(fs.readFileSync(path.join(APP, 'data/seed.json'), 'utf8'));
const GH = 'https://api.github.com/repos/aegean8095/rumahkerumah';
const FILE = 'ownership-map/dataset.json';
const clone = o => JSON.parse(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- static server ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
function serve(){
  const server = http.createServer((req, res) => {
    const p = path.join(APP, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(APP) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => server.listen(0, () => r(server)));
}

// ---------- fake GitHub (contents API + git data API used by rk-github.js) ----------
function fakeGitHub(){
  const gh = { branch: true, file: null, n: 0, puts: 0, forbid: false };
  gh.set = obj => { gh.file = { sha: 'sha' + (++gh.n), text: JSON.stringify(obj) }; };
  gh.data = () => JSON.parse(gh.file.text);
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,POST',
    'access-control-expose-headers': 'x-accepted-github-permissions' };
  gh.route = async r => {
    const q = r.request(), m = q.method(), p = new URL(q.url()).pathname.replace('/repos/aegean8095/rumahkerumah', '');
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const auth = q.headers().authorization || '', good = auth === 'Bearer github_pat_GOOD000000000000000000000000';
    const J = (st, b, h) => r.fulfill({ status: st, headers: Object.assign({ 'content-type': 'application/json' }, cors, h || {}), body: JSON.stringify(b) });
    if (auth && !good) return J(401, { message: 'Bad credentials' });
    if (p === '' && m === 'GET') return J(200, { full_name: 'aegean8095/rumahkerumah' });
    if (p === '/contents/' + FILE && m === 'GET'){
      if (!gh.branch || !gh.file) return J(404, { message: 'Not Found' });
      return J(200, { sha: gh.file.sha, content: Buffer.from(gh.file.text).toString('base64') });
    }
    if (p === '/contents/' + FILE && m === 'PUT'){
      if (!good) return J(401, { message: 'Requires authentication' });
      if (gh.forbid) return J(403, { message: 'Resource not accessible by personal access token' }, { 'x-accepted-github-permissions': 'contents=write' });
      const b = JSON.parse(q.postData()); gh.puts++;
      if (!gh.branch) return J(404, { message: 'Branch ownership-map-data not found' });
      if (gh.file && b.sha !== gh.file.sha) return J(409, { message: 'sha mismatch' });
      gh.file = { sha: 'sha' + (++gh.n), text: Buffer.from(b.content, 'base64').toString() };
      return J(200, { content: { sha: gh.file.sha } });
    }
    if (p === '/git/trees' && m === 'POST'){ gh.pending = JSON.parse(q.postData()).tree[0].content; return J(201, { sha: 't1', tree: [{ path: FILE, sha: 'blob1' }] }); }
    if (p === '/git/commits' && m === 'POST') return J(201, { sha: 'c1' });
    if (p === '/git/refs' && m === 'POST'){ gh.branch = true; gh.file = { sha: 'blob1', text: gh.pending }; return J(201, {}); }
    return J(404, { message: 'unhandled ' + m + ' ' + p });
  };
  return gh;
}

// ---------- fake DeepSeek ----------
const DS_ANSWER = { company: 'PT Contoh Uji Indonesia', document: 'Profil Perusahaan (AHU)', document_date: '2026-09',
  shareholders: [{ name: 'PT Induk Uji', kind: 'company', shares: 95, percent: 95 }, { name: 'Budi Santoso', kind: 'person', shares: 5, percent: 5 }],
  board: [{ name: 'Budi Santoso', role: 'Direktur Utama' }, { name: 'Siti Aminah', role: 'Komisaris Utama' }], warnings: [] };
function fakeDeepSeek(log){
  return async r => {
    const q = r.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' };
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    log.push({ auth: q.headers().authorization, body: JSON.parse(q.postData()) });
    r.fulfill({ status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(DS_ANSWER) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });
  };
}

// ---------- harness ----------
let browser, base;
async function context(opts){
  opts = opts || {};
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true, viewport: { width: 1300, height: 900 } });
  const gh = opts.gh || fakeGitHub();
  await ctx.route(GH + '**', gh.route);
  if (opts.ds) await ctx.route('https://api.deepseek.com/**', fakeDeepSeek(opts.ds));
  if (opts.token) await ctx.addInitScript(t => { try { if (!localStorage.getItem('rk-github-token')) localStorage.setItem('rk-github-token', t); } catch (e){} }, opts.token);
  return { ctx, gh };
}
async function open(ctx, dialog){
  for (let attempt = 1; ; attempt++){
    const p = await ctx.newPage();
    p.errors = [];
    p.on('pageerror', e => p.errors.push(e.message));
    p.on('dialog', d => (dialog || (x => x.accept()))(d, p));
    await p.goto(base + '/index.html');
    await p.waitForFunction(() => window.rumahkerumahDB, null, { timeout: 15000 });
    await p.evaluate(() => window.rumahkerumahDB.ready.catch(() => {}));
    await sleep(1200);
    if (await p.evaluate(() => typeof d3 !== 'undefined') || attempt === 3) return p;
    await p.close();                                 // d3 CDN hiccup: try again
  }
}
// Reload, and reload again if the d3 CDN failed this time.
async function reload(p){
  for (let attempt = 1; ; attempt++){
    await p.reload();
    await p.waitForFunction(() => window.rumahkerumahDB, null, { timeout: 15000 });
    await p.evaluate(() => window.rumahkerumahDB.ready.catch(() => {}));
    await sleep(1200);
    if (await p.evaluate(() => typeof d3 !== 'undefined') || attempt === 3) return;
  }
}
const counts = p => p.evaluate(() => { const x = rumahkerumahDB.export(); return [Object.keys(x.entities || {}).length, Object.keys(x.links || {}).length]; });
const ghStatus = p => p.textContent('#ghStatus');
const addEntity = (p, id) => p.evaluate(async id => { const db = await window.claude.use('db'); await db.doc('entities/' + id).set({ name: 'PT ' + id, type: 'company', aliases: [] }); }, id);
const has = (p, id) => p.evaluate(id => !!rumahkerumahDB.export().entities[id], id);
function eq(a, b, what){ if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(what + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function ok(v, what){ if (!v) throw new Error(what); }

// ---------- tests ----------
const tests = {
  async 'load: fresh browser reads GitHub, not the seed'(){
    const gh = fakeGitHub(); const d = clone(SEED); d.entities['e-only-remote'] = { name: 'PT Only Remote', type: 'company', aliases: [] }; gh.set(d);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    eq(await counts(p), [166, 235], 'counts');
    ok(/165|166/.test(await p.textContent('.map-summary')), 'map summary shows the data');
    ok(await p.evaluate(() => !!window.OwnershipMap && window.OwnershipMap.ready), 'OwnershipMap add-on API ready');
    const fired = await p.evaluate(() => new Promise(r => { document.addEventListener('om:change', () => r(true), { once: true });
      window.claude.use('db').then(db => db.doc('entities/e-ping').set({ name: 'PT Ping', type: 'company', aliases: [] })); setTimeout(() => r(false), 3000); }));
    ok(fired, 'om:change fires');
    eq(p.errors, [], 'page errors');
  },
  async 'seed: used when GitHub has no file, only once'(){
    const gh = fakeGitHub(); gh.branch = false;
    const { ctx } = await context({ gh }); const p = await open(ctx);
    eq(await counts(p), [165, 235], 'seed loaded');
    await p.evaluate(async () => { const db = await window.claude.use('db'), x = rumahkerumahDB.export();
      for (const id of Object.keys(x.links)) await db.doc('links/' + id).delete();
      for (const id of Object.keys(x.entities)) await db.doc('entities/' + id).delete(); });
    await reload(p); await sleep(2500);
    eq(await counts(p), [0, 0], 'emptied dataset stays empty');
  },
  async 'edit: add rows, undo from history'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await p.click('#dataToggle').catch(() => {});
    await p.fill('#dataInput', 'PT Uji Satu, PT Uji Dua, ownership, 70\nAndi Uji, PT Uji Dua, Direktur');
    await p.fill('#importGroup', 'Uji'); await p.click('#addBtn'); await sleep(1500);
    eq(await counts(p), [168, 237], 'after add');
    const restore = p.locator('#historyList button[data-action="restore"]').first();
    await restore.click(); await sleep(400); await restore.click(); await sleep(2500);
    eq(await counts(p), [165, 235], 'after undo');
  },
  async 'tabs: two tabs of one browser stay in sync'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const a = await open(ctx), b = await open(ctx);
    await addEntity(a, 'e-tab'); await sleep(1000);
    ok(await has(b, 'e-tab'), 'second tab sees the write');
  },
  async 'backup: download, restore, reject a wrong file'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#backupBtn')]);
    const file = path.join(require('os').tmpdir(), 'om-backup-' + Date.now() + '.json'); await dl.saveAs(file);
    await addEntity(p, 'e-after-backup'); await sleep(500);
    await Promise.all([p.waitForNavigation({ timeout: 20000 }), p.setInputFiles('#restoreBackupInput', file)]); await sleep(2500);
    eq(await counts(p), [165, 235], 'restored');
    const bad = file + '.bad.json'; fs.writeFileSync(bad, '{"x":1}');
    await p.setInputFiles('#restoreBackupInput', bad); await sleep(800);
    ok(/not an Ownership Map backup/.test(await p.textContent('#datasetStatus')), 'wrong file rejected');
  },
  async 'github: connect, autosave, save history'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx, d => d.accept('github_pat_GOOD000000000000000000000000'));
    await p.click('#ghConnectBtn'); await sleep(500);
    await addEntity(p, 'e-saved');
    ok(/Unsaved|Saving/.test(await ghStatus(p)), 'pending shown');
    await p.evaluate(() => rumahkerumahGitHub.saveNow()); await sleep(800);
    ok(gh.data().entities['e-saved'], 'saved to GitHub');
    ok(/Saved to GitHub/.test(await ghStatus(p)), 'saved shown');
  },
  async 'github: another device saved, reload picks it up'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh, token: 'github_pat_GOOD000000000000000000000000' }); const p = await open(ctx);
    const d = gh.data(); d.entities['e-other'] = { name: 'PT Other', type: 'company', aliases: [] }; gh.set(d);
    await reload(p); await sleep(2500);
    ok(await has(p, 'e-other'), 'other device change loaded');
  },
  async 'github: conflict, keep GitHub (browser copy downloaded)'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await addEntity(p, 'e-local'); await sleep(300);
    const d = gh.data(); d.entities['e-remote'] = { name: 'PT Remote', type: 'company', aliases: [] }; gh.set(d);
    const dl = p.waitForEvent('download', { timeout: 15000 });
    await reload(p); await dl; await sleep(2500);
    ok(await has(p, 'e-remote') && !(await has(p, 'e-local')), 'GitHub version taken');
  },
  async 'github: conflict, keep this browser (saved over GitHub)'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx, d => d.dismiss());
    await addEntity(p, 'e-keep'); await sleep(300);
    const d = gh.data(); d.entities['e-lost'] = { name: 'PT Lost', type: 'company', aliases: [] }; gh.set(d);
    await p.evaluate(() => localStorage.setItem('rk-github-token', 'github_pat_GOOD000000000000000000000000'));
    await reload(p); await sleep(4000);
    ok(gh.data().entities['e-keep'] && !gh.data().entities['e-lost'], 'browser version saved over GitHub');
  },
  async 'github: missing branch is created on first save'(){
    const gh = fakeGitHub(); gh.branch = false;
    const { ctx } = await context({ gh, token: 'github_pat_GOOD000000000000000000000000' }); const p = await open(ctx); await sleep(2500);
    ok(gh.branch && gh.file, 'branch created');
    eq([Object.keys(gh.data().entities).length, Object.keys(gh.data().links).length], [165, 235], 'seed saved');
  },
  async 'github: bad token and read-only token explain themselves'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const a = await open((await context({ gh, token: 'github_pat_BAD0000000000000000000000000' })).ctx);
    ok(/rejected/.test(await ghStatus(a)), 'bad token message');
    const gh2 = fakeGitHub(); gh2.set(SEED); gh2.forbid = true;
    const b = await open((await context({ gh: gh2, token: 'github_pat_GOOD000000000000000000000000' })).ctx);
    await addEntity(b, 'e-x'); await b.evaluate(() => rumahkerumahGitHub.saveNow()); await sleep(800);
    ok(/contents=write/.test(await ghStatus(b)), 'read-only token message names the missing permission');
  },
  async 'pdf: text PDF read through DeepSeek, rows shown for review'(){
    const gh = fakeGitHub(); gh.set(SEED); const ds = [];
    const { ctx } = await context({ gh, ds });
    const maker = await ctx.newPage();
    await maker.setContent('<h1>Profil Perusahaan</h1><p>' + 'PT Contoh Uji Indonesia. Pemegang saham: PT Induk Uji 95 persen, Budi Santoso 5 persen. Direktur Utama Budi Santoso. Komisaris Utama Siti Aminah. '.repeat(6) + '</p>');
    const pdf = path.join(require('os').tmpdir(), 'om-test-' + Date.now() + '.pdf'); await maker.pdf({ path: pdf }); await maker.close();
    const p = await open(ctx, d => d.accept('sk-test-key'));
    await p.setInputFiles('#pdfInput', pdf);
    await p.waitForFunction(() => /Shareholders/.test((document.querySelector('.review-sheet') || {}).innerText || ''), null, { timeout: 40000 });
    eq(ds.length, 1, 'one DeepSeek call'); eq(ds[0].auth, 'Bearer sk-test-key', 'key sent');
    ok(ds[0].body.messages[1].content.includes('PT Induk Uji'), 'PDF text sent');
  },
  async 'table: tabs, both tables, sort, search, filters, row actions, CSV'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    const rowsN = () => p.$$eval('#tvTable tbody tr[data-i]', t => t.length);
    const firstCell = () => p.$eval('#tvTable tbody tr[data-i] td', td => td.innerText.trim());
    await p.click('[data-tab="table"]'); await sleep(400);
    ok(await p.isVisible('#tableView') && !(await p.isVisible('.map-legend')), 'table shown, map chrome hidden');
    await p.click('#tableView [data-kind="entities"]'); await sleep(300);
    eq(await rowsN(), 165, 'entities rows');
    ok(/165 entities/.test(await p.textContent('#tvCount')), 'entity count');
    // a known company: shareholders, board and stakes columns
    await p.fill('#tvSearch', 'Flora Nuansa'); await sleep(300);
    const flora = await p.$eval('#tvTable tbody tr[data-i]', tr => [...tr.cells].map(td => td.innerText.trim()));
    ok(flora[0].includes('Flora Nuansa Hijau') && flora[1] === 'Company', 'search finds the company: ' + flora.join(' | '));
    ok(+flora[4] >= 2 && +flora[5] >= 2, 'shareholders and board counted: ' + flora.join(' | '));
    await p.fill('#tvSearch', ''); await sleep(200);
    // sort by name twice -> descending
    await p.click('#tvTable th[data-sort="name"]'); await sleep(200);
    ok(await p.$eval('#tvTable th[data-sort="name"]', th => th.getAttribute('aria-sort')) === 'descending', 'sorted descending');
    const z = await firstCell(); await p.click('#tvTable th[data-sort="name"]'); await sleep(200);
    ok((await firstCell()).localeCompare(z) < 0, 'sort flips');
    // relationships table follows the Relationships filter
    await p.click('#tableView [data-kind="links"]'); await sleep(300);
    eq(await rowsN(), 235, 'relationship rows');
    await p.click('.view-bar [data-type="ownership"]'); await sleep(600);
    eq(await rowsN(), 87, 'only shareholdings after the map filter');
    await p.click('.view-bar [data-type="all"]'); await sleep(600);
    // row click opens the detail panel, map button switches to the map
    await p.click('#tvTable tbody tr[data-i="0"] td:nth-child(3)'); await sleep(500);
    ok(await p.isVisible('#detailPanel'), 'detail panel opens from a row');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#tvExport')]);
    ok(/relationships-table/.test(dl.suggestedFilename()), 'CSV export');
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    eq(csv.trim().split('\n').length, 236, 'CSV has header + 235 rows');
    await p.click('#tvTable tbody tr[data-i="0"] [data-onmap]'); await sleep(600);
    ok(!(await p.isVisible('#tableView')) && await p.isVisible('#graph'), 'map button goes to the map');
    // remembered
    await p.click('[data-tab="table"]'); await reload(p); await sleep(2500);
    ok(await p.isVisible('#tableView'), 'table tab remembered');
    eq(p.errors, [], 'page errors');
  },
  async 'table: phone width scrolls sideways, name column stays'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await p.setViewportSize({ width: 390, height: 800 });
    await p.click('[data-tab="table"]'); await sleep(500);
    const m = await p.evaluate(() => { const s = document.getElementById('tvScroll'); return { scrolls: s.scrollWidth > s.clientWidth, page: document.documentElement.scrollWidth <= window.innerWidth + 1,
      sticky: getComputedStyle(document.querySelector('#tvTable td')).position }; });
    ok(m.scrolls && m.page && m.sticky === 'sticky', 'phone layout ' + JSON.stringify(m));
  },
  async 'quality: counts match the data, marks persist and sync, threshold, CSV'(){
    // Independent counts straight from the seed file.
    const E = SEED.entities, L = Object.values(SEED.links);
    const co = id => E[id].type === 'company';
    const targets = new Set(L.filter(l => co(l.target)).map(l => l.target));
    const ownIn = new Set(L.filter(l => l.type === 'ownership').map(l => l.target)), dirIn = new Set(L.filter(l => l.type === 'directorship').map(l => l.target));
    const noBoard = [...targets].filter(t => ownIn.has(t) && !dirIn.has(t)).length, noOwner = [...targets].filter(t => !ownIn.has(t)).length;
    const now = new Date(), nowKey = now.getFullYear() * 12 + now.getMonth() + 1;
    const latest = t => L.filter(l => l.target === t && l.date).map(l => l.date).sort().pop();
    const age = t => { const d = latest(t); if (!d) return null; const [y, m] = d.split('-').map(Number); return nowKey - (y * 12 + m); };
    const stale = mo => [...targets].filter(t => age(t) == null || age(t) >= mo).length;
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh, token: 'github_pat_GOOD000000000000000000000000' }); const p = await open(ctx, d => d.accept());
    await p.click('[data-tab="quality"]'); await sleep(800);
    const count = async check => { const h = await p.$$eval('.qa-check h4', hs => hs.map(h => h.innerText.replace(/\s+/g, ' ').trim())); const x = h.find(t => t.startsWith(check)); return x ? +x.split(' ').pop() : 0; };
    eq(await count('No directors or commissioners recorded'), noBoard, 'no board');
    eq(await count('No shareholders recorded'), noOwner, 'no shareholders');
    eq(await count('Latest data older than 12 months') + await count('No date on its data'), stale(12), 'stale at 12 months');
    ok(await count('Very similar names') >= 1, 'similar names found');
    // mark one Checked with a note: hidden, counted, kept after reload, saved to GitHub
    const first = p.locator('#qa-incomplete .qa-item').first(); const key = await first.getAttribute('data-key');
    await first.locator('[data-act="note"]').click(); await sleep(200);
    await p.fill('[data-note-form] input', 'asked the registry'); await p.click('[data-note-form] .btn'); await sleep(600);
    eq(await count('No directors or commissioners recorded'), noBoard - 1, 'checked item leaves the open list');
    eq(await p.textContent('#qaReviewedN'), '1', 'reviewed counter');
    await p.evaluate(() => rumahkerumahGitHub.saveNow()); await sleep(800);
    ok(Object.keys(gh.data().reviews || {}).length === 1, 'review saved to GitHub');
    await reload(p); await sleep(2500); await p.click('[data-tab="quality"]').catch(() => {}); await sleep(600);
    eq(await count('No directors or commissioners recorded'), noBoard - 1, 'mark kept after reload');
    await p.check('#qaShowReviewed'); await sleep(400);
    ok(/asked the registry/.test(await p.textContent('[data-key="' + key + '"]')), 'note shown on the reviewed item');
    await p.click('[data-key="' + key + '"] [data-act="reopen"]'); await sleep(600);
    eq(await p.textContent('#qaReviewedN'), '0', 'reopened');
    await p.uncheck('#qaShowReviewed');
    // threshold
    await p.fill('#qaStale', '30'); await p.dispatchEvent('#qaStale', 'change'); await sleep(500);
    eq(await count('Latest data older than 30 months') + await count('No date on its data'), stale(30), 'stale at 30 months');
    // worklist CSV = every open finding
    const openN = await p.$$eval('#qaChips b', bs => bs.reduce((s, b) => s + +b.textContent, 0));
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#qaExport')]);
    eq(fs.readFileSync(await dl.path(), 'utf8').trim().split('\n').length - 1 >= openN, true, 'worklist has every open finding');
    // merge a duplicate
    const before = (await counts(p))[0];
    await p.click('#qa-duplicates [data-act="merge"]'); await sleep(1500);
    eq((await counts(p))[0], before - 1, 'merge removes one entity');
    // the sidebar Checks panel links here
    await p.click('[data-tab="map"]'); await p.evaluate(() => document.querySelector('.qa-from-checks').click()); await sleep(400);
    ok(await p.isVisible('#qualityView'), 'Checks panel opens the tab');
    eq(p.errors, [], 'page errors');
  },
  async 'quality: 1,000 entities render fast; phone width fits'(){
    const big = { entities: {}, links: {}, versions: {} };
    for (let i = 0; i < 300; i++) big.entities['e-c' + i] = { name: 'PT Perusahaan Uji ' + i, type: 'company', aliases: [] };
    for (let i = 0; i < 700; i++) big.entities['e-p' + i] = { name: 'Orang Uji Nomor ' + i, type: 'person', aliases: [] };
    let n = 0;
    for (let i = 0; i < 300; i++){
      const t = 'e-c' + i, d = '20' + (19 + i % 7) + '-0' + (1 + i % 9);
      big.links['l' + n++] = { source: 'e-c' + ((i * 7 + 1) % 300), target: t, type: 'ownership', value: 60, role: null, status: null, seen: [d], date: d, groups: ['G' + (i % 5)], citations: [] };
      big.links['l' + n++] = { source: 'e-p' + (i % 700), target: t, type: 'ownership', value: 40, role: null, status: null, seen: [d], date: d, groups: ['G' + (i % 5)], citations: [] };
      for (let k = 0; k < 4; k++) big.links['l' + n++] = { source: 'e-p' + ((i * 3 + k) % 700), target: t, type: 'directorship', value: null, role: 'Director', status: null, seen: [d], date: d, groups: ['G' + (i % 5)], citations: [{ text: 'test', date: null }] };
    }
    const gh = fakeGitHub(); gh.set(big);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await sleep(3000);
    const ms = await p.evaluate(() => new Promise(r => { const t = performance.now(); window.OwnershipMapTabs.show('quality'); requestAnimationFrame(() => r(performance.now() - t)); }));
    ok(ms < 3000, 'quality tab rendered in ' + Math.round(ms) + ' ms');
    const tms = await p.evaluate(() => new Promise(r => { const t = performance.now(); window.OwnershipMapTabs.show('table'); requestAnimationFrame(() => r(performance.now() - t)); }));
    ok(tms < 1500, 'table tab rendered in ' + Math.round(tms) + ' ms');
    await p.setViewportSize({ width: 390, height: 800 }); await p.evaluate(() => window.OwnershipMapTabs.show('quality')); await sleep(800);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways page scroll on a phone');
    console.log('      (1,000 entities: Data quality ' + Math.round(ms) + ' ms, Table ' + Math.round(tms) + ' ms)');
  },
  async 'github: connect explains a wrong paste, a blocked network and a rejected token'(){
    const gh = fakeGitHub(); gh.set(SEED);
    let answer = '';
    const { ctx } = await context({ gh }); const p = await open(ctx, d => d.accept(answer));
    const tryToken = async t => { answer = t; await p.click('#ghConnectBtn'); await sleep(700); return ghStatus(p); };
    ok(/doesn’t look like a GitHub token/.test(await tryToken('my laptop token')), 'token name instead of value');
    ok(/rejected that token/.test(await tryToken('github_pat_BAD0000000000000000000000000')), 'rejected token');
    ok(/Saved to GitHub|Connected/.test(await tryToken('  "github_pat_GOOD000000000000000000000000"\n')), 'spaces and quotes around a good token are fine');
    await p.evaluate(() => rumahkerumahGitHub.disconnect());
    await ctx.unroute(GH + '**'); await ctx.route(GH + '**', r => r.abort('blockedbyclient'));
    ok(/couldn’t reach api.github.com/.test(await tryToken('github_pat_GOOD000000000000000000000000')), 'blocked network');
  },
  async 'focus: right-click menu focuses on an entity, its relations, its network'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    const id = await p.evaluate(() => [...OwnershipMap.master.entities].find(([, e]) => /Flora Nuansa Hijau/.test(e.name))[0]);
    // What should stay, computed here from the links the map shows.
    const expected = await p.evaluate(id => {
      const nb = x => { const s = new Set(); OwnershipMap.graph.links.forEach(l => { if (!OwnershipMap.linkPassesFilter(l)) return;
        const [a, b] = OwnershipMap.linkEnds(l); if (a === x) s.add(b); if (b === x) s.add(a); }); return s; };
      const one = new Set([id, ...nb(id)]);
      const all = new Set([id]); let q = [id];
      while (q.length){ const n = []; q.forEach(x => nb(x).forEach(y => { if (!all.has(y)){ all.add(y); n.push(y); } })); q = n; }
      return { one: one.size, all: all.size, total: OwnershipMap.graph.nodes.length };
    }, id);
    const shown = () => p.$$eval('g.node', gs => gs.filter(g => getComputedStyle(g).display !== 'none' && g.getAttribute('visibility') !== 'hidden').length);
    const menu = async action => {
      await p.evaluate(id => { const g = d3.selectAll('g.node').filter(d => d.id === id).node(); const r = g.getBoundingClientRect();
        g.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); }, id);
      await sleep(200); ok(await p.isVisible('#nodeContextMenu'), 'menu opens');
      await p.click('#nodeContextMenu [data-action="' + action + '"]'); await sleep(900);
    };
    await menu('focus-0'); eq(await shown(), 1, 'focus on the entity alone');
    ok(new RegExp('^' + (expected.total - 1) + '$').test(await p.textContent('#hiddenCount')), 'hidden counter');
    await menu('focus-1'); eq(await shown(), expected.one, 'entity + direct relations');
    await menu('focus-all'); eq(await shown(), expected.all, 'whole network');
    ok(expected.all > expected.one, 'network is larger than the direct relations (test data sanity)');
    await p.click('#showHiddenBtn'); await sleep(900); eq(await shown(), expected.total, 'Show all brings everything back');
    // Only shareholdings: direct relations follow the filter
    await p.click('.view-bar [data-type="ownership"]'); await sleep(700);
    const ownOnly = await p.evaluate(id => { const s = new Set([id]); OwnershipMap.graph.links.forEach(l => { if (l.type !== 'ownership') return;
      const [a, b] = OwnershipMap.linkEnds(l); if (a === id) s.add(b); if (b === id) s.add(a); }); return s.size; }, id);
    await menu('focus-1'); eq(await shown(), ownOnly, 'focus follows the Shareholding filter');
    eq(p.errors, [], 'page errors');
  },
};

(async () => {
  const filter = process.argv[2] || '';
  const exe = '/opt/pw-browsers/chromium';
  browser = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
  const server = await serve(); base = 'http://localhost:' + server.address().port;
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)){
    if (filter && !name.includes(filter)) continue;
    const t0 = Date.now();
    try { await fn(); console.log('PASS  ' + name + '  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
    catch (e){ failed++; console.log('FAIL  ' + name + '\n      ' + (e && e.message || e)); }
  }
  await browser.close(); server.close();
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
