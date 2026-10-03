/* Statistics tab for the Ownership Map (add-on, uses window.OwnershipMap and window.OwnershipMapTabs).
 *
 * Aggregate figures for analysis over what the map holds now: the group, relationship,
 * timeline and as-of filters apply, exactly as in the Table tab. Sections: overview,
 * data coverage, how concentrated ownership is, who controls most, boards and interlocks,
 * company groups, countries, and when relationships were first seen. Names open the
 * detail panel. "Statistics CSV" saves every figure as section, label, value.
 */
(function(){
  'use strict';
  var OM = window.OwnershipMap, TABS = window.OwnershipMapTabs;
  if (!OM || !TABS) return;
  var esc = OM.escapeHtml, TOP = 10;

  var sprite = document.querySelector('svg.sprite');
  if (sprite) sprite.insertAdjacentHTML('beforeend', '<symbol id="i-chart" viewBox="0 0 16 16"><path d="M2.5 13.5h11M4.5 13V8M8 13V3.5M11.5 13V6"/></symbol>');

  var panel = document.createElement('section');
  panel.className = 'overlay table-view st-view'; panel.id = 'statsView'; panel.setAttribute('aria-label', 'Statistics');
  panel.innerHTML =
    '<div class="tv-head st-head"><span class="st-scope" id="stScope" aria-live="polite"></span>' +
    '<button type="button" class="text-btn text-btn--sm" id="stExport"><svg class="icon" aria-hidden="true"><use href="#i-download"/></svg><span class="btn-label">Statistics CSV</span></button></div>' +
    '<div class="tv-scroll st-body" id="stBody"></div>';
  var $ = function(id){ return document.getElementById(id); };
  TABS.add({ id: 'stats', label: 'Statistics', icon: 'i-chart', title: 'Aggregate figures for analysis', panel: panel, show: render });
  function visible(){ return TABS.current() === 'stats' && !panel.hidden; }

  // ---------- numbers ----------
  function pc(n, d){ return d ? Math.round(n / d * 100) : 0; }
  function yearOf(token){ var k = OM.dateSortKey(token); return k ? Math.floor((k - 1) / 12) : null; }
  function top(map, n){ return Array.from(map.entries()).filter(function(x){ return x[1] > 0; }).sort(function(a, b){ return b[1] - a[1] || OM.entityName(a[0]).localeCompare(OM.entityName(b[0])); }).slice(0, n); }
  function inc(map, k, by){ map.set(k, (map.get(k) || 0) + (by == null ? 1 : by)); }

  function compute(){
    var nodes = OM.graph.nodes, links = OM.graph.links.filter(OM.linkPassesFilter);
    var type = {}; nodes.forEach(function(n){ type[n.id] = n.type; });
    var comps = nodes.filter(function(n){ return n.type === 'company'; }), people = nodes.length - comps.length;
    var flags = OM.ownershipFlags();
    var S = { nodes: nodes.length, companies: comps.length, people: people, links: links.length, sections: [] };

    var own = [], dir = [], cur = 0, prev = 0, withSource = 0, withDate = 0;
    var ownersOf = new Map(), seatsOf = new Map(), boardOf = new Map(), holdsOf = new Map(), degree = new Map(), groups = new Map(), years = new Map();
    links.forEach(function(l){
      var ends = OM.linkEnds(l), m = OM.master.links.get(l.id) || {};
      (l.status === 'previous' ? (prev++, 0) : (cur++, 0));
      if ((m.citations || []).length) withSource++;
      if (l.seen && l.seen.length){ withDate++; var y = yearOf(l.seen[0]); if (y) inc(years, y); }
      inc(degree, ends[0]); inc(degree, ends[1]);
      (m.groups || []).forEach(function(g){
        if (!groups.has(g)) groups.set(g, { ents: new Set(), links: 0 });
        var x = groups.get(g); x.ents.add(ends[0]); x.ents.add(ends[1]); x.links++;
      });
      if (l.type === 'ownership'){
        own.push(l);
        if (l.status !== 'previous'){ if (!ownersOf.has(ends[1])) ownersOf.set(ends[1], []); ownersOf.get(ends[1]).push(l); inc(holdsOf, ends[0]); }
      } else {
        dir.push(l);
        if (l.status !== 'previous'){ inc(seatsOf, ends[0]); inc(boardOf, ends[1]); }
      }
    });
    S.own = own.length; S.dir = dir.length; S.cur = cur; S.prev = prev;
    S.pctSource = pc(withSource, links.length); S.pctDate = pc(withDate, links.length);

    // coverage among companies
    var withOwner = 0, complete = 0, withBoard = 0;
    comps.forEach(function(c){
      var ls = ownersOf.get(c.id) || [];
      if (ls.length) withOwner++;
      var known = ls.filter(function(l){ return typeof l.value === 'number'; });
      var sum = known.reduce(function(a, l){ return a + l.value; }, 0);
      if (known.length === ls.length && ls.length && sum >= 99.5 && sum <= 100.5) complete++;
      if (boardOf.get(c.id)) withBoard++;
    });
    var prof = { country: 0, address: 0, identity: 0 };
    nodes.forEach(function(n){ var e = OM.master.entities.get(n.id) || {}; if (e.country) prof.country++; if (e.address) prof.address++; if ((e.identities || []).length) prof.identity++; });
    S.coverage = [
      ['Companies with a current shareholder recorded', withOwner, comps.length],
      ['Companies whose recorded stakes add up to 100%', complete, comps.length],
      ['Companies with a current director or commissioner', withBoard, comps.length],
      ['Relationships with a source', withSource, links.length],
      ['Relationships with a date', withDate, links.length],
      ['Entities with a country', prof.country, nodes.length],
      ['Entities with an address', prof.address, nodes.length],
      ['Entities with an identity number', prof.identity, nodes.length],
    ];

    // concentration: largest direct holder of each company
    var buckets = [['No shareholder recorded', 0], ['Largest holder unknown %', 0], ['Under 25%', 0], ['25% to 50%', 0], ['Over 50% to 75%', 0], ['Over 75%', 0]];
    comps.forEach(function(c){
      var ls = ownersOf.get(c.id) || [];
      if (!ls.length){ buckets[0][1]++; return; }
      var vals = ls.map(function(l){ return l.value; }).filter(function(v){ return typeof v === 'number'; });
      if (!vals.length){ buckets[1][1]++; return; }
      var mx = Math.max.apply(null, vals);
      buckets[mx > 75 ? 5 : mx > 50 ? 4 : mx > 25 ? 3 : 2][1]++;
    });
    S.concentration = buckets;
    var bo = 0; flags.bo.forEach(function(){ bo++; });
    S.bo = bo; S.openTop = flags.openTop.size;
    S.holdingCos = comps.filter(function(c){ return holdsOf.get(c.id); }).length;
    var controllers = new Map(); nodes.forEach(function(n){ if (n.type === 'person') controllers.set(n.id, flags.control.get(n.id) || 0); });
    S.controllers = top(controllers, TOP);
    var controllingPeople = 0; controllers.forEach(function(v){ if (v > 0) controllingPeople++; }); S.controllingPeople = controllingPeople;
    S.boList = top(new Map(Array.from(flags.bo.entries()).map(function(x){ return [x[0], Math.round(x[1] * 10) / 10]; })), TOP);

    // boards
    var seatPeople = new Map(); seatsOf.forEach(function(n, id){ if (type[id] === 'person') seatPeople.set(id, n); });
    var multi = 0; seatPeople.forEach(function(n){ if (n > 1) multi++; });
    var boardSizes = comps.map(function(c){ return boardOf.get(c.id) || 0; }).filter(function(n){ return n > 0; });
    S.boardAvg = boardSizes.length ? Math.round(boardSizes.reduce(function(a, b){ return a + b; }, 0) / boardSizes.length * 10) / 10 : 0;
    S.interlock = multi; S.seatPeople = seatPeople.size;
    S.seatTop = top(seatPeople, TOP);
    var boardTop = new Map(); comps.forEach(function(c){ if (boardOf.get(c.id)) boardTop.set(c.id, boardOf.get(c.id)); });
    S.boardTop = top(boardTop, TOP);
    var roles = new Map(); dir.forEach(function(l){ if (l.status !== 'previous') inc(roles, OM.canonRole(l.role || 'Director')); });
    S.roles = Array.from(roles.entries()).sort(function(a, b){ return b[1] - a[1]; }).slice(0, 8);
    var holders = new Map(); comps.forEach(function(c){ if (holdsOf.get(c.id)) holders.set(c.id, holdsOf.get(c.id)); });
    S.holdersTop = top(holders, TOP);
    var conn = new Map(); nodes.forEach(function(n){ conn.set(n.id, degree.get(n.id) || 0); });
    S.connTop = top(conn, TOP);

    // groups, countries, years
    S.groups = Array.from(groups.entries()).map(function(g){
      var cs = 0, ps = 0; g[1].ents.forEach(function(id){ if (type[id] === 'company') cs++; else if (type[id] === 'person') ps++; });
      return { name: g[0], ents: g[1].ents.size, companies: cs, people: ps, links: g[1].links };
    }).sort(function(a, b){ return b.ents - a.ents || a.name.localeCompare(b.name); });
    var countries = new Map();
    nodes.forEach(function(n){ inc(countries, ((OM.master.entities.get(n.id) || {}).country || '').trim() || 'Not recorded'); });
    S.countries = Array.from(countries.entries()).sort(function(a, b){ return (a[0] === 'Not recorded') - (b[0] === 'Not recorded') || b[1] - a[1] || a[0].localeCompare(b[0]); });
    S.years = Array.from(years.entries()).sort(function(a, b){ return a[0] - b[0]; });
    return S;
  }

  // ---------- html ----------
  function nameBtn(id){ return '<button type="button" class="link-btn st-ent" data-ent="' + esc(id) + '">' + esc(OM.entityName(id)) + '</button>'; }
  function bars(rows, opts){
    opts = opts || {}; var mx = Math.max.apply(null, rows.map(function(r){ return r.value; }).concat([1]));
    if (!rows.length) return '<p class="st-none">Nothing to show.</p>';
    return '<ul class="st-bars">' + rows.map(function(r){
      return '<li><span class="st-label">' + (r.html || esc(r.label)) + '</span><span class="st-track"><i style="width:' + Math.max(1, Math.round(r.value / mx * 100)) + '%"></i></span><b>' + esc(r.text != null ? r.text : String(r.value)) + '</b></li>';
    }).join('') + '</ul>';
  }
  function entRows(list, one, many){ return list.map(function(x){ return { html: nameBtn(x[0]), label: OM.entityName(x[0]), value: x[1], text: x[1] + ' ' + (x[1] === 1 ? one : many) }; }); }
  function card(title, body, hint, wide){
    return '<section class="st-card' + (wide ? ' wide' : '') + '"><h3>' + esc(title) + '</h3>' + (hint ? '<p class="st-hint">' + esc(hint) + '</p>' : '') + body + '</section>';
  }
  function kpi(n, label){ return '<div class="st-kpi"><b>' + esc(String(n)) + '</b><span>' + esc(label) + '</span></div>'; }

  var last = null;
  function render(){
    if (!visible()) return;
    var S = last = compute();
    var asOf = OM.getAsOf().key != null ? ' · as of a past month' : '';
    $('stScope').textContent = S.nodes + ' entities · ' + S.links + ' relationships on the map now' + asOf + '. Filters apply.';
    var h = '<div class="st-grid">';
    h += card('Overview', '<div class="st-kpis">' + kpi(S.companies, 'companies') + kpi(S.people, 'individuals') + kpi(S.own, 'shareholdings') + kpi(S.dir, 'board roles') +
      kpi(S.cur, 'current') + kpi(S.prev, 'previous') + kpi(S.bo, 'beneficial owners (over 25%)') + kpi(S.openTop, 'owners not recorded') + '</div>',
      'Beneficial owner: an individual with over 25%, directly or through companies. Owner not recorded: a company that owns others but has no recorded owner.', true);
    h += card('Data coverage', bars(S.coverage.map(function(c){ return { label: c[0], value: pc(c[1], c[2]), text: pc(c[1], c[2]) + '%  (' + c[1] + ' of ' + c[2] + ')' }; })), 'Share of the data that is filled in. Low values show where research is still needed.');
    h += card('Ownership concentration', bars(S.concentration.map(function(b){ return { label: b[0], value: b[1] }; })), 'Companies grouped by the size of their largest direct shareholder (current stakes only).');
    h += card('Who controls most', bars(entRows(S.controllers, 'company', 'companies')), 'Individuals by the number of companies they control with over 50% effective ownership. ' + S.controllingPeople + (S.controllingPeople === 1 ? ' individual controls' : ' individuals control') + ' at least one.');
    h += card('Largest beneficial owners', bars(S.boList.map(function(x){ return { html: nameBtn(x[0]), label: OM.entityName(x[0]), value: x[1], text: x[1] + '%' }; })), 'Highest effective stake an individual holds in any one company.');
    h += card('Most holdings', bars(entRows(S.holdersTop, 'holding', 'holdings')), 'Companies holding shares in the most other companies.');
    h += card('Boards', '<div class="st-kpis small">' + kpi(S.boardAvg, 'average board size') + kpi(S.interlock, 'people on 2+ boards') + kpi(S.seatPeople, 'people with a seat') + '</div>' +
      '<h4>Most board seats</h4>' + bars(entRows(S.seatTop, 'seat', 'seats')), 'Current directors and commissioners only.');
    h += card('Largest boards', bars(entRows(S.boardTop, 'member', 'members')) + '<h4>Roles</h4>' + bars(S.roles.map(function(r){ return { label: r[0], value: r[1] }; })));
    h += card('Most connected', bars(entRows(S.connTop, 'link', 'links')), 'Entities with the most relationships of any kind.');
    h += card('Company groups', S.groups.length ? '<table class="st-table"><thead><tr><th>Group</th><th class="num">Entities</th><th class="num">Companies</th><th class="num">Individuals</th><th class="num">Relationships</th></tr></thead><tbody>' +
      S.groups.map(function(g){ return '<tr><td>' + esc(g.name) + '</td><td class="num">' + g.ents + '</td><td class="num">' + g.companies + '</td><td class="num">' + g.people + '</td><td class="num">' + g.links + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="st-none">No groups yet.</p>', null, true);
    h += card('Countries', bars(S.countries.map(function(c){ return { label: c[0], value: c[1] }; })), 'Entities by country (jurisdiction) from their Profile.');
    h += card('Relationships by year first seen', bars(S.years.map(function(y){ return { label: String(y[0]), value: y[1] }; })), 'The year of the earliest date recorded for each relationship. Undated relationships are not counted.');
    panel.querySelector('#stBody').innerHTML = h + '</div>';
  }

  $('stBody').addEventListener('click', function(e){
    var b = e.target.closest('[data-ent]'); if (b) OM.selectNode(b.dataset.ent);
  });
  $('stExport').addEventListener('click', function(){
    if (!last) render(); var S = last; if (!S) return;
    var rows = [['section', 'label', 'value']];
    var add = function(sec, label, v){ rows.push([sec, label, v]); };
    [['entities', S.nodes], ['companies', S.companies], ['individuals', S.people], ['relationships', S.links], ['shareholdings', S.own], ['board roles', S.dir], ['current', S.cur], ['previous', S.prev], ['beneficial owners over 25%', S.bo], ['owners not recorded', S.openTop]].forEach(function(x){ add('Overview', x[0], x[1]); });
    S.coverage.forEach(function(c){ add('Data coverage', c[0], pc(c[1], c[2]) + '% (' + c[1] + ' of ' + c[2] + ')'); });
    S.concentration.forEach(function(b){ add('Ownership concentration', b[0], b[1]); });
    S.controllers.forEach(function(x){ add('Controls most companies', OM.entityName(x[0]), x[1]); });
    S.boList.forEach(function(x){ add('Largest beneficial owners (%)', OM.entityName(x[0]), x[1]); });
    S.holdersTop.forEach(function(x){ add('Most holdings', OM.entityName(x[0]), x[1]); });
    S.seatTop.forEach(function(x){ add('Most board seats', OM.entityName(x[0]), x[1]); });
    S.boardTop.forEach(function(x){ add('Largest boards', OM.entityName(x[0]), x[1]); });
    S.roles.forEach(function(r){ add('Roles', r[0], r[1]); });
    S.connTop.forEach(function(x){ add('Most connected', OM.entityName(x[0]), x[1]); });
    S.groups.forEach(function(g){ add('Groups: entities / companies / individuals / relationships', g.name, [g.ents, g.companies, g.people, g.links].join(' / ')); });
    S.countries.forEach(function(c){ add('Countries', c[0], c[1]); });
    S.years.forEach(function(y){ add('Relationships by year first seen', y[0], y[1]); });
    var cell = function(v){ var s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(function(r){ return r.map(cell).join(','); }).join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'ownership-map-statistics-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
  });
  var timer = null;
  function later(){ if (!visible()) return; clearTimeout(timer); timer = setTimeout(render, 150); }
  document.addEventListener('om:change', later);
  document.addEventListener('om:asof', later);
  document.addEventListener('om:tab', later);
})();
