/* Standalone replacement for the claude.ai artifact runtime (window.claude.use).
 * Lets the Ownership Map run as a static site (GitHub Pages):
 *   - 'db'        Firestore-like store kept in this browser's IndexedDB,
 *                 seeded once from data/seed.json when the store is empty.
 *   - 'downloads' saves a file through a normal browser download.
 *   - 'sample'    not available (reading PDFs needs Claude); the page falls back to manual paste.
 * Console helpers: rumahkerumahDB.export(), rumahkerumahDB.import(obj), rumahkerumahDB.reset()
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

  function col(name){ return cols[name] || (cols[name] = new Map()); }
  function clone(o){ return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function notify(name){ (listeners[name] || []).forEach(function(fn){ try { fn(); } catch (e){} }); }

  async function load(){
    idb = await openIdb();
    var keys = await idbDo(idb, 'readonly', function(s){ return s.getAllKeys(); });
    var vals = await idbDo(idb, 'readonly', function(s){ return s.getAll(); });
    keys.forEach(function(k, i){
      var p = String(k).split('/'); col(p[0]).set(p.slice(1).join('/'), vals[i]);
    });
    if (!col('entities').size && !col('links').size){
      try {
        var r = await fetch('data/seed.json', { cache: 'no-cache' });
        if (r.ok) await importAll(await r.json(), true);
      } catch (e){ /* no seed: start empty */ }
    }
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
    col(c).set(id, clone(data));
    var p = idbDo(idb, 'readwrite', function(s){ return s.put(clone(data), c + '/' + id); });
    if (!quiet) notify(c);
    return p;
  }
  function del(c, id){
    col(c).delete(id);
    var p = idbDo(idb, 'readwrite', function(s){ return s.delete(c + '/' + id); });
    notify(c);
    return p;
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

  var ready = load();
  window.rumahkerumahDB = {
    export: exportAll,
    import: function(o){ return ready.then(function(){ return importAll(o); }); },
    reset: function(){ return ready.then(function(){ return idbDo(idb, 'readwrite', function(s){ return s.clear(); }); }).then(function(){ location.reload(); }); }
  };
  window.claude = window.claude || {
    use: function(name){
      if (name === 'db') return ready.then(function(){ return dbApi; });
      if (name === 'downloads') return Promise.resolve(downloadsApi);
      return Promise.reject({ code: 'capability_disabled' });
    }
  };
})();
