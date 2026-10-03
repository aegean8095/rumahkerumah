/* Map interactions for the Ownership Map (add-on, uses window.OwnershipMap only).
 *
 *  - Hover: pointing at an entity dims everything except it, its relations and its neighbours.
 *  - Pinned highlight: other modules (the connection finder) can keep a set of entities and
 *    relations lit with OwnershipMapHL.set(nodeIds, edgeIds) / clear().
 *  - Multi-select: Shift+click (or Ctrl/Cmd+click) toggles an entity, Shift+drag on empty
 *    map draws a box. A bar offers Focus, Focus with direct relations, Hide, Assign group
 *    and, for two entities, Find connection. Esc clears the selection.
 */
(function(){
  'use strict';
  var OM = window.OwnershipMap, wrap = document.getElementById('map'), svg = document.getElementById('graph');
  if (!OM || !wrap || !svg) return;
  var esc = OM.escapeHtml;

  // ---------- helpers on what is drawn ----------
  function nodeEls(){ return svg.querySelectorAll('g.node'); }
  function edgeEls(){ return svg.querySelectorAll('g.edge'); }
  function nodeId(g){ var d = d3.select(g).datum(); return d && d.id; }
  function edgeInfo(g){ var d = d3.select(g).datum(); if (!d) return null; var e = OM.linkEnds(d); return { id: d.id, a: e[0], b: e[1] }; }

  // ---------- hover / pinned highlight ----------
  var pinned = null;            // { nodes:Set, edges:Set } or null
  var hoverId = null;
  function paint(nodes, edges){
    var on = !!nodes;
    svg.classList.toggle('hl', on);
    nodeEls().forEach(function(g){ g.classList.toggle('hl-on', on && nodes.has(nodeId(g))); });
    edgeEls().forEach(function(g){ var i = edgeInfo(g); g.classList.toggle('hl-on', on && !!i && edges.has(i.id)); });
  }
  function neighbourhood(id){
    var nodes = new Set([id]), edges = new Set();
    edgeEls().forEach(function(g){
      var i = edgeInfo(g); if (!i) return;
      if (i.a === id || i.b === id){ edges.add(i.id); nodes.add(i.a); nodes.add(i.b); }
    });
    return { nodes: nodes, edges: edges };
  }
  function refreshHighlight(){
    if (pinned) paint(pinned.nodes, pinned.edges);
    else if (hoverId){ var n = neighbourhood(hoverId); paint(n.nodes, n.edges); }
    else paint(null);
  }
  svg.addEventListener('mouseover', function(e){
    var g = e.target.closest && e.target.closest('g.node'); if (!g) return;
    var id = nodeId(g); if (!id || id === hoverId) return;
    hoverId = id; if (!pinned) refreshHighlight();
  });
  svg.addEventListener('mouseout', function(e){
    var g = e.target.closest && e.target.closest('g.node'); if (!g) return;
    var to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('g.node');
    if (to === g) return;
    hoverId = null; if (!pinned) refreshHighlight();
  });
  window.OwnershipMapHL = {
    set: function(nodeIds, edgeIds){ pinned = { nodes: new Set(nodeIds), edges: new Set(edgeIds || []) }; refreshHighlight(); },
    clear: function(){ pinned = null; refreshHighlight(); },
    selection: function(){ return new Set(sel); },
    select: function(ids){ sel = new Set(ids); updateSelection(); },
    onSelection: function(fn){ selListeners.push(fn); },
  };

  // ---------- multi-select ----------
  var sel = new Set(), selListeners = [];
  var bar = document.createElement('div');
  bar.className = 'overlay sel-bar'; bar.id = 'selectionBar'; bar.hidden = true;
  bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Selected entities');
  wrap.appendChild(bar);
  var assigning = false, assignMsg = '';

  function groupNames(){
    var set = new Set();
    OM.master.links.forEach(function(l){ (l.groups || []).forEach(function(g){ set.add(g); }); });
    return Array.from(set).sort(function(a, b){ return a.localeCompare(b); });
  }
  function updateSelection(){
    var present = new Set(Array.from(nodeEls()).map(nodeId));
    sel.forEach(function(id){ if (!present.has(id)) sel.delete(id); });
    nodeEls().forEach(function(g){ g.classList.toggle('multi-sel', sel.has(nodeId(g))); });
    renderBar();
    selListeners.forEach(function(fn){ try { fn(new Set(sel)); } catch (e){} });
  }
  function renderBar(){
    var n = sel.size;
    bar.hidden = n === 0 || wrap.classList.contains('table-mode');
    if (bar.hidden){ assigning = false; assignMsg = ''; return; }
    var names = Array.from(sel).slice(0, 2).map(function(id){ return OM.entityName(id); });
    bar.innerHTML =
      '<span class="sel-count"><b>' + n + '</b> selected' + (n <= 2 ? ': ' + names.map(esc).join(', ') : '') + '</span>' +
      '<button type="button" class="chip-btn" data-sel="focus">Focus</button>' +
      '<button type="button" class="chip-btn" data-sel="focus1" title="Selected entities and everything directly related to them">Focus + relations</button>' +
      '<button type="button" class="chip-btn" data-sel="hide">Hide</button>' +
      '<button type="button" class="chip-btn" data-sel="group">Assign group…</button>' +
      (n === 2 ? '<button type="button" class="chip-btn chip-btn--primary" data-sel="connect">Find connection</button>' : '') +
      '<button type="button" class="link-btn" data-sel="clear" title="Esc">Clear</button>' +
      (assigning ? '<form class="sel-assign" data-sel-form><input class="well" name="group" list="selGroups" placeholder="Group name, new or existing" autocomplete="off" aria-label="Group name" required>' +
        '<datalist id="selGroups">' + groupNames().map(function(g){ return '<option value="' + esc(g) + '"></option>'; }).join('') + '</datalist>' +
        '<button type="submit" class="btn btn--primary">Add</button>' +
        '<span class="sel-hint">Adds the group to every relationship of the ' + n + ' selected entit' + (n === 1 ? 'y' : 'ies') + '.</span></form>' : '') +
      (assignMsg ? '<span class="sel-msg" role="status">' + esc(assignMsg) + '</span>' : '');
    var inp = bar.querySelector('input[name="group"]'); if (inp && document.activeElement !== inp) inp.focus();
  }
  function toggle(id){ if (sel.has(id)) sel.delete(id); else sel.add(id); assignMsg = ''; updateSelection(); }

  // Shift or Ctrl/Cmd + click on an entity toggles it, without opening its detail.
  wrap.addEventListener('click', function(e){
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) return;
    var g = e.target.closest && e.target.closest('g.node'); if (!g) return;
    e.stopPropagation(); e.preventDefault();
    toggle(nodeId(g));
  }, true);

  // Shift + drag on empty map draws a selection box.
  var box = null, boxStart = null;
  wrap.addEventListener('mousedown', function(e){
    if (!e.shiftKey || e.button !== 0) return;
    if (!e.target.closest || e.target.closest('g.node') || e.target.closest('.overlay') || e.target.closest('.context-menu')) return;
    if (e.target !== svg && !svg.contains(e.target)) return;
    e.stopPropagation(); e.preventDefault();
    var r = wrap.getBoundingClientRect();
    boxStart = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    box = document.createElement('div'); box.className = 'sel-box';
    wrap.appendChild(box); drawBox(e.clientX, e.clientY);
    window.addEventListener('mousemove', onBoxMove); window.addEventListener('mouseup', onBoxUp);
  }, true);
  function drawBox(x, y){
    var x1 = Math.min(boxStart.x, x) - boxStart.left, y1 = Math.min(boxStart.y, y) - boxStart.top;
    box.style.cssText = 'left:' + x1 + 'px;top:' + y1 + 'px;width:' + Math.abs(x - boxStart.x) + 'px;height:' + Math.abs(y - boxStart.y) + 'px';
  }
  function onBoxMove(e){ if (box) drawBox(e.clientX, e.clientY); }
  function onBoxUp(e){
    window.removeEventListener('mousemove', onBoxMove); window.removeEventListener('mouseup', onBoxUp);
    if (!box) return;
    var x1 = Math.min(boxStart.x, e.clientX), x2 = Math.max(boxStart.x, e.clientX), y1 = Math.min(boxStart.y, e.clientY), y2 = Math.max(boxStart.y, e.clientY);
    box.remove(); box = null;
    if (x2 - x1 < 4 && y2 - y1 < 4) return;
    nodeEls().forEach(function(g){
      var r = g.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) sel.add(nodeId(g));
    });
    assignMsg = ''; updateSelection();
  }

  // ---------- actions ----------
  bar.addEventListener('click', function(e){
    var b = e.target.closest('[data-sel]'); if (!b) return;
    var ids = Array.from(sel), act = b.dataset.sel;
    if (act === 'clear'){ sel.clear(); assigning = false; assignMsg = ''; updateSelection(); }
    else if (act === 'focus'){ OM.focusOnSet(ids, 0); }
    else if (act === 'focus1'){ OM.focusOnSet(ids, 1); }
    else if (act === 'hide'){ sel.clear(); OM.hideMany(ids); updateSelection(); }
    else if (act === 'group'){ assigning = !assigning; assignMsg = ''; renderBar(); }
    else if (act === 'connect' && window.OwnershipMapConnect){ window.OwnershipMapConnect.open(ids[0], ids[1]); }
  });
  bar.addEventListener('submit', function(e){
    if (!e.target.matches('[data-sel-form]')) return;
    e.preventDefault();
    var group = e.target.elements.group.value.trim(); if (!group) return;
    var ids = sel, now = Date.now(), changes = [];
    OM.master.links.forEach(function(l, id){
      if (!ids.has(l.source) && !ids.has(l.target)) return;
      if ((l.groups || []).indexOf(group) >= 0) return;
      var after = JSON.parse(JSON.stringify(l)); after.groups = (l.groups || []).concat(group); after.updatedAt = now;
      changes.push({ kind: 'link', id: id, before: JSON.parse(JSON.stringify(l)), after: after });
    });
    assigning = false;
    if (!changes.length){ assignMsg = 'Already in ' + group + '.'; renderBar(); return; }
    var n = ids.size;
    OM.withBusy(function(){
      return OM.commitChanges(changes, 'Added ' + n + ' selected entit' + (n === 1 ? 'y' : 'ies') + ' to group ' + group);
    }).then(function(res){
      assignMsg = res && res.failed ? 'Some changes could not be saved. Try again.' : 'Added to ' + group + ': ' + (res ? res.written : changes.length) + ' relationship' + (changes.length === 1 ? '' : 's') + ' updated.';
      renderBar();
    });
  });
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape' || !sel.size) return;
    if (document.querySelector('.context-menu:not([hidden])')) return;
    sel.clear(); assigning = false; assignMsg = ''; updateSelection();
  });

  // ---------- follow the map ----------
  document.addEventListener('om:change', function(){ refreshHighlight(); updateSelection(); });
  new MutationObserver(renderBar).observe(wrap, { attributes: true, attributeFilter: ['class'] });
})();
