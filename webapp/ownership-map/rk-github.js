/* GitHub sync for the standalone Ownership Map.
 *
 * The dataset (entities, links, history) lives as one JSON file on a data-only branch
 * of the repo. rk-shim.js keeps the working copy in IndexedDB and calls this module:
 *   - onLoad(meta): before the app reads anything, pull the GitHub file and decide
 *     whether to use it, keep the local copy, or ask (both changed).
 *   - changed(): after every local edit; saves to GitHub a few seconds later.
 *
 * Reading needs no token (the repo is public). Saving needs a fine-grained personal
 * access token with Contents: read and write on this repo only. The token is typed in
 * by the user and kept in this browser's localStorage, never in the repo.
 *
 * Bookkeeping in IndexedDB (_meta/...): ghSha (blob sha of the GitHub file the local
 * copy was last in step with), ghChangedAt (last local edit), ghSavedAt (when the copy
 * last saved or pulled was taken). Local is "dirty" when ghChangedAt > ghSavedAt.
 */
(function(){
  'use strict';
  var OWNER = 'aegean8095', REPO = 'rumahkerumah';
  var BRANCH = 'ownership-map-data', PATH = 'ownership-map/dataset.json';
  var API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
  var TOKEN_KEY = 'rk-github-token';
  var SAVE_DELAY = 8000, RETRY_DELAY = 30000, CHECK_EVERY = 60000, LOAD_TIMEOUT = 8000;

  window.rkGitHubSync = function(db){
    var timer = null, saving = false, again = false, lastCheck = 0, saveSeed = false;
    var state = { phase: 'idle', savedAt: 0, message: '' };
    var subs = [];

    function getToken(){ try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e){ return ''; } }
    function setToken(t){ try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e){} }
    function emit(phase, message, extra){
      state = Object.assign({}, state, { phase: phase, message: message || '' }, extra || {});
      subs.forEach(function(fn){ try { fn(state); } catch (e){} });
    }

    // ---- encoding ----
    function b64encode(str){
      var bytes = new TextEncoder().encode(str), bin = '';
      for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }
    function b64decode(b64){
      var bin = atob(String(b64).replace(/\s/g, '')), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    function stable(v){
      if (v === null || typeof v !== 'object') return JSON.stringify(v);
      if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
      return '{' + Object.keys(v).sort().filter(function(k){ return v[k] !== undefined; })
        .map(function(k){ return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    }
    function sameData(a, b){ return stable(a) === stable(b); }
    function isEmpty(o){ return !Object.keys((o && o.entities) || {}).length && !Object.keys((o && o.links) || {}).length; }
    function counts(o){
      return Object.keys((o && o.entities) || {}).length + ' entities, ' + Object.keys((o && o.links) || {}).length + ' relationships';
    }

    // ---- GitHub API ----
    function call(path, opts){
      opts = opts || {};
      var headers = Object.assign({ 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, opts.headers || {});
      var t = getToken();
      if (t) headers.Authorization = 'Bearer ' + t;
      return fetch(API + path, { method: opts.method || 'GET', headers: headers, cache: 'no-store',
        body: opts.body ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
    }
    function withTimeout(p, ms){
      return Promise.race([p, new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('timeout')); }, ms); })]);
    }
    // { missing: true } | { sha, data } ; throws on network or API failure.
    async function remoteGet(){
      var r = await call('/contents/' + PATH + '?ref=' + encodeURIComponent(BRANCH));
      if (r.status === 404) return { missing: true };
      if (r.status === 401){ setToken(''); throw { code: 'bad_token' }; }
      if (!r.ok) throw { code: 'http_' + r.status };
      var meta = await r.json(), text;
      if (meta.content) text = b64decode(meta.content);
      else {   // over 1 MB: the contents API leaves content out; read the blob instead
        var b = await call('/git/blobs/' + meta.sha, { headers: { Accept: 'application/vnd.github.raw+json' } });
        if (!b.ok) throw { code: 'http_' + b.status };
        text = await b.text();
      }
      return { sha: meta.sha, data: JSON.parse(text) };
    }
    // { sha } | { conflict: true } ; throws otherwise.
    async function remotePut(text, sha, summary){
      var body = { message: 'Ownership Map: ' + summary, content: b64encode(text), branch: BRANCH };
      if (sha) body.sha = sha;
      var r = await call('/contents/' + PATH, { method: 'PUT', body: body });
      if (r.ok){ var j = await r.json(); return { sha: j.content.sha }; }
      var msg = ''; try { msg = (await r.json()).message || ''; } catch (e){}
      if ((r.status === 404 || r.status === 422) && /branch/i.test(msg)) return createBranch(text, summary);
      if (r.status === 409 || (r.status === 422 && /sha/i.test(msg))) return { conflict: true };
      if (r.status === 401){ setToken(''); throw { code: 'bad_token' }; }
      if (r.status === 403 || r.status === 404) throw { code: 'no_access' };
      throw { code: 'http_' + r.status, message: msg };
    }
    // First save ever: a new branch holding only the dataset file (no code, no history).
    async function createBranch(text, summary){
      var t = await call('/git/trees', { method: 'POST', body: { tree: [{ path: PATH, mode: '100644', type: 'blob', content: text }] } });
      if (!t.ok) throw { code: t.status === 403 || t.status === 404 ? 'no_access' : 'http_' + t.status };
      var tree = await t.json();
      var c = await call('/git/commits', { method: 'POST', body: { message: 'Ownership Map: ' + summary, tree: tree.sha, parents: [] } });
      if (!c.ok) throw { code: 'http_' + c.status };
      var commit = await c.json();
      var ref = await call('/git/refs', { method: 'POST', body: { ref: 'refs/heads/' + BRANCH, sha: commit.sha } });
      if (!ref.ok) throw { code: 'http_' + ref.status };
      var blob = tree.tree.find(function(x){ return x.path === PATH; });
      return { sha: blob.sha };
    }

    // ---- local bookkeeping ----
    async function dirty(){ return ((await db.getMeta('ghChangedAt')) || 0) > ((await db.getMeta('ghSavedAt')) || 0); }
    async function markInStep(sha, at){
      await db.setMeta('ghSha', sha);
      await db.setMeta('ghSavedAt', at || Date.now());
    }
    function downloadBackup(obj, why){
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }));
      a.download = 'ownership-map-' + why + '-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
    }
    // Both sides changed. Returns 'remote' or 'local'.
    function askConflict(local, remote){
      var useRemote = window.confirm('The dataset on GitHub differs from the one in this browser (it was changed somewhere else).\n\n' +
        'GitHub: ' + counts(remote) + '\nThis browser: ' + counts(local) + '\n\n' +
        'OK — use the GitHub version. This browser’s version is downloaded as a backup file first.\n' +
        'Cancel — keep this browser’s version and save it over the GitHub one.');
      if (useRemote) downloadBackup(local, 'browser-copy');
      return useRemote ? 'remote' : 'local';
    }

    // ---- on page load, before the app reads ----
    async function onLoad(meta){
      var remote;
      try { remote = await withTimeout(remoteGet(), LOAD_TIMEOUT); }
      catch (e){
        emit(e && e.code === 'bad_token' ? 'error' : 'offline',
          e && e.code === 'bad_token' ? 'GitHub rejected the saved token; it was removed. Connect again to save.' : 'GitHub couldn’t be reached. Working in this browser; changes are saved to GitHub later.');
        if (await dirty()) schedule(RETRY_DELAY);
        return;
      }
      lastCheck = Date.now();
      var local = db.snapshot(), isDirty = await dirty();
      if (remote.missing){
        // Nothing on GitHub yet: whatever this browser holds (or the seed) is saved there.
        if (!meta.seeded && !db.dataSize()){ saveSeed = true; return; }   // fresh browser: the shim loads the seed, then afterSeed()
        await db.setMeta('ghChangedAt', Date.now());
        schedule(1000);
        return;
      }
      if (remote.sha === meta.ghSha){
        if (isDirty) schedule(1000); else emit('saved', '', { savedAt: (await db.getMeta('ghSavedAt')) || 0 });
        return;
      }
      if (sameData(local, remote.data)){ await markInStep(remote.sha); emit('saved', '', { savedAt: Date.now() }); return; }
      var take = (!meta.seeded && !db.dataSize()) || (meta.ghSha && !isDirty) ? 'remote' : askConflict(local, remote.data);
      if (take === 'remote'){
        await db.applyDataset(remote.data, false);
        await markInStep(remote.sha);
        emit('saved', 'Loaded the latest dataset from GitHub.', { savedAt: Date.now() });
      } else {
        await db.setMeta('ghSha', remote.sha);               // save on top of the GitHub version
        await db.setMeta('ghChangedAt', Date.now());
        schedule(1000);
      }
    }

    // ---- saving ----
    function schedule(ms){
      clearTimeout(timer);
      if (!getToken()){ emit('local', ''); return; }
      emit('pending', '');
      timer = setTimeout(save, ms == null ? SAVE_DELAY : ms);
    }
    async function changed(force){
      await db.setMeta('ghChangedAt', Date.now());
      if (!force) schedule();
    }
    async function save(){
      timer = null;
      if (!getToken()){ emit('local', ''); return; }
      if (saving){ again = true; return; }
      saving = true; again = false;
      emit('saving', '');
      var takenAt = Date.now(), local = db.snapshot();
      var summary = 'save dataset (' + counts(local) + ')';
      try {
        var res = await remotePut(JSON.stringify(local, null, 1), await db.getMeta('ghSha'), summary);
        if (res.conflict){
          var remote = await remoteGet();
          if (remote.missing){ await db.setMeta('ghSha', null); again = true; }
          else if (sameData(local, remote.data)) await markInStep(remote.sha, takenAt);
          else if (askConflict(local, remote.data) === 'remote'){
            await db.applyDataset(remote.data, true);
            await markInStep(remote.sha);
            emit('saved', 'Loaded the latest dataset from GitHub.', { savedAt: Date.now() });
            return;
          } else { await db.setMeta('ghSha', remote.sha); again = true; }
        } else await markInStep(res.sha, takenAt);
        if (!again && !(await dirty())) emit('saved', '', { savedAt: Date.now() });
      } catch (e){
        var code = e && e.code;
        if (code === 'bad_token') emit('error', 'GitHub rejected the token, so it was removed. Connect again to save.');
        else if (code === 'no_access') emit('error', 'The token can’t write to ' + OWNER + '/' + REPO + '. It needs Contents: read and write on this repository.');
        else { emit('offline', 'Couldn’t save to GitHub. Trying again shortly.'); clearTimeout(timer); timer = setTimeout(save, RETRY_DELAY); }
      } finally {
        saving = false;
        if (again || (getToken() && !timer && (await dirty()) && state.phase !== 'error')) schedule(1000);
      }
    }

    // ---- other devices: pick up their saves when this tab comes back ----
    async function checkRemote(){
      if (saving || timer || Date.now() - lastCheck < CHECK_EVERY) return;
      lastCheck = Date.now();
      try {
        var remote = await remoteGet();
        if (remote.missing || remote.sha === (await db.getMeta('ghSha'))) return;
        if (await dirty()) { schedule(1000); return; }     // the save will meet the conflict
        if (sameData(db.snapshot(), remote.data)){ await markInStep(remote.sha); return; }
        await db.applyDataset(remote.data, true);
        await markInStep(remote.sha);
        emit('saved', 'Updated with changes saved on another device.', { savedAt: Date.now() });
      } catch (e){ /* try again next time */ }
    }
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'visible') checkRemote();
      else if (timer){ clearTimeout(timer); save(); }       // leaving: save now rather than later
    });
    window.addEventListener('beforeunload', function(e){
      if (getToken() && (timer || saving)){ e.preventDefault(); e.returnValue = ''; }
    });

    // ---- for the page (rk-backup.js) ----
    window.rumahkerumahGitHub = {
      repo: OWNER + '/' + REPO, branch: BRANCH, path: PATH,
      fileUrl: 'https://github.com/' + OWNER + '/' + REPO + '/blob/' + BRANCH + '/' + PATH,
      historyUrl: 'https://github.com/' + OWNER + '/' + REPO + '/commits/' + BRANCH + '/' + PATH,
      connected: function(){ return !!getToken(); },
      state: function(){ return state; },
      subscribe: function(fn){ subs.push(fn); fn(state); },
      connect: async function(token){
        token = (token || '').trim();
        if (!token) return false;
        setToken(token);
        var r = await call('');
        if (r.status === 401){ setToken(''); throw { code: 'bad_token' }; }
        if (await dirty()) schedule(500); else emit('saved', '', { savedAt: (await db.getMeta('ghSavedAt')) || 0 });
        return true;
      },
      disconnect: function(){ clearTimeout(timer); timer = null; setToken(''); emit('local', ''); },
      saveNow: function(){ clearTimeout(timer); return save(); }
    };
    async function afterSeed(){ if (saveSeed){ saveSeed = false; await changed(true); schedule(1000); } }
    return { onLoad: onLoad, changed: changed, afterSeed: afterSeed };
  };
})();
