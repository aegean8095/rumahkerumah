/* Back up / restore buttons for the standalone Ownership Map (see rk-shim.js).
 * A backup is one JSON file with entities, links and history, in the same shape as
 * data/seed.json, so it can be restored in any browser or committed as the seed. */
(function(){
  'use strict';
  var LAST_KEY = 'rk-last-backup';
  var $ = function(id){ return document.getElementById(id); };
  var btn = $('backupBtn'), rbtn = $('restoreBackupBtn'), input = $('restoreBackupInput');
  var note = $('backupNote'), status = $('datasetStatus'), actions = $('datasetActions');
  if (!btn || !window.rumahkerumahDB) return;

  function say(text, isError){
    status.classList.toggle('has-error', !!isError);
    status.textContent = text;
  }
  function getLast(){ try { return +localStorage.getItem(LAST_KEY) || 0; } catch (e){ return 0; } }
  function fmt(ms){
    try { return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e){ return ''; }
  }
  function count(o, k){ return Object.keys((o && o[k]) || {}).length; }
  function renderNote(){
    var last = getLast();
    if (!last) note.textContent = 'No backup made in this browser yet.';
    else {
      var days = Math.floor((Date.now() - last) / 864e5);
      note.textContent = 'Last backup: ' + fmt(last) + (days >= 14 ? ' (' + days + ' days ago — time for a new one)' : '') + '.';
    }
    note.hidden = actions.hidden;
  }

  btn.addEventListener('click', function(){
    var data = window.rumahkerumahDB.export();
    var out = { entities: data.entities || {}, links: data.links || {}, versions: data.versions || {} };
    if (data.reviews && Object.keys(data.reviews).length) out.reviews = data.reviews;
    var json = JSON.stringify(out, null, 1);
    var stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'ownership-map-backup-' + stamp + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
    try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch (e){}
    say('Backup saved: ' + count(data, 'entities') + ' entities, ' + count(data, 'links') + ' relationships.');
    renderNote();
  });

  rbtn.addEventListener('click', function(){ input.value = ''; input.click(); });
  input.addEventListener('change', async function(){
    var f = input.files && input.files[0];
    if (!f) return;
    var obj;
    try { obj = JSON.parse(await f.text()); } catch (e){ say('That file is not a backup (it could not be read as JSON).', true); return; }
    if (!obj || typeof obj !== 'object' || (!obj.entities && !obj.links)){ say('That file is not an Ownership Map backup.', true); return; }
    var cur = window.rumahkerumahDB.export();
    var ok = window.confirm('Replace the dataset in this browser with “' + f.name + '”?\n\n' +
      'Backup: ' + count(obj, 'entities') + ' entities, ' + count(obj, 'links') + ' relationships.\n' +
      'Now in this browser: ' + count(cur, 'entities') + ' entities, ' + count(cur, 'links') + ' relationships — these will be replaced.\n\n' +
      'Tip: back up the current dataset first if you may need it.');
    if (!ok){ say('Restore cancelled.'); return; }
    say('Restoring…');
    try { await window.rumahkerumahDB.replace(obj); }
    catch (e){ say('The backup could not be restored.', true); }
  });

  window.rumahkerumahDB.ready.then(renderNote, function(){});
  new MutationObserver(renderNote).observe(actions, { attributes: true, attributeFilter: ['hidden'] });
})();

/* "Saved on GitHub" block: status of the GitHub sync (rk-github.js) and its buttons.
 * rumahkerumahGitHub exists once the shim has opened the local store. */
(window.rumahkerumahDB ? window.rumahkerumahDB.ready : Promise.reject()).then(function(){
  'use strict';
  var G = window.rumahkerumahGitHub;
  var $ = function(id){ return document.getElementById(id); };
  var block = $('ghBlock'), statusEl = $('ghStatus'), actions = $('datasetActions');
  if (!G || !block) return;
  var connectBtn = $('ghConnectBtn'), saveBtn = $('ghSaveBtn'), discBtn = $('ghDisconnectBtn');
  $('ghFileLink').href = G.fileUrl;
  $('ghHistoryLink').href = G.historyUrl;

  function ago(ms){
    if (!ms) return '';
    var s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    try { return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e){ return ''; }
  }
  function render(st){
    st = st || G.state();
    var on = G.connected();
    connectBtn.hidden = on; saveBtn.hidden = !on; discBtn.hidden = !on;
    $('ghHelp').hidden = on;
    var text;
    switch (st.phase === 'error' ? 'error' : on ? st.phase : 'local'){
      case 'pending': text = 'Unsaved changes. Saving to GitHub in a few seconds…'; break;
      case 'saving': text = 'Saving to GitHub…'; break;
      case 'saved': text = 'Saved to GitHub' + (st.savedAt ? ' · ' + ago(st.savedAt) : '') + '.'; break;
      case 'offline': case 'error': text = st.message; break;
      default: text = on ? 'Connected. Changes are saved to GitHub automatically.' :
        'Not connected: the latest GitHub version is loaded when the map opens, but changes made here stay in this browser until you connect.';
    }
    if (st.message && st.phase === 'saved') text = st.message + ' ' + text;
    statusEl.textContent = text;
    statusEl.classList.toggle('parse-status', true);
    statusEl.classList.toggle('is-error', st.phase === 'error');
    block.hidden = actions.hidden;
  }
  connectBtn.addEventListener('click', async function(){
    var t = window.prompt('Paste your GitHub fine-grained token (Contents: read and write on rumahkerumah).\nIt is kept in this browser only.');
    if (!t) return;
    try { await G.connect(t); render(); }
    catch (e){ statusEl.textContent = 'GitHub rejected that token. Check that it was copied whole and has not expired.'; statusEl.classList.add('is-error'); }
  });
  saveBtn.addEventListener('click', function(){ G.saveNow(); });
  discBtn.addEventListener('click', function(){
    if (window.confirm('Disconnect GitHub in this browser? The token is removed here; changes will stay in this browser until you connect again.')){ G.disconnect(); render(); }
  });
  G.subscribe(render);
  setInterval(function(){ if (G.state().phase === 'saved') render(); }, 30000);   // keep "x min ago" fresh
  new MutationObserver(function(){ render(); }).observe(actions, { attributes: true, attributeFilter: ['hidden'] });
}, function(){});
