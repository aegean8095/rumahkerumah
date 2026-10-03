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
  company_profile: { country: 'Indonesia', address: 'Jl. Sudirman No. 1, Jakarta Pusat', ids: [{ kind: 'Company registration no.', number: 'AHU-0012345.AH.01.01.Tahun 2015' }, { kind: 'NPWP', number: '01.234.567.8-901.000' }] },
  shareholders: [{ name: 'PT Induk Uji', kind: 'company', shares: 95, percent: 95, country: 'Singapore', address: null, ids: [] },
    { name: 'Budi Santoso', kind: 'person', shares: 5, percent: 5, country: 'Indonesia', address: 'Jl. Melati 5, Bandung', ids: [{ kind: 'NIK', number: '3273010101800001' }] }],
  board: [{ name: 'Budi Santoso', role: 'Direktur Utama', since: '2021-06-15', until: '2029-06', status: 'current', ids: [{ kind: 'NPWP (tax no.)', number: '09.876.543.2-101.000' }] },
    { name: 'Siti Aminah', role: 'Komisaris Utama', since: '2021', until: null, status: 'current' },
    { name: 'Andi Wijaya', role: 'Direktur', since: '2016-03', until: '2021-06', status: 'former' }], warnings: [] };
function fakeDeepSeek(log){
  return async r => {
    const q = r.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' };
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    log.push({ auth: q.headers().authorization, body: JSON.parse(q.postData()) });
    r.fulfill({ status: 200, contentType: 'application/json', headers: cors,
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(log.answer || DS_ANSWER) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });
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
    // This attempt's errors come from the missing CDN script, not the app: drop them before retrying.
    if (p.errors) p.errors = p.errors.filter(m => !/d3 is not defined/.test(m));
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
    ok(/company_profile/.test(ds[0].body.messages[1].content) && /KTP \/ NIK/.test(ds[0].body.messages[1].content), 'prompt asks for address, country and IDs');
    // the review shows the profile fields
    eq(await p.inputValue('[data-meta="cCountry"]'), 'Indonesia', 'company country in review');
    eq(await p.inputValue('[data-meta="cAddress"]'), 'Jl. Sudirman No. 1, Jakarta Pusat', 'company address in review');
    ok((await p.inputValue('[data-meta="cIds"]')).includes('NPWP (tax no.): 01.234.567.8-901.000'), 'company IDs, kind made standard');
    eq(await p.inputValue('tr.rv-sub[data-k="sh"][data-i="1"] [data-f="ids"]'), 'KTP / NIK: 3273010101800001', 'shareholder NIK');
    ok(!(await p.$('tr.rv-sub[data-k="bd"][data-i="1"]')), 'no details row when nothing was found');
    await p.click('tr[data-k="bd"][data-i="1"] [data-more]'); await sleep(200);
    await p.fill('tr.rv-sub[data-k="bd"][data-i="1"] [data-f="country"]', 'Malaysia');
    await p.fill('tr.rv-sub[data-k="bd"][data-i="1"] [data-f="ids"]', 'Passport: A1234567');
    // timeline read from the document
    eq([await p.inputValue('tr[data-k="bd"][data-i="0"]:not(.rv-sub) [data-f="since"]'), await p.inputValue('tr[data-k="bd"][data-i="0"]:not(.rv-sub) [data-f="until"]')], ['2021-06', '2029-06'], 'term read, day dropped');
    eq(await p.inputValue('tr[data-k="bd"][data-i="2"]:not(.rv-sub) [data-f="state"]'), 'former', 'former director marked former');
    ok(/previous role until 2021-06/.test(await p.textContent('tr[data-k="bd"][data-i="2"]:not(.rv-sub) [data-status]')), 'former row explains it is recorded as previous');
    if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
    await p.click('#rvApprove'); await sleep(2500);
    const tl = await p.evaluate(() => { const byName = n => [...OwnershipMap.master.entities].find(([, e]) => e.name === n)[0];
      const co = byName('PT Contoh Uji Indonesia'); const lk = (n, type) => [...OwnershipMap.master.links.values()].find(l => l.source === byName(n) && l.target === co && l.type === type);
      const g = (n, type) => OwnershipMap.graph.links.find(l => OwnershipMap.linkEnds(l)[0] === byName(n) && OwnershipMap.linkEnds(l)[1] === co && l.type === type);
      const b = lk('Budi Santoso', 'directorship'), a = lk('Andi Wijaya', 'directorship'), s = lk('Siti Aminah', 'directorship');
      return { b: [b.start, b.end, b.seen, b.status || null], a: [a.start, a.end, a.seen, a.status], s: [s.start, s.seen],
        ga: g('Andi Wijaya', 'directorship').status, gb: g('Budi Santoso', 'directorship').status }; });
    eq(tl.b, ['2021-06', '2029-06', ['2021-06', '2026-09'], null], 'current director: term kept, start and document date seen, future end not seen');
    eq(tl.a, ['2016-03', '2021-06', ['2016-03', '2021-06'], 'previous'], 'former director: term dates seen, recorded as previous');
    eq(tl.s, ['2021', ['2021', '2026-09']], 'year-only start kept');
    eq([tl.ga, tl.gb], ['previous', 'recent'], 'map statuses follow the timeline');
    // the term shows in the relationship detail and can be edited there
    const aid = await p.evaluate(() => { const by = n => [...OwnershipMap.master.entities].find(([, e]) => e.name === n)[0];
      return [...OwnershipMap.master.links].find(([, l]) => l.source === by('Andi Wijaya') && l.target === by('PT Contoh Uji Indonesia'))[0]; });
    await p.evaluate(id => OwnershipMap.selectLink(id), aid); await sleep(600);
    ok(/Term\s*Mar 2016 – Jun 2021/.test(await p.textContent('#detailPanel')), 'term shown in the detail');
    await p.click('[data-act="link-edit"]'); await sleep(300);
    await p.fill('form[data-form="link-edit"] [name="end"]', '2015-01');
    await p.click('form[data-form="link-edit"] button[type="submit"]'); await sleep(300);
    ok(/ends before it starts/.test(await p.textContent('form[data-form="link-edit"] .form-msg')), 'end before start refused');
    await p.fill('form[data-form="link-edit"] [name="end"]', '2021-08');
    await p.click('form[data-form="link-edit"] button[type="submit"]'); await sleep(1200);
    const ed = await p.evaluate(id => { const l = OwnershipMap.master.links.get(id); return [l.end, l.seen]; }, aid);
    eq(ed, ['2021-08', ['2016-03', '2021-06', '2021-08']], 'edited end saved and seen');
    const prof = await p.evaluate(() => { const by = n => [...OwnershipMap.master.entities.values()].find(e => e.name === n) || {};
      return { c: by('PT Contoh Uji Indonesia'), h: by('PT Induk Uji'), b: by('Budi Santoso'), s: by('Siti Aminah') }; });
    eq([prof.c.country, prof.c.address], ['Indonesia', 'Jl. Sudirman No. 1, Jakarta Pusat'], 'company profile saved');
    eq((prof.c.identities || []).length, 2, 'company IDs saved');
    eq(prof.h.country, 'Singapore', 'shareholder country saved');
    eq([prof.b.country, prof.b.address], ['Indonesia', 'Jl. Melati 5, Bandung'], 'person profile saved');
    eq(prof.b.identities, [{ kind: 'KTP / NIK', number: '3273010101800001' }, { kind: 'NPWP (tax no.)', number: '09.876.543.2-101.000' }], 'IDs from both rows of one person merged');
    eq([prof.s.country, prof.s.identities], ['Malaysia', [{ kind: 'Passport no.', number: 'A1234567' }]], 'details typed in the review saved');
    eq(p.errors, [], 'page errors');
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
    ok(+flora[7] >= 2 && +flora[8] >= 2, 'shareholders and board counted: ' + flora.join(' | '));
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
  async 'labels: toolbar button and L cycle full, short, off; remembered'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    // Zoomed far out every label hides anyway, so look at one company's neighbourhood.
    const zoomIn = () => p.evaluate(() => { window.OwnershipMapTabs && window.OwnershipMapTabs.show('map');
      const id = [...OwnershipMap.master.entities].find(([, e]) => /Flora Nuansa Hijau/.test(e.name))[0]; OwnershipMap.focusOn(id, 1); });
    await zoomIn(); await sleep(2500);
    const labels = () => p.$$eval('g.edge-label text', ts => ts.map(t => t.textContent));
    const shown = () => p.$eval('g.edge-label', g => getComputedStyle(g).display !== 'none');
    ok(await shown(), 'labels visible in full');
    let t = await labels();
    ok(t.some(x => x.includes(' · ')), 'full labels carry dates');
    await p.click('#labelModeBtn'); await sleep(1500); t = await labels();
    ok(t.length && !t.some(x => x.includes(' · ')) && t.some(x => /%$/.test(x)), 'short labels: stake or role only');
    ok(/short/.test(await p.getAttribute('#labelModeBtn', 'title')), 'button says short');
    await p.click('#labelModeBtn'); await sleep(400);
    ok(!(await shown()), 'off hides relation labels');
    ok(await p.$eval('g.node .node-label, g.node text', el => getComputedStyle(el).display !== 'none'), 'entity names stay');
    await reload(p); await zoomIn(); await sleep(2500);
    ok(!(await shown()), 'off remembered after reload');
    await p.keyboard.press('l'); await sleep(1500); t = await labels();
    ok(await shown() && t.some(x => x.includes(' · ')), 'L goes back to full, with dates');
    await p.click('#dataToggle').catch(() => {});
    await p.focus('#dataInput'); await p.keyboard.press('l'); await sleep(300);
    ok(/full/.test(await p.getAttribute('#labelModeBtn', 'title')), 'typing L in a text box does not switch');
    eq(p.errors, [], 'page errors');
  },
  async 'map menu: right-click on empty space shows everything again'(){
    const gh = fakeGitHub(); const d = clone(SEED);
    Object.values(d.links).slice(0, 5).forEach(l => { l.groups = ['Other']; });   // a second group to filter on
    gh.set(d);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await p.evaluate(() => window.OwnershipMapTabs && window.OwnershipMapTabs.show('map')); await sleep(400);
    const shown = () => p.$$eval('g.node', gs => gs.length);
    const total = await shown();
    const emptySpot = () => p.evaluate(() => {             // a point of the map with no entity or line under it
      const r = document.getElementById('graph').getBoundingClientRect();
      for (let y = r.top + 120; y < r.bottom - 60; y += 23) for (let x = r.left + 40; x < r.right - 40; x += 23){
        const el = document.elementFromPoint(x, y);
        if (el && el.id === 'graph') return { x, y };
      }
      return null;
    });
    const rightClick = async () => { const pt = await emptySpot(); ok(pt, 'found empty map space'); await p.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(300); };
    // nothing hidden yet: the item is there but off
    await rightClick(); ok(await p.isVisible('#mapContextMenu'), 'menu opens on empty space');
    ok(await p.$eval('#mapContextMenu [data-action="show-everything"]', b => b.disabled), 'nothing to show yet');
    await p.keyboard.press('Escape'); ok(!(await p.isVisible('#mapContextMenu')), 'Escape closes it');
    // hide by focusing, and narrow with the Shareholding filter
    await p.evaluate(() => { const id = [...OwnershipMap.master.entities].find(([, e]) => /Flora Nuansa Hijau/.test(e.name))[0]; OwnershipMap.focusOn(id, 1); });
    await p.click('.view-bar [data-type="ownership"]'); await sleep(1500);
    ok((await shown()) < total, 'narrowed first');
    await rightClick(); await p.click('#mapContextMenu [data-action="show-everything"]'); await sleep(1500);
    eq(await shown(), total, 'every entity back');
    ok(await p.$eval('.view-bar [data-type="all"]', b => b.classList.contains('active')), 'Relationships back to All');
    eq(await p.isVisible('#hiddenBadge'), false, 'no hidden entities left');
    // a relation keeps the browser menu; an entity gets its own menu
    const edgePt = await p.evaluate(() => { const g = document.querySelector('g.edge path'); const b = g.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await p.evaluate(pt => { const el = document.querySelector('g.edge'); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y })); }, edgePt);
    await sleep(200); ok(!(await p.isVisible('#mapContextMenu')), 'no map menu on a relation');
    // group filter: the extra item shows and clears it
    await p.evaluate(() => { const box = [...document.querySelectorAll('.group-option input')].find(i => i.value === 'Other' || /Other/.test(i.closest('label').textContent)); box && box.click(); });
    await sleep(1500);
    ok((await shown()) < total, 'group filter narrows');
    await rightClick(); ok(await p.isVisible('#mapContextMenu [data-action="show-groups"]'), 'group item offered');
    await p.click('#mapContextMenu [data-action="show-groups"]'); await sleep(1800);
    eq(await shown(), total, 'all groups back');
    eq(p.errors, [], 'page errors');
  },
  async 'map: hover highlights neighbourhood; Timeline filter drops entities without relations'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await p.evaluate(() => window.OwnershipMapTabs && window.OwnershipMapTabs.show('map')); await sleep(500);
    const id = await p.evaluate(() => [...OwnershipMap.master.entities].find(([, e]) => /Flora Nuansa Hijau/.test(e.name))[0]);
    const expect = await p.evaluate(id => { const s = new Set([id]); OwnershipMap.graph.links.forEach(l => { const [a, b] = OwnershipMap.linkEnds(l); if (a === id) s.add(b); if (b === id) s.add(a); }); return s.size; }, id);
    const pt = await p.evaluate(id => { const g = d3.selectAll('g.node').filter(d => d.id === id).node(); const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
    await p.mouse.move(pt.x, pt.y); await sleep(500);
    const hl = await p.evaluate(() => ({ svg: document.getElementById('graph').classList.contains('hl'), lit: document.querySelectorAll('g.node.hl-on').length,
      dimmed: [...document.querySelectorAll('g.node:not(.hl-on)')].filter(g => parseFloat(getComputedStyle(g).opacity) < 0.3).length, total: document.querySelectorAll('g.node').length }));
    ok(hl.svg, 'highlight mode on'); eq(hl.lit, expect, 'entity + neighbours lit'); eq(hl.dimmed, hl.total - expect, 'everything else dimmed');
    await p.mouse.move(5, 5); await sleep(500);
    ok(!(await p.evaluate(() => document.getElementById('graph').classList.contains('hl'))), 'highlight clears when the pointer leaves');
    // Timeline filter now drops entities with no relation of that kind, like Shareholding does
    const prev = await p.evaluate(() => OwnershipMap.graph.links.filter(l => l.status === 'previous').length);
    await p.click('.filter-btn[data-filter="previous"]'); await sleep(2000);
    const shown = await p.evaluate(() => ({ nodes: document.querySelectorAll('g.node').length, edges: document.querySelectorAll('g.edge').length }));
    eq(shown.edges, prev, 'previous relations drawn');
    ok(shown.nodes <= prev * 2, 'no floating entities: ' + shown.nodes + ' entities for ' + prev + ' relations');
    await p.click('.filter-btn[data-filter="all"]'); await sleep(1500);
    eq(p.errors, [], 'page errors');
  },
  async 'select: shift-click, shift-drag box, focus, hide, assign group (saved)'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await p.evaluate(() => window.OwnershipMapTabs && window.OwnershipMapTabs.show('map')); await sleep(500);
    const ids = await p.evaluate(() => { const E = [...OwnershipMap.master.entities]; return ['Flora Nuansa Hijau', 'Inspired Medal', 'Olympia Medal'].map(n => E.find(([, e]) => e.name.includes(n))[0]); });
    const center = id => p.evaluate(id => { const g = d3.selectAll('g.node').filter(d => d.id === id).node(); const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
    // Shift+click two entities
    for (const id of ids.slice(0, 2)){ const c = await center(id); await p.keyboard.down('Shift'); await p.mouse.click(c.x, c.y); await p.keyboard.up('Shift'); }
    await sleep(400);
    ok(await p.isVisible('#selectionBar'), 'selection bar appears');
    eq(await p.$$eval('g.node.multi-sel', g => g.length), 2, 'two selected');
    ok(!(await p.isVisible('#detailPanel')), 'shift-click does not open the detail');
    ok(await p.isVisible('#selectionBar [data-sel="connect"]'), 'Find connection offered for exactly two');
    // Shift+drag box around a third entity adds it
    const c3 = await center(ids[2]);
    await p.keyboard.down('Shift'); await p.mouse.move(c3.x - 25, c3.y - 25); await p.mouse.down(); await p.mouse.move(c3.x + 25, c3.y + 25, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Shift'); await sleep(400);
    ok(await p.$$eval('g.node.multi-sel', g => g.length) >= 3, 'box adds entities');
    // Assign a group: every relationship of the selected entities gets it, and it is saved
    await p.click('#selectionBar [data-sel="group"]'); await p.fill('#selectionBar input[name="group"]', 'Test Group'); await p.click('#selectionBar .sel-assign .btn'); await sleep(1500);
    const sel = new Set(ids);
    const res = await p.evaluate(selIds => { const sel = new Set(selIds); const L = [...OwnershipMap.master.links.values()]; const mine = L.filter(l => sel.has(l.source) || sel.has(l.target)); return { mine: mine.length, tagged: mine.filter(l => (l.groups || []).includes('Test Group')).length, others: L.filter(l => !(sel.has(l.source) || sel.has(l.target)) && (l.groups || []).includes('Test Group')).length }; }, [...sel]);
    ok(res.mine > 0 && res.tagged === res.mine && res.others === 0, 'group added to exactly the selected entities\' relationships ' + JSON.stringify(res));
    ok(/Added to Test Group/.test(await p.textContent('#selectionBar .sel-msg')), 'confirmation shown');
    // Focus the selection, then Esc clears the selection
    await p.click('#selectionBar [data-sel="focus"]'); await sleep(1500);
    ok(await p.$$eval('g.node', g => g.length) <= 3, 'focus keeps only the selected entities');
    await p.click('#showHiddenBtn'); await sleep(1500);
    await p.keyboard.press('Escape'); await sleep(300);
    ok(!(await p.isVisible('#selectionBar')), 'Esc clears the selection');
    // Hide
    const c = await center(ids[0]); await p.keyboard.down('Shift'); await p.mouse.click(c.x, c.y); await p.keyboard.up('Shift'); await sleep(300);
    const before = await p.$$eval('g.node', g => g.length); await p.click('#selectionBar [data-sel="hide"]'); await sleep(1500);
    eq(await p.$$eval('g.node', g => g.length), before - 1, 'hide removes the selected entity');
    eq(p.errors, [], 'page errors');
  },
  async 'status chip: not connected, saved, unsaved, offline, click to connect'(){
    const gh = fakeGitHub(); gh.set(SEED);
    let answer = '';
    const { ctx } = await context({ gh }); const p = await open(ctx, d => d.accept(answer));
    const chip = async () => (await p.textContent('#saveChip .save-text')).trim();
    ok(await p.isVisible('#saveChip'), 'chip is in the top capsule');
    ok(/Not connected/.test(await chip()), 'not connected: ' + await chip());
    answer = 'github_pat_GOOD000000000000000000000000';
    await p.click('#saveChip'); await sleep(1200);                    // click connects
    ok(/Saved|Connected/.test(await chip()), 'connected: ' + await chip());
    await addEntity(p, 'e-chip'); await sleep(400);
    ok(/Unsaved/.test(await chip()), 'unsaved after an edit: ' + await chip());
    await p.click('#saveChip'); await sleep(1200);                    // click saves now
    ok(/Saved/.test(await chip()) && gh.data().entities['e-chip'], 'saved after clicking: ' + await chip());
    await ctx.unroute(GH + '**'); await ctx.route(GH + '**', r => r.abort('connectionfailed'));
    await addEntity(p, 'e-chip2'); await p.click('#saveChip'); await sleep(1500);
    ok(/Offline/.test(await chip()), 'offline when GitHub is unreachable: ' + await chip());
    ok(await p.$eval('#saveChip', c => c.classList.contains('is-warn')), 'warning colour');
    eq(p.errors, [], 'page errors');
  },
  async 'connect: finds shortest chains, writes them out, indirect stake, show on map'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await p.evaluate(() => window.OwnershipMapTabs && window.OwnershipMapTabs.show('map')); await sleep(500);
    // Expected answers computed independently, straight from the seed file.
    const L = Object.values(SEED.links), name = id => SEED.entities[id].name;
    const adj = new Map(); L.forEach(l => { [[l.source, l.target], [l.target, l.source]].forEach(([a, b]) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); }); });
    const bfs = (a, b) => { const d = new Map([[a, 0]]), q = [a], ways = new Map([[a, 1]]); while (q.length){ const x = q.shift(); for (const y of adj.get(x) || []){ if (!d.has(y)){ d.set(y, d.get(x) + 1); ways.set(y, ways.get(x)); q.push(y); } else if (d.get(y) === d.get(x) + 1) ways.set(y, ways.get(y) + ways.get(x)); } } return d.has(b) ? { len: d.get(b), ways: ways.get(b) } : null; };
    // a pair at distance 3 or more, and one pure two-step ownership chain with known stakes
    const ids = Object.keys(SEED.entities); let far = null;
    for (const a of ids.slice(0, 60)){ for (const b of ids){ const r = bfs(a, b); if (r && r.len >= 3){ far = { a, b, r }; break; } } if (far) break; }
    ok(far, 'test data has a distant pair');
    const own = L.filter(l => l.type === 'ownership' && typeof l.value === 'number');
    let chain = null; for (const l1 of own){ const l2 = own.find(x => x.target === l1.source && x.source !== l1.target); if (l2){ chain = { top: l2.source, mid: l1.source, bottom: l1.target, v: l2.value * l1.value / 100 }; break; } }
    ok(chain, 'test data has a two-step ownership chain');
    // open from the toolbar button and search by typing names
    await p.click('#connectBtn'); ok(await p.isVisible('#connectPanel'), 'panel opens from the toolbar');
    await p.fill('#cnFrom', name(far.a)); await p.fill('#cnTo', name(far.b)); await p.click('#cnForm .btn'); await sleep(500);
    const sum = (await p.textContent('.cn-summary')).replace(/\s+/g, ' ');
    ok(new RegExp('^' + far.r.ways + ' shortest connection').test(sum.trim()) || far.r.ways > 8, 'number of shortest chains: ' + sum + ' (expected ' + far.r.ways + ')');
    ok(sum.includes(far.r.len + ' step'), 'steps: ' + sum + ' (expected ' + far.r.len + ')');
    eq(await p.$$eval('div.cn-path:first-of-type li', li => li.length), far.r.len, 'one written line per step');
    // indirect stake equals the product computed here
    await p.fill('#cnFrom', name(chain.top)); await p.fill('#cnTo', name(chain.bottom)); await p.click('#cnForm .btn'); await sleep(500);
    const ind = await p.textContent('.cn-ind');
    const shown = parseFloat((ind.match(/about\s+([\d.]+)%/) || [])[1]);
    ok(Math.abs(shown - chain.v) < 0.01, 'indirect stake ' + shown + '% vs ' + chain.v + '%');
    // show only this chain on the map
    await p.click('div.cn-path:first-of-type [data-cn="only"]'); await sleep(1500);
    eq(await p.$$eval('g.node', g => g.length), 3, 'map shows only the three entities of the chain');
    await p.click('#showHiddenBtn'); await sleep(1200);
    // light it up in context: the rest dims
    await p.click('div.cn-path:first-of-type [data-cn="light"]'); await sleep(1500);
    ok(await p.evaluate(() => document.getElementById('graph').classList.contains('hl') && document.querySelectorAll('g.node.hl-on').length === 3), 'chain lit, rest dimmed');
    // unknown name and same entity
    await p.fill('#cnFrom', 'Nama yang tidak ada'); await p.click('#cnForm .btn'); await sleep(300);
    ok(/No entity called/.test(await p.textContent('.cn-none')), 'unknown name explained');
    // opened from the selection bar with exactly two entities selected
    await p.click('[data-cn="close"]'); await sleep(200);
    ok(!(await p.evaluate(() => document.getElementById('graph').classList.contains('hl'))), 'closing clears the highlight');
    await p.evaluate(a => window.OwnershipMapHL.select(a), [chain.top, chain.bottom]); await sleep(400);
    await p.click('#selectionBar [data-sel="connect"]'); await sleep(600);
    ok(await p.isVisible('#connectPanel') && (await p.inputValue('#cnFrom')) === name(chain.top), 'selection bar opens it with both names filled');
    // Regression: switching to another tab while the panel is open once froze the page (an observer re-triggering itself)
    await p.click('[data-tab="table"]'); await sleep(600);
    ok(await p.evaluate(() => 1 + 1) === 2, 'page still responds after opening the Table tab');
    ok(!(await p.isVisible('#connectPanel')), 'the panel closes in the Table tab');
    await p.click('[data-tab="map"]'); await sleep(500);
    ok(!(await p.isVisible('#connectPanel')) && !(await p.evaluate(() => document.getElementById('map').classList.contains('cn-open'))), 'and stays closed on the map');
    eq(p.errors, [], 'page errors');
  },
  async 'detail: focus buttons, open in table, note moved up and still saves'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await p.evaluate(() => window.OwnershipMapTabs && window.OwnershipMapTabs.show('map')); await sleep(500);
    const id = await p.evaluate(() => [...OwnershipMap.master.entities].find(([, e]) => /Flora Nuansa Hijau/.test(e.name))[0]);
    const expect = await p.evaluate(id => { const nb = x => { const s = new Set(); OwnershipMap.graph.links.forEach(l => { const [a, b] = OwnershipMap.linkEnds(l); if (a === x) s.add(b); if (b === x) s.add(a); }); return s; };
      const one = new Set([id, ...nb(id)]), all = new Set([id]); let q = [id]; while (q.length){ const n = []; q.forEach(x => nb(x).forEach(y => { if (!all.has(y)){ all.add(y); n.push(y); } })); q = n; } return { one: one.size, all: all.size, total: OwnershipMap.graph.nodes.length }; }, id);
    await p.evaluate(id => OwnershipMap.selectNode(id), id); await sleep(700);
    ok(await p.isVisible('.rk-detail-tools'), 'tools row is in the detail panel');
    // the Note block now comes right after the tools, before "Owned by"
    const order = await p.$$eval('#detailPanel h4', hs => hs.map(h => h.textContent.trim()));
    ok(order.indexOf('Note') < order.indexOf('Owned by') || order.indexOf('Owned by') < 0 || order.indexOf('Note') === 0, 'Note comes first: ' + order.join(' | '));
    ok((await p.evaluate(() => document.querySelector('.rk-detail-tools').nextElementSibling.querySelector('h4').textContent.trim())) === 'Note', 'Note block sits under the tools');
    const shown = () => p.$$eval('g.node', g => g.length);
    await p.click('[data-rk="focus0"]'); await sleep(1500); eq(await shown(), 1, 'only this');
    await p.click('#showHiddenBtn'); await sleep(1200); await p.evaluate(id => OwnershipMap.selectNode(id), id); await sleep(500);
    await p.click('[data-rk="focus1"]'); await sleep(1500); eq(await shown(), expect.one, 'with relations');
    await p.click('#showHiddenBtn'); await sleep(1200); await p.evaluate(id => OwnershipMap.selectNode(id), id); await sleep(500);
    await p.click('[data-rk="focusAll"]'); await sleep(1500); eq(await shown(), expect.all, 'whole network');
    await p.click('#showHiddenBtn'); await sleep(1200);
    // the moved note still saves
    await p.evaluate(id => OwnershipMap.selectNode(id), id); await sleep(500);
    await p.fill('#entityNote', 'catatan uji'); await p.click('[data-act="note-save"]'); await sleep(1200);
    eq(await p.evaluate(id => OwnershipMap.master.entities.get(id).note, id), 'catatan uji', 'note saved after being moved');
    // open in table: table tab, filtered to this entity
    await p.evaluate(id => OwnershipMap.selectNode(id), id); await sleep(500);
    await p.click('[data-rk="table"]'); await sleep(900);
    ok(await p.isVisible('#tableView'), 'table tab opens');
    eq(await p.inputValue('#tvSearch'), 'PT Flora Nuansa Hijau', 'search prefilled');
    eq(await p.$$eval('#tvTable tbody tr[data-i]', r => r.length), 1, 'one row');
    eq(p.errors, [], 'page errors');
  },
  async 'as-of: slider shows the structure in force in a month; Now restores; Data quality leaves the past'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await p.evaluate(() => window.OwnershipMapTabs && window.OwnershipMapTabs.show('map')); await sleep(500);
    const L = Object.values(SEED.links);
    const undated = L.filter(l => !(l.seen || []).length).length;
    const drawn = () => p.evaluate(() => ({ nodes: document.querySelectorAll('g.node').length, edges: document.querySelectorAll('g.edge').length }));
    eq((await drawn()).edges, 235, 'all relationships before using the slider');
    await p.click('#asofBtn'); ok(await p.isVisible('#asofBar'), 'bar opens from the toolbar');
    const lim = await p.evaluate(() => ({ min: +document.getElementById('asofRange').min, max: +document.getElementById('asofRange').max }));
    ok(lim.min < lim.max, 'range from the earliest date to now');
    const setKey = async (k, undatedOn) => { await p.evaluate(([k, u]) => { const r = document.getElementById('asofRange'); const c = document.getElementById('asofUndated'); c.checked = u; r.value = k; r.dispatchEvent(new Event('change', { bubbles: true })); }, [k, undatedOn]); await sleep(2200); };
    // before every recorded date: only undated relationships remain (or none when they are left out)
    await setKey(lim.min, true); const early = await drawn(); eq(early.edges >= undated, true, 'before the first date at least the undated ones remain');
    await setKey(lim.min, false); let e2 = await drawn(); ok(e2.edges <= early.edges, 'leaving undated out never adds relationships');
    // a month in the middle: compare with the rule applied independently to the seed dates
    const mid = Math.round((lim.min + lim.max) / 2);
    await setKey(mid, true);
    const expected = await p.evaluate(mid => { const g = OwnershipMap.fullGraph(); return g.links.filter(l => { if (!l.seen.length) return true; const f = OwnershipMap.dateSortKey(l.seen[0]), z = OwnershipMap.dateSortKey(l.seen[l.seen.length - 1]); return mid >= f && (l.status === 'previous' ? mid <= z : true); }).length; }, mid);
    const midDrawn = await drawn(); eq(midDrawn.edges, expected, 'relationships in force at the middle month');
    ok(midDrawn.nodes <= midDrawn.edges * 2 && midDrawn.nodes > 0, 'only entities that have a relationship then: ' + midDrawn.nodes);
    ok(/as of|Structure as of/i.test(await p.textContent('#asofBar')) && !/now/i.test(await p.textContent('#asofLabel')), 'label shows the month: ' + await p.textContent('#asofLabel'));
    // the Table follows, and says so
    await p.click('[data-tab="table"]'); await sleep(600);
    ok(/as of/.test(await p.textContent('#tvCount')), 'table count says as of: ' + await p.textContent('#tvCount'));
    // Data quality judges the present
    await p.click('[data-tab="quality"]'); await sleep(900);
    eq(await p.evaluate(() => OwnershipMap.getAsOf().key), null, 'Data quality leaves the past');
    await p.click('[data-tab="map"]'); await sleep(1500);
    eq((await drawn()).edges, 235, 'back to every relationship');
    // Now button, after going back in time
    await p.click('#asofBtn'); await sleep(300); await setKey(mid, true);
    await p.click('[data-asof="now"]'); await sleep(2000);
    eq((await drawn()).edges, 235, 'Now restores everything');
    eq(p.errors, [], 'page errors');
  },
  async 'report: content matches the detail panel, opens from the detail, prints to PDF'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await p.evaluate(() => window.OwnershipMapTabs && window.OwnershipMapTabs.show('map')); await sleep(500);
    const id = await p.evaluate(() => [...OwnershipMap.master.entities].find(([, e]) => /Flora Nuansa Hijau/.test(e.name))[0]);
    await p.evaluate(id => OwnershipMap.selectNode(id), id); await sleep(800);
    // The app's own indirect-owner list (original code) is the reference for the new calculation.
    const panel = await p.evaluate(() => { const h = [...document.querySelectorAll('#detailPanel h4')].find(x => /Indirectly owned/.test(x.textContent)); if (!h) return []; const ul = h.nextElementSibling;
      return [...ul.querySelectorAll('li')].map(li => ({ name: (li.querySelector('.detail-link, button') || li.querySelector('span')).textContent.trim(), pct: parseFloat(li.querySelector('b').textContent) })); });
    ok(panel.length > 0, 'detail panel lists indirect owners for the reference');
    ok(await p.isVisible('[data-rk="report"]'), 'Company report button in the detail panel');
    await p.click('[data-rk="report"]'); await sleep(700);
    ok(await p.isVisible('#reportOverlay'), 'report opens');
    const rep = await p.evaluate(() => { const t = [...document.querySelectorAll('#reportSheet h2')].find(h => /Who holds it/.test(h.textContent)).parentElement;
      return { rows: [...t.querySelectorAll('tbody tr')].map(r => ({ name: r.cells[0].textContent.trim(), pct: parseFloat(r.cells[2].textContent), note: r.cells[3].textContent })), title: document.querySelector('#reportSheet h1').textContent.trim(),
        sh: [...document.querySelectorAll('#reportSheet h2')].find(h => /^Shareholders/.test(h.textContent)).parentElement.querySelectorAll('tbody tr').length,
        board: [...document.querySelectorAll('#reportSheet h2')].find(h => /^Directors/.test(h.textContent)).parentElement.querySelectorAll('tbody tr').length }; });
    eq(rep.title, 'PT Flora Nuansa Hijau', 'report title');
    for (const x of panel){ const r = rep.rows.find(r => r.name === x.name); ok(r && Math.abs(r.pct - x.pct) < 0.51, 'indirect owner ' + x.name + ' ' + x.pct + '% appears in the report as ' + (r && r.pct)); }
    const direct = SEED.links ? Object.values(SEED.links).filter(l => l.type === 'ownership' && SEED.entities[l.target].name.includes('Flora Nuansa')).length : 0;
    ok(rep.sh >= 1 && rep.sh <= direct + 1, 'shareholder rows ' + rep.sh);
    const boardSeed = Object.values(SEED.links).filter(l => l.type === 'directorship' && SEED.entities[l.target].name.includes('Flora Nuansa')).length;
    eq(rep.board, boardSeed, 'board rows match the seed');
    // Print: only the report is laid out, and the PDF has the company name and few pages
    await p.emulateMedia({ media: 'print' }); await sleep(300);
    const hidden = await p.evaluate(() => ({ sidebar: getComputedStyle(document.querySelector('.app')).display, bar: getComputedStyle(document.querySelector('.report-bar')).display, sheet: getComputedStyle(document.getElementById('reportSheet')).display }));
    eq(hidden.sidebar, 'none', 'the app (sidebar and map) is not printed'); eq(hidden.bar, 'none', 'report toolbar not printed'); ok(hidden.sheet !== 'none', 'report printed');
    const pdf = await p.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    const file = path.join(require('os').tmpdir(), 'om-report-' + Date.now() + '.pdf'); fs.writeFileSync(file, pdf);
    const text = execSync('pdftotext -layout "' + file + '" -').toString();
    const lower = text.toLowerCase();
    ok(text.includes('PT Flora Nuansa Hijau') && lower.includes('shareholders') && lower.includes('sources') && lower.includes('points to check'), 'PDF text has the title and sections');
    ok(!text.includes('Commodity clusters') && !text.includes('Right-click an entity') && !text.includes('Legend'), 'PDF holds only the report, none of the app');
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    ok(pages >= 1 && pages <= 2, 'PDF pages: ' + pages);
    await p.emulateMedia({ media: 'screen' });
    await p.keyboard.press('Escape'); await sleep(300); ok(!(await p.isVisible('#reportOverlay')), 'Esc closes the report');
    // a person has no company report button
    const pid = await p.evaluate(() => [...OwnershipMap.master.entities].find(([, e]) => e.type === 'person')[0]);
    await p.evaluate(id => OwnershipMap.selectNode(id), pid); await sleep(700);
    ok(!(await p.isVisible('[data-rk="report"]')), 'no report button for an individual');
    eq(p.errors, [], 'page errors');
  },
  async 'profile: country, address and identity numbers save, show in table, CSV, search, report, merge'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await p.evaluate(() => window.OwnershipMapTabs && window.OwnershipMapTabs.show('map')); await sleep(500);
    const id = await p.evaluate(() => [...OwnershipMap.master.entities].find(([, e]) => /Flora Nuansa Hijau/.test(e.name))[0]);
    await p.evaluate(id => OwnershipMap.selectNode(id), id); await sleep(800);
    ok(await p.isVisible('.rk-profile'), 'Profile block in the detail panel');
    eq(await p.evaluate(() => document.querySelector('.rk-profile').previousElementSibling.querySelector('h4').textContent.trim()), 'Note', 'Profile sits right after Note');
    await p.fill('.rk-profile [name=country]', 'Indonesia');
    await p.fill('.rk-profile [name=address]', 'Jl. Sudirman 1, Jakarta');
    await p.click('[data-rkp=save]'); await sleep(900);
    await p.selectOption('.rk-profile [name=kind]', 'NIB'); await p.fill('.rk-profile [name=number]', '8120000123456');
    await p.click('[data-rkp=add]'); await sleep(900);
    const e = await p.evaluate(id => OwnershipMap.master.entities.get(id), id);
    eq([e.country, e.address], ['Indonesia', 'Jl. Sudirman 1, Jakarta'], 'country and address stored');
    eq(e.identities, [{ kind: 'NIB', number: '8120000123456' }], 'identity stored');
    ok((await p.textContent('.rk-ids')).includes('8120000123456'), 'identity listed after saving');
    // table column + text filter
    await p.evaluate(() => window.OwnershipMapTabs.show('table')); await sleep(600);
    await p.fill('#tvSearch', '8120000123456'); await sleep(500);
    const rows = await p.$$eval('#tvTable tbody tr', r => r.map(x => x.textContent));
    eq(rows.length, 1, 'filter by identity number finds one row'); ok(rows[0].includes('Indonesia') && rows[0].includes('Jakarta'), 'row shows country and address');
    await p.fill('#tvSearch', ''); await p.evaluate(() => window.OwnershipMapTabs.show('map')); await sleep(400);
    // map search finds it by number
    await p.fill('#searchInput', '8120000123456'); await sleep(600);
    ok((await p.$$eval('g.node.match', g => g.length)) === 1, 'map search matches the identity number');
    await p.fill('#searchInput', '');
    // report
    await p.evaluate(id => OwnershipMapReport.open(id), id); await sleep(600);
    const rep = await p.textContent('#reportSheet'); ok(rep.includes('Jurisdiction') && rep.includes('8120000123456') && rep.includes('Jakarta'), 'report shows the profile');
    await p.keyboard.press('Escape'); await sleep(300);
    // removal
    await p.evaluate(id => OwnershipMap.selectNode(id), id); await sleep(700);
    await p.click('[data-rkp=del]'); await sleep(900);
    eq(await p.evaluate(id => (OwnershipMap.master.entities.get(id).identities || []).length, id), 0, 'identity removed');
    // merge carries the fields over when the target has none
    const other = await p.evaluate(id => [...OwnershipMap.master.entities].find(([k, v]) => k !== id && v.type === 'person')[0], id);
    await p.evaluate(([a, b]) => OwnershipMap.mergeEntities(a, b), [id, other]); await sleep(1500);
    const m = await p.evaluate(o => OwnershipMap.master.entities.get(o), other);
    eq([m.country, m.address], ['Indonesia', 'Jl. Sudirman 1, Jakarta'], 'merge keeps country and address');
    eq(p.errors, [], 'page errors');
  },
  async 'fold: sidebar panels fold by heading, remembered, status chip reopens Dataset'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    const vis = sel => p.isVisible(sel);
    ok(await vis('#exportPanel .export-row'), 'Export content visible at first');
    const h0 = await p.evaluate(() => document.getElementById('searchPanel').offsetHeight);
    await p.click('#exportHeading'); await sleep(200);
    ok(!(await vis('#exportPanel .export-row')) && await vis('#exportHeading'), 'folded: content hidden, heading stays');
    eq(await p.getAttribute('#exportHeading', 'aria-expanded'), 'false', 'aria-expanded false');
    await p.focus('#searchHeading'); await p.keyboard.press('Enter'); await sleep(200);
    ok(!(await vis('#searchInput')), 'Enter folds the Search panel');
    ok(await p.evaluate(h => document.getElementById('searchPanel').offsetHeight < h, h0), 'a folded panel takes less room');
    // Data panel keeps its own header (with the Add data button) usable
    await p.click('#dataHeading'); await sleep(200);
    ok(!(await vis('#dataBody')), 'Data panel folds');
    // remembered after reload
    await reload(p); await sleep(2000);
    ok(!(await vis('#exportPanel .export-row')) && !(await vis('#searchInput')), 'folded state remembered');
    await p.click('#exportHeading'); await sleep(200);
    ok(await vis('#exportPanel .export-row'), 'unfolds again');
    // status chip opens a folded Dataset panel
    await p.click('#datasetHeading'); await sleep(200);
    ok(!(await vis('#ghBlock')), 'Dataset folded');
    await p.evaluate(() => OwnershipMapFold.open('datasetPanel')); await sleep(200);
    ok(await p.evaluate(() => !OwnershipMapFold.isFolded('datasetPanel')), 'API opens a panel');
    eq(p.errors, [], 'page errors');
  },
  async 'stats: aggregate figures match the data, follow filters, names open detail, CSV'(){
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await p.evaluate(() => window.OwnershipMapTabs.show('stats')); await sleep(800);
    ok(await p.isVisible('#statsView') && !(await p.isVisible('.map-legend')), 'Statistics tab shown, map chrome hidden');
    if (process.env.SHOT){ const vs = p.viewportSize(); await p.setViewportSize({ width: 1440, height: +(process.env.SHOTH || 2600) }); await sleep(800); await p.screenshot({ path: process.env.SHOT }); await p.setViewportSize(vs); await sleep(400); }
    // ground truth from the graph itself
    const truth = await p.evaluate(() => { const g = OwnershipMap.graph, L = g.links.filter(OwnershipMap.linkPassesFilter);
      const comps = g.nodes.filter(n => n.type === 'company').length;
      const maxHolder = new Map(); L.forEach(l => { if (l.type !== 'ownership' || l.status === 'previous') return; const t = OwnershipMap.linkEnds(l)[1]; const v = typeof l.value === 'number' ? l.value : -1; maxHolder.set(t, Math.max(maxHolder.get(t) ?? -2, v)); });
      let over50 = 0; g.nodes.forEach(n => { if (n.type === 'company' && (maxHolder.get(n.id) ?? -2) > 50) over50++; });
      const kal = new Set(); L.forEach(l => { if ((OwnershipMap.master.links.get(l.id).groups || []).includes('Kaltim')) OwnershipMap.linkEnds(l).forEach(x => kal.add(x)); });
      return { n: g.nodes.length, comps, people: g.nodes.length - comps, links: L.length, own: L.filter(l => l.type === 'ownership').length, over50, kal: kal.size, bo: OwnershipMap.ownershipFlags().bo.size }; });
    const kpis = await p.$$eval('.st-card:first-child .st-kpi', k => Object.fromEntries(k.map(x => [x.querySelector('span').textContent, +x.querySelector('b').textContent])));
    eq(kpis.companies, truth.comps, 'companies'); eq(kpis.individuals, truth.people, 'individuals');
    eq(kpis.shareholdings, truth.own, 'shareholdings'); eq(kpis['board roles'], truth.links - truth.own, 'board roles');
    eq(kpis['beneficial owners (over 25%)'], truth.bo, 'beneficial owners');
    ok((await p.textContent('#stScope')).includes(truth.n + ' entities') && (await p.textContent('#stScope')).includes(truth.links + ' relationships'), 'scope line');
    // concentration buckets add up to the companies and "Over 50% to 75%" + "Over 75%" matches
    const conc = await p.evaluate(() => { const c = [...document.querySelectorAll('.st-card')].find(x => x.querySelector('h3').textContent === 'Ownership concentration');
      return [...c.querySelectorAll('.st-tablev tbody tr')].map(tr => ({ l: tr.cells[0].textContent, v: +tr.cells[1].textContent })); });
    eq(await p.$$eval('[data-card="concentration"] .st-c-col', c => c.length), 6, 'six concentration columns');
    // chart / table switch, tooltip on hover
    await p.click('[data-tv="coverage"]'); await sleep(200);
    ok(await p.isVisible('[data-card="coverage"] .st-tablev') && !(await p.isVisible('[data-card="coverage"] .st-chart')), 'Table button shows the table twin');
    await p.click('[data-tv="coverage"]'); await sleep(200);
    await p.hover('[data-card="concentration"] .st-c-col:last-child'); await sleep(200);
    ok(await p.isVisible('.st-tip') && /Over 75%/.test(await p.textContent('.st-tip')), 'tooltip shows on a column');
    eq(conc.reduce((a, b) => a + b.v, 0), truth.comps, 'buckets cover every company');
    eq(conc.filter(x => /50% to 75|Over 75/.test(x.l)).reduce((a, b) => a + b.v, 0), truth.over50, 'companies with a holder over 50%');
    // group table
    const kal = await p.evaluate(() => { const r = [...document.querySelectorAll('.st-table tbody tr')].find(tr => tr.cells[0].textContent === 'Kaltim'); return r && +r.cells[1].textContent; });
    eq(kal, truth.kal, 'Kaltim group size');
    // a name opens the detail panel
    const first = await p.$eval('.st-ent', b => b.dataset.ent);
    await p.click('.st-ent'); await sleep(600);
    ok(await p.isVisible('#detailPanel'), 'name opens detail'); eq(await p.evaluate(() => OwnershipMap.selectedEntityId()), first, 'the right entity');
    // filters apply: Previous timeline shrinks the figures
    await p.evaluate(() => window.OwnershipMapTabs.show('map')); await sleep(300);
    const before = await p.evaluate(() => OwnershipMap.graph.links.filter(OwnershipMap.linkPassesFilter).length);
    await p.click('.filter-btn[data-filter="previous"]'); await sleep(1500);
    await p.evaluate(() => window.OwnershipMapTabs.show('stats')); await sleep(600);
    const after = await p.evaluate(() => OwnershipMap.graph.links.filter(OwnershipMap.linkPassesFilter).length);
    ok(after < before, 'Previous filter narrows the data: ' + before + ' -> ' + after);
    ok((await p.textContent('#stScope')).includes(after + ' relationships'), 'scope follows the Timeline filter: ' + after);
    // CSV
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#stExport')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok(csv.includes('section,label,value') && csv.includes('Overview,companies,') && csv.includes('Data coverage,'), 'CSV has the sections');
    eq(p.errors, [], 'page errors');
  },
  async 'shots: layout screenshots of forms and tables (only with SHOTDIR)'(){
    const dir = process.env.SHOTDIR; if (!dir) return;
    const gh = fakeGitHub(); gh.set(SEED);
    const { ctx } = await context({ gh }); const p = await open(ctx);
    await p.setViewportSize({ width: 1440, height: 900 }); await sleep(600);
    const shot = async (name, el) => { if (el){ const h = await p.$(el); if (h) return h.screenshot({ path: path.join(dir, name + '.png') }); } return p.screenshot({ path: path.join(dir, name + '.png') }); };
    await p.evaluate(() => window.OwnershipMapTabs.show('map')); await sleep(500);
    await p.click('#dataToggle').catch(() => {}); await sleep(300);
    await shot('sidebar-data', '#inputPanel');
    await shot('sidebar-dataset', '#datasetPanel');
    await shot('sidebar-groups', '#groupsPanel');
    const id = await p.evaluate(() => [...OwnershipMap.master.entities].find(([, e]) => /Flora Nuansa Hijau/.test(e.name))[0]);
    await p.evaluate(id => OwnershipMap.selectNode(id), id); await sleep(800);
    await p.setViewportSize({ width: 1440, height: 2400 }); await sleep(500);
    await shot('detail-entity', '#detailPanel');
    await p.setViewportSize({ width: 1440, height: 900 }); await sleep(300);
    await p.click('[data-act="edit-name"]').catch(() => {}); await sleep(400);
    await shot('detail-edit', '#detailPanel');
    const lid = await p.evaluate(() => [...OwnershipMap.master.links.keys()][0]);
    await p.evaluate(l => OwnershipMap.selectLink(l), lid); await sleep(600);
    await shot('detail-link', '#detailPanel');
    await p.evaluate(() => window.OwnershipMapTabs.show('table')); await sleep(600); await shot('tab-table');
    await p.click('#tableView [data-kind="links"]'); await sleep(400); await shot('tab-table-links');
    await p.evaluate(() => window.OwnershipMapTabs.show('quality')); await sleep(900); await shot('tab-quality');
    await p.evaluate(() => window.OwnershipMapTabs.show('map')); await sleep(500);
    await p.click('#connectBtn').catch(() => {}); await sleep(400); await shot('connect');
    await p.keyboard.press('Escape'); await p.click('#asofBtn').catch(() => {}); await sleep(400); await shot('asof');
  },
  async 'pdf: full profile with several deeds becomes a timeline per stake and role'(){
    const gh = fakeGitHub(); gh.set(SEED); const ds = [];
    ds.answer = { company: 'PT Kronologi Uji', document: 'Profil Perusahaan Lengkap (AHU)', document_date: '2024-02', company_profile: { country: 'Indonesia', address: null, ids: [] },
      shareholders: [{ name: 'PT Induk Kronologi', kind: 'company', ids: [{ kind: 'NPWP', number: '01.111.111.1-111.000' }] }, { name: 'Bambang Uji', kind: 'person' }],
      board: [{ name: 'Bambang Uji', role: 'Direktur' }, { name: 'Citra Uji', role: 'Komisaris', until: '2027-01' }, { name: 'Dodi Uji', role: 'Direktur Utama' }],
      deeds: [
        { number: '1', date: '2010-05-03', notary: 'Ani, S.H.', kind: 'Akta Pendirian', shareholders: [{ name: 'PT Induk Kronologi', percent: 60 }, { name: 'Bambang Uji', percent: 40 }], board: [{ name: 'Bambang Uji', role: 'Direktur' }, { name: 'Citra Uji', role: 'Komisaris' }] },
        { number: '20', date: '2020-11-09', notary: 'Ani, S.H.', kind: 'Jual Beli Saham', shareholders: [{ name: 'PT Induk Kronologi', percent: 100 }], board: null },
        { number: '7', date: '2015-08-21', notary: 'Ani, S.H.', kind: 'Perubahan Direksi', shareholders: null, board: [{ name: 'DODI UJI', role: 'Direktur Utama' }, { name: 'Citra Uji', role: 'Komisaris' }] } ],
      warnings: [] };
    const { ctx } = await context({ gh, ds });
    const maker = await ctx.newPage();
    await maker.setContent('<h1>Profil Perusahaan Lengkap</h1><p>' + 'PT Kronologi Uji. Akta pendirian, perubahan direksi, jual beli saham. '.repeat(12) + '</p>');
    const pdf = path.join(require('os').tmpdir(), 'om-test-deeds-' + Date.now() + '.pdf'); await maker.pdf({ path: pdf }); await maker.close();
    const p = await open(ctx, d => d.accept('sk-test-key'));
    await p.setInputFiles('#pdfInput', pdf);
    await p.waitForFunction(() => /Chronology from 3 deeds/.test((document.querySelector('.review-sheet') || {}).innerText || ''), null, { timeout: 40000 });
    ok(/"deeds"/.test(ds[0].body.messages[1].content) && /complete composition in force right after that deed/.test(ds[0].body.messages[1].content), 'prompt asks for every deed');
    eq(ds[0].body.max_tokens, 8192, 'room for a long answer');
    const rows = await p.$$eval('tr[data-k]:not(.rv-sub)', trs => trs.map(tr => [tr.dataset.k, tr.querySelector('[data-f="name"]').value,
      (tr.querySelector('[data-f="percent"]') || tr.querySelector('[data-f="role"]')).value, tr.querySelector('[data-f="since"]').value, tr.querySelector('[data-f="until"]').value, tr.querySelector('[data-f="state"]').value]));
    eq(rows, [
      ['sh', 'PT Induk Kronologi', '100', '2020-11', '', 'current'],
      ['sh', 'PT Induk Kronologi', '60', '2010-05', '2020-11', 'former'],
      ['sh', 'Bambang Uji', '40', '2010-05', '2020-11', 'former'],
      ['bd', 'Citra Uji', 'Komisaris', '2010-05', '2027-01', 'current'],
      ['bd', 'Dodi Uji', 'Direktur Utama', '2015-08', '', 'current'],
      ['bd', 'Bambang Uji', 'Direktur', '2010-05', '2015-08', 'former'] ], 'one row per stake or role run, dated by its deeds (deeds sorted, names matched across spellings)');
    ok(/Current stakes add up to 100%/.test(await p.textContent('#rvSum')), 'only current stakes are added up');
    if (process.env.SHOT2) await p.screenshot({ path: process.env.SHOT2 });
    await p.click('#rvApprove'); await sleep(2500);
    const got = await p.evaluate(() => { const E = [...OwnershipMap.master.entities], by = n => E.find(([, e]) => e.name === n)[0], co = by('PT Kronologi Uji');
      const L = [...OwnershipMap.master.links.values()].filter(l => l.target === co);
      const f = (n, test) => L.find(l => l.source === by(n) && test(l));
      const pick = l => ({ seen: l.seen, status: l.status || null, start: l.start || null, end: l.end || null, cites: l.citations.map(c => /^Akta/.test(c.text) ? c.text.split(',')[0] : 'profile') });
      const g = l => OwnershipMap.graph.links.find(x => x.id === [...OwnershipMap.master.links].find(([, v]) => v === l)[0]).status;
      const a100 = f('PT Induk Kronologi', l => l.value === 100), a60 = f('PT Induk Kronologi', l => l.value === 60), cit = f('Citra Uji', l => l.type === 'directorship'), bam = f('Bambang Uji', l => l.type === 'directorship');
      return { a100: pick(a100), a60: pick(a60), cit: pick(cit), bam: pick(bam), st: [g(a100), g(a60), g(cit), g(bam)], npwp: (E.find(([, e]) => e.name === 'PT Induk Kronologi')[1].identities || []).length }; });
    eq(got.a100, { seen: ['2020-11', '2024-02'], status: null, start: '2020-11', end: null, cites: ['profile', 'Akta No. 20'] }, 'current stake: from its deed, seen in the latest document');
    eq(got.a60, { seen: ['2010-05', '2020-11'], status: 'previous', start: '2010-05', end: '2020-11', cites: ['profile', 'Akta No. 1'] }, 'former stake: until the deed that replaced it');
    eq(got.cit, { seen: ['2010-05', '2015-08', '2024-02'], status: null, start: '2010-05', end: '2027-01', cites: ['profile', 'Akta No. 1', 'Akta No. 7'] }, 'continuing role: every deed that lists it, term end kept');
    eq(got.bam.status, 'previous', 'former director recorded as previous'); eq(got.bam.end, '2015-08', 'until the deed that changed the board');
    eq(got.st, ['recent', 'previous', 'recent', 'previous'], 'map statuses follow the deeds');
    eq(got.npwp, 1, 'profile details from the top-level lists kept');
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
