/* Save status chip in the top capsule of the map (add-on).
 * Shows whether the dataset is safe on GitHub without opening the sidebar:
 *   Saved · 2 min ago / Saving… / Unsaved changes / Offline / Not saved / Not connected.
 * Click: connect (when not connected), save now (when unsaved or failed), else show the details. */
(function(){
  'use strict';
  var DB = window.rumahkerumahDB, host = document.getElementById('statsPanel');
  if (!DB || !host) return;
  var chip = document.createElement('button');
  chip.type = 'button'; chip.className = 'save-chip is-idle'; chip.id = 'saveChip';
  chip.innerHTML = '<span class="save-dot" aria-hidden="true"></span><span class="save-text">Checking…</span>';
  host.appendChild(chip);
  var G = null;

  function ago(ms){
    if (!ms) return '';
    var s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return ' · just now';
    if (s < 3600) return ' · ' + Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return ' · ' + Math.round(s / 3600) + ' h ago';
    return ' · ' + Math.round(s / 86400) + ' d ago';
  }
  function render(){
    if (!G) return;
    var st = G.state(), on = G.connected(), kind, text, title;
    if (st.phase === 'error'){ kind = 'bad'; text = 'Not saved'; title = st.message || 'The last save failed.'; }
    else if (st.phase === 'saving'){ kind = 'busy'; text = 'Saving…'; title = 'Saving to GitHub'; }
    else if (on && st.phase === 'pending'){ kind = 'warn'; text = 'Unsaved changes'; title = 'Saving to GitHub in a few seconds. Click to save now.'; }
    else if (st.phase === 'offline'){ kind = 'warn'; text = on ? 'Offline · will retry' : 'GitHub unreachable'; title = (st.message || 'GitHub could not be reached.') + (on ? ' Click to retry now.' : ''); }
    else if (on && st.phase === 'saved'){ kind = 'ok'; text = 'Saved' + ago(st.savedAt); title = 'The dataset on GitHub is up to date. Click for details.'; }
    else if (on){ kind = 'ok'; text = 'Connected'; title = 'Changes are saved to GitHub automatically.'; }
    else { kind = 'idle'; text = 'Not connected'; title = 'Changes stay in this browser. Click to connect GitHub and save them.'; }
    chip.className = 'save-chip is-' + kind;
    chip.querySelector('.save-text').textContent = text;
    chip.title = title; chip.setAttribute('aria-label', 'Save status: ' + text + '. ' + title);
  }
  chip.addEventListener('click', function(){
    if (!G) return;
    var st = G.state();
    if (window.OwnershipMapFold) window.OwnershipMapFold.open('datasetPanel');
    if (!G.connected()){ var b = document.getElementById('ghConnectBtn'); if (b) b.click(); return; }
    if (st.phase === 'pending' || st.phase === 'error' || st.phase === 'offline'){ G.saveNow(); return; }
    var blk = document.getElementById('ghBlock'), sb = document.querySelector('.sidebar'), app = document.querySelector('.app');
    if (app && app.classList.contains('panel-collapsed')){ var t = document.getElementById('panelOpenBtn'); if (t) t.click(); }
    if (blk && sb) sb.scrollTop = blk.getBoundingClientRect().top - sb.getBoundingClientRect().top + sb.scrollTop - 80;
  });
  function init(){
    G = window.rumahkerumahGitHub;
    if (!G){ chip.hidden = true; return; }
    G.subscribe(render);
    setInterval(render, 30000);
  }
  DB.ready.then(init, init);
})();
