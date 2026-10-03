/* Entity detail panel additions (add-on, uses window.OwnershipMap and the other add-ons).
 * Under the title of an entity it adds:
 *   Focus: only this / with relations / whole network   (what right-click already offers)
 *   Open in table · Find connection · Company report
 * and moves the Note block up, right below, so notes are not buried at the bottom. */
(function(){
  'use strict';
  var OM = window.OwnershipMap, panel = document.getElementById('detailPanel');
  if (!OM || !panel) return;
  var busy = false;

  function enhance(){
    if (busy || panel.hidden) return;
    var heading = document.getElementById('detailHeading');
    if (!heading || heading.textContent.trim() !== 'Entity detail') return;
    var id = OM.selectedEntityId && OM.selectedEntityId();
    if (!id || panel.querySelector('.rk-detail-tools[data-id="' + CSS.escape(id) + '"]')) return;
    var anchor = panel.querySelector('.detail-actions'); if (!anchor) return;
    busy = true;
    try {
      panel.querySelectorAll('.rk-detail-tools').forEach(function(n){ n.remove(); });
      var e = OM.master.entities.get(id), isCo = e && (e.type || OM.inferType(e.name)) === 'company';
      var tools = document.createElement('div');
      tools.className = 'rk-detail-tools'; tools.dataset.id = id;
      tools.innerHTML =
        '<div class="rk-tool-row"><span class="rk-tool-label">Focus</span>' +
          '<button type="button" class="chip-btn" data-rk="focus0" title="Hide everything except this entity">Only this</button>' +
          '<button type="button" class="chip-btn" data-rk="focus1" title="This entity and everyone directly related to it">With relations</button>' +
          '<button type="button" class="chip-btn" data-rk="focusAll" title="Everything connected to it, through any number of steps">Whole network</button></div>' +
        '<div class="rk-tool-row">' +
          '<button type="button" class="chip-btn" data-rk="table">Open in table</button>' +
          '<button type="button" class="chip-btn" data-rk="connect">Find connection…</button>' +
          (isCo && window.OwnershipMapReport ? '<button type="button" class="chip-btn" data-rk="report">Company report</button>' : '') + '</div>';
      anchor.insertAdjacentElement('afterend', tools);
      var note = Array.from(panel.querySelectorAll('.detail-block')).find(function(b){ var h = b.querySelector('h4'); return h && h.textContent.trim() === 'Note'; });
      if (note) tools.insertAdjacentElement('afterend', note);
    } finally { busy = false; }
  }

  panel.addEventListener('click', function(ev){
    var b = ev.target.closest('[data-rk]'); if (!b) return;
    var id = OM.selectedEntityId(); if (!id) return;
    var act = b.dataset.rk;
    if (act === 'focus0') OM.focusOn(id, 0);
    else if (act === 'focus1') OM.focusOn(id, 1);
    else if (act === 'focusAll') OM.focusOn(id, Infinity);
    else if (act === 'table' && window.OwnershipMapTabs) window.OwnershipMapTabs.openTable('entities', OM.entityName(id));
    else if (act === 'connect' && window.OwnershipMapConnect) window.OwnershipMapConnect.open(id);
    else if (act === 'report' && window.OwnershipMapReport) window.OwnershipMapReport.open(id);
  });

  new MutationObserver(enhance).observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  enhance();
})();
