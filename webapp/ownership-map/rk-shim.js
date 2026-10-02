/* Standalone replacement for the claude.ai artifact runtime (window.claude.use).
 * Lets the Ownership Map run as a static site (GitHub Pages):
 *   - 'db'        Firestore-like store kept in this browser's IndexedDB. Seeded from
 *                 data/seed.json on the very first visit only (a flag is kept), so a
 *                 dataset the user empties stays empty. Open tabs stay in sync through
 *                 BroadcastChannel. Persistent storage is requested on the first edit.
 *   - 'downloads' saves a file through a normal browser download.
 *   - 'sample'    reads documents with the DeepSeek API (OpenAI-compatible, called straight from the
 *                 browser). The API key is typed in by the user, kept in localStorage and never in the repo.
 *                 Text PDFs only; scans (images) are not supported.
 * Console helpers: rumahkerumahDB.export(), rumahkerumahDB.import(obj), rumahkerumahDB.replace(obj),
 *                  rumahkerumahDB.reset() (also reloads the seed),
 *                  rumahkerumahAI.clearKey()
 */
(function(){
  'use strict';
  var DB_NAME = 'rumahkerumah-ownership-map', STORE = 'docs';

  function openIdb(){
    return new Promise(function(res, rej){
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function(){ r.result.createObjectStore(STORE); };
      r.onsuccess = function(){ res(r.result); };
      r.onerror = function(){ rej(r.error); };
    });
  }
  function idbDo(db, mode, fn){
    return new Promise(function(res, rej){
      var tx = db.transaction(STORE, mode), st = tx.objectStore(STORE), out = fn(st);
      tx.oncomplete = function(){ res(out && out.result); };
      tx.onerror = tx.onabort = function(){ rej(tx.error); };
    });
  }

  var cols = {};            // collection -> Map(id -> data)
  var listeners = {};       // collection -> Set(fn)
  var idb = null;
  var META = '_meta/';      // keys under this prefix are bookkeeping, not data
  var chan = null;          // BroadcastChannel to the other open tabs
  try { chan = new BroadcastChannel('rk-ownership-map'); } catch (e){}
  var persistAsked = false;

  function col(name){ return cols[name] || (cols[name] = new Map()); }
  function clone(o){ return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function notify(name){ (listeners[name] || []).forEach(function(fn){ try { fn(); } catch (e){} }); }

  async function load(){
    idb = await openIdb();
    var keys = await idbDo(idb, 'readonly', function(s){ return s.getAllKeys(); });
    var vals = await idbDo(idb, 'readonly', function(s){ return s.getAll(); });
    var meta = {};
    keys.forEach(function(k, i){
      k = String(k);
      if (k.indexOf(META) === 0){ meta[k.slice(META.length)] = vals[i]; return; }
      var p = k.split('/'); col(p[0]).set(p.slice(1).join('/'), vals[i]);
    });
    if (!meta.seeded){
      // First visit: load the seed into an empty store. A store that already holds
      // data (from before this flag existed) is only marked, never overwritten.
      if (!col('entities').size && !col('links').size){
        try {
          var r = await fetch('data/seed.json', { cache: 'no-cache' });
          if (r.ok) await importAll(await r.json(), true);
        } catch (e){ /* no seed: start empty */ }
      }
      await setMeta('seeded', Date.now());
    }
    if (chan) chan.onmessage = onRemote;
  }
  function setMeta(k, v){ return idbDo(idb, 'readwrite', function(s){ return s.put(v, META + k); }); }

  // Another tab wrote: its IndexedDB write is done, mirror it here.
  function onRemote(ev){
    var m = ev.data || {};
    if (m.reload){ location.reload(); return; }
    if (!m.c) return;
    if (m.data === null) col(m.c).delete(m.id); else col(m.c).set(m.id, m.data);
    notify(m.c);
  }
  function tell(c, id, data){ if (chan) try { chan.postMessage({ c: c, id: id, data: data }); } catch (e){} }
  function askPersist(){
    if (persistAsked) return;
    persistAsked = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function(){}); } catch (e){}
  }

  async function importAll(obj, quiet){
    var names = Object.keys(obj || {});
    for (var n = 0; n < names.length; n++){
      var items = obj[names[n]] || {};
      var ids = Object.keys(items);
      for (var i = 0; i < ids.length; i++) await put(names[n], ids[i], items[ids[i]], true);
    }
    if (!quiet) Object.keys(cols).forEach(notify);
  }
  function exportAll(){
    var out = {};
    Object.keys(cols).forEach(function(c){
      out[c] = {}; cols[c].forEach(function(v, id){ out[c][id] = clone(v); });
    });
    return out;
  }
  function put(c, id, data, quiet){
    var v = clone(data);
    col(c).set(id, v);
    var p = idbDo(idb, 'readwrite', function(s){ return s.put(v, c + '/' + id); })
      .then(function(r){ tell(c, id, v); return r; });
    if (!quiet){ notify(c); askPersist(); }
    return p;
  }
  function del(c, id){
    col(c).delete(id);
    var p = idbDo(idb, 'readwrite', function(s){ return s.delete(c + '/' + id); })
      .then(function(r){ tell(c, id, null); return r; });
    notify(c); askPersist();
    return p;
  }
  // Replaces the whole dataset (entities, links, history) with obj, then reloads every tab.
  async function replaceAll(obj){
    if (!obj || typeof obj !== 'object' || (!obj.entities && !obj.links)) throw new Error('not a dataset file');
    var keys = await idbDo(idb, 'readonly', function(s){ return s.getAllKeys(); });
    await idbDo(idb, 'readwrite', function(s){
      keys.forEach(function(k){ if (String(k).indexOf(META) !== 0) s.delete(k); });
    });
    cols = {};
    await importAll({ entities: obj.entities || {}, links: obj.links || {}, versions: obj.versions || {} }, true);
    await setMeta('seeded', Date.now());
    if (chan) try { chan.postMessage({ reload: true }); } catch (e){}
    location.reload();
  }

  function query(name, spec){
    function run(){
      var docs = Array.from(col(name).entries()).map(function(e){ return { id: e[0], d: e[1] }; });
      (spec.where || []).forEach(function(w){
        docs = docs.filter(function(x){
          var v = x.d && x.d[w.f];
          switch (w.op){
            case '>=': return v >= w.v; case '>': return v > w.v;
            case '<=': return v <= w.v; case '<': return v < w.v;
            case '==': return v === w.v; case '!=': return v !== w.v;
            default: return true;
          }
        });
      });
      if (spec.order){
        var f = spec.order.f, dir = spec.order.dir === 'desc' ? -1 : 1;
        docs.sort(function(a, b){ var x = a.d[f], y = b.d[f]; return x < y ? -dir : x > y ? dir : 0; });
      }
      if (spec.limit != null) docs = docs.slice(0, spec.limit);
      return { docs: docs.map(function(x){ return { id: x.id, data: function(){ return clone(x.d); } }; }) };
    }
    var q = {
      where: function(f, op, v){ return query(name, Object.assign({}, spec, { where: (spec.where || []).concat([{ f: f, op: op, v: v }]) })); },
      orderBy: function(f, dir){ return query(name, Object.assign({}, spec, { order: { f: f, dir: dir || 'asc' } })); },
      limit: function(n){ return query(name, Object.assign({}, spec, { limit: n })); },
      get: function(){ return Promise.resolve(run()); },
      onSnapshot: function(ok, err){
        var fn = function(){ ok(run()); };
        (listeners[name] = listeners[name] || new Set()).add(fn);
        setTimeout(fn, 0);
        return function(){ listeners[name].delete(fn); };
      }
    };
    return q;
  }

  var dbApi = {
    collection: function(name){ return query(name, {}); },
    doc: function(path){
      var p = path.split('/'), c = p[0], id = p.slice(1).join('/');
      return {
        set: function(data){ return put(c, id, data); },
        delete: function(){ return del(c, id); },
        get: function(){ var v = col(c).get(id); return Promise.resolve({ id: id, exists: v !== undefined, data: function(){ return clone(v); } }); }
      };
    }
  };

  var downloadsApi = {
    save: function(o){
      var blob = o.data instanceof Blob ? o.data : new Blob([o.data], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = o.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
      return Promise.resolve({ status: 'saved' });
    }
  };


  // ---- Document reading through DeepSeek ----
  var KEY_NAME = 'rk-deepseek-key';
  var AI_URL = 'https://api.deepseek.com/chat/completions';
  var AI_MODEL = 'deepseek-chat';
  function getKey(){ try { return localStorage.getItem(KEY_NAME) || ''; } catch (e){ return ''; } }
  function setKey(k){ try { k ? localStorage.setItem(KEY_NAME, k) : localStorage.removeItem(KEY_NAME); } catch (e){} }
  function askKey(){
    var k = window.prompt('Masukkan DeepSeek API key untuk membaca dokumen.\n' +
      'Key hanya disimpan di browser ini dan dikirim langsung ke api.deepseek.com.\n' +
      'Isi dokumen yang dibaca juga dikirim ke DeepSeek.');
    k = (k || '').trim();
    if (!k) throw { code: 'no_key' };
    setKey(k);
    return k;
  }
  function parseJsonLoose(t){
    t = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(t); } catch (e){}
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('no json');
  }
  var sampleApi = {
    limits: function(){ return Promise.resolve({ images: null }); },
    json: async function(prompt, opts){
      opts = opts || {};
      if (opts.images && opts.images.length) throw { code: 'images_unavailable' };   // deepseek-chat reads text only
      var key = getKey() || askKey();
      var res;
      try {
        res = await fetch(AI_URL, {
          method: 'POST', signal: opts.signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model: AI_MODEL, temperature: 0, max_tokens: 4096,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'You extract structured data from documents and answer only with one valid JSON object.' },
              { role: 'user', content: prompt }
            ]
          })
        });
      } catch (e){
        if (e && e.name === 'AbortError') throw { code: 'cancelled' };
        throw { code: 'upstream_error' };
      }
      if (res.status === 401){ setKey(''); throw { code: 'bad_key' }; }
      if (res.status === 402) throw { code: 'insufficient_balance' };
      if (res.status === 429) throw { code: 'rate_limited' };
      if (res.status === 400 && /length|token|context/i.test(await res.clone().text())) throw { code: 'prompt_too_large' };
      if (!res.ok) throw { code: 'upstream_error' };
      var body = await res.json();
      var text = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
      if (!text) throw { code: 'empty_completion' };
      try { return parseJsonLoose(text); } catch (e){ throw { code: 'invalid_json' }; }
    }
  };
  window.rumahkerumahAI = { clearKey: function(){ setKey(''); } };

  var ready = load();
  window.rumahkerumahDB = {
    ready: ready,
    export: exportAll,
    import: function(o){ return ready.then(function(){ return importAll(o); }); },
    replace: function(o){ return ready.then(function(){ return replaceAll(o); }); },
    // Clears everything, including the seeded flag, so the seed loads again.
    reset: function(){ return ready.then(function(){ return idbDo(idb, 'readwrite', function(s){ return s.clear(); }); })
      .then(function(){ if (chan) try { chan.postMessage({ reload: true }); } catch (e){} location.reload(); }); }
  };
  window.claude = window.claude || {
    use: function(name){
      if (name === 'db') return ready.then(function(){ return dbApi; });
      if (name === 'downloads') return Promise.resolve(downloadsApi);
      if (name === 'sample') return Promise.resolve(sampleApi);
      return Promise.reject({ code: 'capability_disabled' });
    }
  };
})();
