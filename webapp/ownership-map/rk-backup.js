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

  // The whole dataset as one backup file; downloaded, and returned so it can be stored elsewhere too.
  function downloadBackup(prefix){
    var data = window.rumahkerumahDB.export();
    var out = { entities: data.entities || {}, links: data.links || {}, versions: data.versions || {} };
    if (data.reviews && Object.keys(data.reviews).length) out.reviews = data.reviews;
    var json = JSON.stringify(out, null, 1);
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    var name = (prefix || 'ownership-map-backup-') + stamp + '.json';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
    try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch (e){}
    renderNote();
    return { data: data, json: json, name: name };
  }
  btn.addEventListener('click', function(){
    var b = downloadBackup();
    say('Backup saved: ' + count(b.data, 'entities') + ' entities, ' + count(b.data, 'links') + ' relationships.');
  });

  // ---- Delete all data: confirm by typing DELETE, back up first (download, and GitHub when connected), then empty ----
  var del = document.createElement('button');
  del.type = 'button'; del.className = 'link-btn rk-danger'; del.id = 'deleteAllBtn';
  del.textContent = 'Delete all data…';
  del.title = 'Remove every entity, relationship, review mark and history entry. A backup is saved first.';
  actions.appendChild(del);
  del.addEventListener('click', async function(){
    var cur = window.rumahkerumahDB.export(), ne = count(cur, 'entities'), nl = count(cur, 'links');
    if (!ne && !nl){ say('The dataset is already empty.'); return; }
    var G = window.rumahkerumahGitHub, gh = G && G.connected();
    var typed = window.prompt('Delete all data: ' + ne + ' entities, ' + nl + ' relationships, their review marks and history.\n\n' +
      'A backup file is downloaded first' + (gh ? ' and a copy is saved on GitHub (ownership-map/backups/)' : '') + '. ' +
      'Nothing is deleted if the backup fails. Restore brings everything back.\n\nType DELETE to continue.');
    if (typed == null){ say('Nothing was deleted.'); return; }
    if (typed.trim() !== 'DELETE'){ say('Nothing was deleted: type DELETE in capitals to confirm.', true); return; }
    del.disabled = true;
    try {
      say('Backing up before deleting…');
      var b = downloadBackup('ownership-map-backup-before-delete-');
      var where = 'Backup downloaded as ' + b.name;
      if (gh){
        var copy;
        try { copy = await G.backupCopy(b.json, b.name); }
        catch (e){ say('Nothing was deleted: the backup could not be saved on GitHub (' + ((e && e.detail) || 'no answer') + '). The downloaded file ' + b.name + ' is complete; try again, or Disconnect GitHub to delete with the download only.', true); return; }
        where += ' and saved on GitHub as ' + copy.path;
      }
      say(where + '. Deleting…');
      try { localStorage.setItem('rk-last-delete', JSON.stringify({ at: Date.now(), file: b.name, entities: ne, links: nl })); } catch (e){}
      await window.rumahkerumahDB.replace({ entities: {}, links: {}, versions: {}, reviews: {} });   // reloads the page
    } catch (e){
      say('The data could not be deleted.', true);
    } finally { del.disabled = false; }
  });
  // After the reload: say what happened and where the backup is.
  window.rumahkerumahDB.ready.then(function(){
    var last = null; try { last = JSON.parse(localStorage.getItem('rk-last-delete') || 'null'); } catch (e){}
    if (!last) return;
    if (Date.now() - last.at > 120000){ try { localStorage.removeItem('rk-last-delete'); } catch (e){} return; }
    // shown a moment after start-up, so the app's own start-up messages do not replace it
    setTimeout(function(){ say('All data deleted (' + last.entities + ' entities, ' + last.links + ' relationships). The backup is ' + last.file + '; use Restore to bring it back.'); }, 1200);
  }, function(){});

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
    try { localStorage.removeItem('rk-last-delete'); } catch (e){}
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
    catch (e){
      var code = e && e.code;
      statusEl.textContent =
        code === 'not_a_token' ? 'That doesn’t look like a GitHub token. A token starts with github_pat_ (or ghp_) and is shown only once, right after you generate it — paste that value, not the token’s name.' :
        code === 'network' ? 'This browser couldn’t reach api.github.com, so the token wasn’t checked. A firewall, VPN, proxy or browser extension (ad or privacy blocker) may be blocking it; allow api.github.com and try again.' :
        code === 'http' ? 'GitHub answered with an error (' + e.status + '). Try again in a minute.' :
        'GitHub rejected that token: it was not copied whole, has expired, or was deleted or regenerated. Generate a new token and paste it right away.';
      statusEl.classList.add('is-error');
    }
  });
  saveBtn.addEventListener('click', function(){ G.saveNow(); });
  discBtn.addEventListener('click', function(){
    if (window.confirm('Disconnect GitHub in this browser? The token is removed here; changes will stay in this browser until you connect again.')){ G.disconnect(); render(); }
  });
  G.subscribe(render);
  setInterval(function(){ if (G.state().phase === 'saved') render(); }, 30000);   // keep "x min ago" fresh
  new MutationObserver(function(){ render(); }).observe(actions, { attributes: true, attributeFilter: ['hidden'] });
}, function(){});
