/* Map / Table tabs for the Ownership Map.
 *
 * Adds a Map | Table switch to the floating view bar. The Table tab lists what the
 * map shows (same group, cluster, relationship and timeline filters) as two sortable,
 * searchable tables, Entities and Relationships, with CSV export. Clicking a row
 * opens its detail panel; the map-pin button jumps to it on the map.
 * Uses only window.OwnershipMap (see "Add-on API" in index.html).
 */
(function(){
  'use strict';
  var OM = window.OwnershipMap;
  var wrap = document.querySelector('.canvas-wrap'), bar = document.getElementById('viewBar');
  if (!OM || !wrap || !bar) return;
  var esc = OM.escapeHtml;
  var TAB_KEY = 'om-view-tab', KIND_KEY = 'om-table-kind';
  function load(k, d){ try { return localStorage.getItem(k) || d; } catch (e){ return d; } }
  function store(k, v){ try { localStorage.setItem(k, v); } catch (e){} }

  var wanted = load(TAB_KEY, 'map');          // the tab last chosen (may belong to a module still loading)
  var tab = 'map';                            // 'map' | 'table' | an added tab
  var extra = {};                             // tabs added by other modules: id -> { panel, show }
  var kind = load(KIND_KEY, 'entities');      // 'entities' | 'links'
  var sort = { entities: { key: 'name', dir: 1 }, links: { key: 'target', dir: 1 } };
  var query = '', dirty = true, rows = [], selected = null;

  // ---------- Tabs in the view bar ----------
  var tabs = document.createElement('div');
  tabs.className = 'segmented view-tabs';
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'View');
  tabs.innerHTML =
    '<button type="button" class="layout-btn" data-tab="map" title="The ownership map"><svg class="icon" aria-hidden="true"><use href="#i-graph"/></svg><span class="btn-label">Map</span></button>' +
    '<button type="button" class="layout-btn" data-tab="table" title="Everything on the map as tables"><svg class="icon" aria-hidden="true"><use href="#i-table"/></svg><span class="btn-label">Table</span></button>';
  var divider = document.createElement('span');
  divider.className = 'view-divider';
  divider.setAttribute('aria-hidden', 'true');
  bar.insertBefore(divider, bar.firstChild);
  bar.insertBefore(tabs, divider);
  var layoutSeg = bar.querySelector('[aria-label="Layout"]');
  if (layoutSeg && layoutSeg.nextElementSibling && layoutSeg.nextElementSibling.classList.contains('view-divider'))
    layoutSeg.nextElementSibling.classList.add('layout-divider');

  // ---------- Table panel ----------
  var panel = document.createElement('section');
  panel.className = 'overlay table-view';
  panel.id = 'tableView';
  panel.setAttribute('aria-label', 'Table view');
  panel.hidden = true;
  panel.innerHTML =
    '<div class="tv-head">' +
      '<div class="segmented" role="group" aria-label="Table">' +
        '<button type="button" class="type-btn" data-kind="entities">Entities</button>' +
        '<button type="button" class="type-btn" data-kind="links">Relationships</button>' +
      '</div>' +
      '<div class="search-wrap"><svg class="icon" aria-hidden="true"><use href="#i-search"/></svg>' +
        '<input class="well" type="search" id="tvSearch" placeholder="Filter rows" aria-label="Filter the table" autocomplete="off"></div>' +
      '<button type="button" class="text-btn text-btn--sm" id="tvExport"><svg class="icon" aria-hidden="true"><use href="#i-download"/></svg><span class="btn-label">CSV</span></button>' +
      '<span class="tv-count" id="tvCount" aria-live="polite"></span>' +
    '</div>' +
    '<div class="tv-scroll" id="tvScroll"><table class="tv-table" id="tvTable"><caption class="sr-only" id="tvCaption"></caption><thead></thead><tbody></tbody></table></div>';
  wrap.appendChild(panel);
  var $ = function(id){ return document.getElementById(id); };
  var table = $('tvTable'), thead = table.tHead, tbody = table.tBodies[0];

  // ---------- Data ----------
  var COLS = {
    entities: [
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'groups', label: 'Groups', wrap: true },
      { key: 'clusters', label: 'Commodity' },
      { key: 'owners', label: 'Shareholders', num: true, title: 'Shareholders recorded for this company' },
      { key: 'board', label: 'Board', num: true, title: 'Directors and commissioners recorded for this company' },
      { key: 'stakes', label: 'Stakes %', num: true, title: 'Recent recorded stakes in this company, added up' },
      { key: 'holdings', label: 'Holdings', num: true, title: 'Companies this entity holds shares in' },
      { key: 'roles', label: 'Roles', num: true, title: 'Board seats this entity holds' },
      { key: 'latest', label: 'Latest data', title: 'Most recent date on its relationships' },
      { key: 'sources', label: 'Sources', num: true },
    ],
    links: [
      { key: 'source', label: 'From' },
      { key: 'target', label: 'To' },
      { key: 'type', label: 'Type' },
      { key: 'what', label: 'Stake / role' },
      { key: 'status', label: 'Status' },
      { key: 'dates', label: 'Dates seen' },
      { key: 'groups', label: 'Groups', wrap: true },
      { key: 'sources', label: 'Sources', wrap: true },
    ],
  };
  function visibleLinks(){ return OM.graph.links.filter(OM.linkPassesFilter); }
  function masterLink(id){ return OM.master.links.get(id) || {}; }
  function dateKey(d){ return d ? OM.dateSortKey(d) : 0; }
  function datesText(seen){
    if (!seen || !seen.length) return '';
    var a = OM.formatDate(seen[0]), b = OM.formatDate(seen[seen.length - 1]);
    return a === b ? a : a + ' – ' + b;
  }
  function uniq(list){ return Array.from(new Set(list.filter(Boolean))).sort(function(a, b){ return a.localeCompare(b); }); }

  function entityRows(){
    var links = visibleLinks(), by = new Map();
    OM.graph.nodes.forEach(function(n){
      var e = OM.master.entities.get(n.id) || {};
      by.set(n.id, { id: n.id, name: n.name, type: n.type, groups: [], clusters: (e.clusters || []).slice(),
        owners: 0, board: 0, stakes: null, holdings: 0, roles: 0, latest: null, sources: new Set(), touched: false });
    });
    links.forEach(function(l){
      var ends = OM.linkEnds(l), s = by.get(ends[0]), t = by.get(ends[1]), m = masterLink(l.id);
      [s, t].forEach(function(r){
        if (!r) return;
        r.touched = true;
        (m.groups || []).forEach(function(g){ if (r.groups.indexOf(g) < 0) r.groups.push(g); });
        (m.citations || []).forEach(function(c){ r.sources.add(c.text); });
        if (l.date && dateKey(l.date) > dateKey(r.latest)) r.latest = l.date;
      });
      if (l.type === 'ownership'){
        if (t){ t.owners++; if (l.status !== 'previous' && typeof l.value === 'number') t.stakes = (t.stakes || 0) + l.value; }
        if (s) s.holdings++;
      } else {
        if (t) t.board++;
        if (s) s.roles++;
      }
    });
    return Array.from(by.values()).map(function(r){
      var company = r.type === 'company';
      return {
        id: r.id, name: r.name,
        type: company ? 'Company' : 'Individual',
        groups: r.groups.sort().join('; '), clusters: r.clusters.join('; '),
        owners: company ? r.owners : null, board: company ? r.board : null,
        stakes: company && r.stakes != null ? Math.round(r.stakes * 100) / 100 : null,
        holdings: r.holdings, roles: r.roles,
        latest: r.latest ? OM.formatDate(r.latest) : '', latestSort: dateKey(r.latest),
        sources: r.sources.size,
      };
    });
  }
  function linkRows(){
    return visibleLinks().map(function(l){
      var ends = OM.linkEnds(l), m = masterLink(l.id);
      var cites = (m.citations || []).map(function(c){ return c.text + (c.date ? ' (' + OM.fmtMonth(c.date) + ')' : ''); });
      return {
        id: l.id, sourceId: ends[0], targetId: ends[1],
        source: OM.entityName(ends[0]), target: OM.entityName(ends[1]),
        type: l.type === 'ownership' ? 'Shareholding' : 'Board role',
        what: l.type === 'ownership' ? (typeof l.value === 'number' ? l.value + '%' : 'stake, % unknown') : OM.canonRole(l.role || ''),
        whatSort: l.type === 'ownership' ? (typeof l.value === 'number' ? l.value : -1) : OM.canonRole(l.role || ''),
        status: l.status === 'previous' ? 'Previous' : 'Recent',
        dates: datesText(l.seen), datesSort: dateKey(l.date),
        groups: (m.groups || []).slice().sort().join('; '),
        sources: cites.join('; '),
      };
    });
  }

  // ---------- Render ----------
  function sortValue(r, key){
    if (key === 'latest') return r.latestSort;
    if (key === 'dates') return r.datesSort;
    if (key === 'what') return r.whatSort;
    return r[key];
  }
  function compare(a, b, key, dir){
    var x = sortValue(a, key), y = sortValue(b, key);
    var xn = x == null || x === '', yn = y == null || y === '';
    if (xn || yn) return xn && yn ? 0 : xn ? 1 : -1;          // blanks last, whatever the direction
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  }
  function matches(r, cols, q){
    if (!q) return true;
    return cols.some(function(c){ var v = r[c.key]; return v != null && String(v).toLowerCase().indexOf(q) >= 0; });
  }
  function cell(r, c){
    var v = r[c.key], cls = (c.num ? 'num ' : '') + (c.wrap ? 'wrap ' : '');
    if (v == null || v === '') return '<td class="' + cls + 'muted">—</td>';
    var html = esc(String(v));
    if (c.key === 'name' || (kind === 'links' && (c.key === 'source' || c.key === 'target'))) {
      html = '<span class="tv-name">' + html + '</span>';
      if (c.key !== 'target') html += '<button type="button" class="tv-onmap" data-onmap="' + esc(r.id) +
        '" title="Show on the map" aria-label="Show ' + esc(String(v)) + ' on the map"><svg class="icon" aria-hidden="true"><use href="#i-viewfinder"/></svg></button>';
    }
    if (c.key === 'type' && kind === 'entities') html = '<span class="tv-type">' + html + '</span>';
    if (c.key === 'status' && v === 'Previous') html = '<span class="tv-prev">' + html + '</span>';
    if (c.key === 'stakes') html += '%';
    return '<td class="' + cls + '"' + (c.key === 'sources' && kind === 'links' ? ' title="' + esc(String(v)) + '"' : '') + '>' + html + '</td>';
  }
  function render(){
    dirty = false;
    var cols = COLS[kind], st = sort[kind];
    panel.querySelectorAll('[data-kind]').forEach(function(b){
      var on = b.dataset.kind === kind; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var all = kind === 'entities' ? entityRows() : linkRows();
    var q = query.trim().toLowerCase();
    rows = all.filter(function(r){ return matches(r, cols, q); })
      .sort(function(a, b){ return compare(a, b, st.key, st.dir) || compare(a, b, kind === 'entities' ? 'name' : 'source', 1); });
    $('tvCaption').textContent = kind === 'entities' ? 'Entities on the map' : 'Relationships on the map';
    var asOf = OM.getAsOf && OM.getAsOf().key, asOfText = '';
    if (asOf != null){ var y = Math.floor((asOf - 1) / 12), m = asOf - y * 12; asOfText = ' · as of ' + OM.formatDate({ year: y, month: m }); }
    $('tvCount').textContent = (rows.length === all.length ? all.length : rows.length + ' of ' + all.length) + ' ' + (kind === 'entities' ? 'entities' : 'relationships') + asOfText;
    thead.innerHTML = '<tr>' + cols.map(function(c){
      var s = st.key === c.key ? ' aria-sort="' + (st.dir > 0 ? 'ascending' : 'descending') + '"' : '';
      return '<th scope="col" class="' + (c.num ? 'num' : '') + '" data-sort="' + c.key + '"' + s + (c.title ? ' title="' + esc(c.title) + '"' : '') +
        ' tabindex="0">' + esc(c.label) + '<span class="tv-arrow"></span></th>';
    }).join('') + '</tr>';
    tbody.innerHTML = rows.length ? rows.map(function(r, i){
      return '<tr data-i="' + i + '" tabindex="0"' + (selected === r.id ? ' class="selected"' : '') + '>' + cols.map(function(c){ return cell(r, c); }).join('') + '</tr>';
    }).join('') : '<tr><td class="tv-empty" colspan="' + cols.length + '">' + (q ? 'No rows match “' + esc(query.trim()) + '”.' : 'Nothing on the map with the filters shown.') + '</td></tr>';
  }

  // ---------- Switching ----------
  function setTab(t, chosen){
    tab = t === 'table' || extra[t] ? t : 'map';
    if (chosen){ wanted = tab; store(TAB_KEY, tab); }
    tabs.querySelectorAll('[data-tab]').forEach(function(b){
      var on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var empty = wrap.classList.contains('is-empty');
    wrap.classList.toggle('table-mode', tab !== 'map');
    panel.hidden = tab !== 'table' || empty;
    Object.keys(extra).forEach(function(id){ extra[id].panel.hidden = tab !== id || empty; });
    document.dispatchEvent(new CustomEvent('om:tab', { detail: { tab: tab } }));
    if (empty) return;
    if (tab === 'table') render();
    else if (extra[tab]) extra[tab].show();
  }
  tabs.addEventListener('click', function(e){ var b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab, true); });
  // Other modules add a tab with its own panel (an .overlay.table-view section in the map area).
  window.OwnershipMapTabs = {
    add: function(def){
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'layout-btn'; b.dataset.tab = def.id; b.title = def.title || '';
      b.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#' + def.icon + '"/></svg><span class="btn-label">' + esc(def.label) + '</span>';
      tabs.appendChild(b);
      def.panel.hidden = true;
      wrap.appendChild(def.panel);
      extra[def.id] = { panel: def.panel, show: def.show || function(){} };
      if (wanted === def.id) setTab(def.id);
    },
    current: function(){ return tab; },
    // Show the Table tab on one of its tables, filtered by a text.
    openTable: function(k, q){
      kind = k === 'links' ? 'links' : 'entities'; store(KIND_KEY, kind);
      query = q || ''; var i = $('tvSearch'); if (i) i.value = query;
      selected = null; setTab('table', true); $('tvScroll').scrollTop = 0;
    },
    show: function(id){ setTab(id, true); },
  };
  panel.querySelector('[aria-label="Table"]').addEventListener('click', function(e){
    var b = e.target.closest('[data-kind]'); if (!b) return;
    kind = b.dataset.kind; store(KIND_KEY, kind); selected = null; render();
    $('tvScroll').scrollTop = 0;
  });
  $('tvSearch').addEventListener('input', function(e){ query = e.target.value; render(); });
  thead.addEventListener('click', onSort);
  thead.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); onSort(e); } });
  function onSort(e){
    var th = e.target.closest('[data-sort]'); if (!th) return;
    var st = sort[kind];
    if (st.key === th.dataset.sort) st.dir = -st.dir; else { st.key = th.dataset.sort; st.dir = 1; }
    render();
  }
  function openRow(r, onMap){
    selected = r.id;
    if (kind === 'entities'){
      if (onMap){ setTab('map', true); OM.focusNode(r.id); }
      else OM.selectNode(r.id);
    } else {
      if (onMap){ setTab('map', true); OM.selectLink(r.id); OM.centerOnNode(r.targetId); }
      else OM.selectLink(r.id);
    }
    if (!onMap) tbody.querySelectorAll('tr.selected').forEach(function(tr){ tr.classList.remove('selected'); });
    var tr = tbody.querySelector('tr[data-i="' + rows.indexOf(r) + '"]'); if (tr && !onMap) tr.classList.add('selected');
  }
  tbody.addEventListener('click', function(e){
    var tr = e.target.closest('tr[data-i]'); if (!tr) return;
    openRow(rows[+tr.dataset.i], !!e.target.closest('[data-onmap]'));
  });
  tbody.addEventListener('keydown', function(e){
    var tr = e.target.closest('tr[data-i]'); if (!tr || e.key !== 'Enter') return;
    e.preventDefault(); openRow(rows[+tr.dataset.i], false);
  });

  // ---------- CSV ----------
  function csvCell(v){ var s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  $('tvExport').addEventListener('click', function(){
    var cols = COLS[kind];
    var lines = [cols.map(function(c){ return csvCell(c.label); }).join(',')]
      .concat(rows.map(function(r){ return cols.map(function(c){ return csvCell(r[c.key]); }).join(','); }));
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'ownership-map-' + (kind === 'entities' ? 'entities' : 'relationships') + '-table-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
  });

  // ---------- Follow the app ----------
  document.addEventListener('om:change', function(){
    dirty = true;
    if (tab === 'table' && !panel.hidden) render();
  });
  // While the empty state shows (no data yet) there is nothing to tabulate.
  var wasEmpty = null;
  new MutationObserver(function(){
    var empty = wrap.classList.contains('is-empty');
    if (empty !== wasEmpty){ wasEmpty = empty; setTab(tab); }
  }).observe(wrap, { attributes: true, attributeFilter: ['class'] });

  setTab(wanted);
})();
