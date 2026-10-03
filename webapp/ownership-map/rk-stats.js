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
      if (l.seen && l.seen.length){ withDate++; var y = yearOf(l.seen[0]); if (y){ if (!years.has(y)) years.set(y, { cur: 0, prev: 0 }); years.get(y)[l.status === 'previous' ? 'prev' : 'cur']++; } }
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
    S.years = [];
    if (years.size){
      var ys = Array.from(years.keys()), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      for (var yy = y0; yy <= y1; yy++) S.years.push([yy, years.get(yy) || { cur: 0, prev: 0 }]);
    }
    return S;
  }

  // ---------- charts (plain HTML + CSS; colours are role tokens in rk-ui.css) ----------
  // Forms: KPI tiles and two-part split bars (overview), meters (coverage), columns on an
  // ordinal ramp (concentration), stacked columns (years), ranked bars (top lists),
  // stacked bars (groups). Every chart has a table twin behind the card's Table button,
  // and every mark shows its value on hover or keyboard focus.
  function nameBtn(id){ return '<button type="button" class="link-btn st-ent" data-ent="' + esc(id) + '" title="' + esc(OM.entityName(id)) + '">' + esc(OM.entityName(id)) + '</button>'; }
  function tipAttr(value, label){ return ' tabindex="0" data-tip-v="' + esc(String(value)) + '" data-tip-l="' + esc(label) + '"'; }
  function nf(n){ return Number(n).toLocaleString('en-US'); }
  function niceMax(mx){
    if (mx <= 4) return { max: Math.max(1, mx), step: 1 };
    var raw = mx / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
    return { max: Math.ceil(mx / step) * step, step: step };
  }
  function legend(items){
    return '<ul class="st-legend">' + items.map(function(i){ return '<li><i class="st-sw ' + i.cls + '"></i>' + esc(i.label) + (i.value != null ? ' <b>' + esc(nf(i.value)) + '</b>' : '') + '</li>'; }).join('') + '</ul>';
  }
  // one 100% bar split into two parts, with a legend that carries the numbers
  function split(title, a, b){
    var t = a.value + b.value, pa = t ? a.value / t * 100 : 0;
    return '<div class="st-split"><div class="st-split-top"><span>' + esc(title) + '</span><span class="st-muted">' + nf(t) + '</span></div>' +
      '<div class="st-split-bar">' +
        (a.value ? '<i class="s1" style="flex-basis:' + pa + '%"' + tipAttr(nf(a.value) + ' (' + Math.round(pa) + '%)', a.label) + '></i>' : '') +
        (b.value ? '<i class="s2" style="flex-basis:' + (100 - pa) + '%"' + tipAttr(nf(b.value) + ' (' + Math.round(100 - pa) + '%)', b.label) + '></i>' : '') +
      '</div>' + legend([{ cls: 's1', label: a.label, value: a.value }, { cls: 's2', label: b.label, value: b.value }]) + '</div>';
  }
  function meters(rows){
    return '<ul class="st-meters">' + rows.map(function(r){
      var p = pc(r[1], r[2]);
      return '<li><span class="st-m-label">' + esc(r[0]) + '</span><span class="st-m-val"><b>' + p + '%</b> <span class="st-muted">' + nf(r[1]) + ' of ' + nf(r[2]) + '</span></span>' +
        '<span class="st-m-track"' + tipAttr(p + '% (' + nf(r[1]) + ' of ' + nf(r[2]) + ')', r[0]) + '><i style="width:' + p + '%"></i></span></li>';
    }).join('') + '</ul>';
  }
  // ranked horizontal bars, one series: value at the tip
  function ranked(rows, opts){
    opts = opts || {};
    if (!rows.length) return '<p class="st-none">Nothing to show yet.</p>';
    var mx = Math.max.apply(null, rows.map(function(r){ return r.value; }).concat([1]));
    return '<ol class="st-rank' + (opts.noRank ? ' no-rank' : '') + '">' + rows.map(function(r, i){
      return '<li>' + (opts.noRank ? '' : '<span class="st-r-n">' + (i + 1) + '</span>') + '<span class="st-r-label" title="' + esc(r.label) + '">' + (r.html || esc(r.label)) + '</span>' +
        '<span class="st-r-track"><i class="' + (r.muted ? 'mut' : 's1') + '" style="width:' + Math.max(1.5, r.value / mx * 100) + '%"' + tipAttr(r.text, r.label) + '></i></span>' +
        '<b class="st-r-v">' + esc(r.short != null ? r.short : nf(r.value)) + '</b></li>';
    }).join('') + '</ol>';
  }
  // vertical columns; each column is a list of segments [{v, cls, label}] stacked from the baseline
  function columns(cols, opts){
    opts = opts || {};
    if (!cols.length) return '<p class="st-none">Nothing to show yet.</p>';
    var mx = Math.max.apply(null, cols.map(function(c){ return c.segs.reduce(function(a, x){ return a + x.v; }, 0); }).concat([1]));
    var sc = niceMax(mx), ticks = [];
    for (var v = 0; v <= sc.max + 1e-9; v += sc.step) ticks.push(v);
    var every = cols.length > 16 ? Math.ceil(cols.length / 12) : 1;
    var h = '<div class="st-cols' + (cols.length > 10 ? ' dense' : '') + '"><div class="st-c-plot">' +
      ticks.map(function(t){ return '<span class="st-c-grid" style="bottom:' + (t / sc.max * 100) + '%"><em>' + nf(t) + '</em></span>'; }).join('') +
      '<div class="st-c-bars">' + cols.map(function(c){
        var tot = c.segs.reduce(function(a, x){ return a + x.v; }, 0);
        var tip = c.segs.length > 1 ? c.segs.map(function(x){ return x.label + ' ' + nf(x.v); }).join(' · ') : nf(tot);
        return '<div class="st-c-col"' + tipAttr(tip, c.label) + '><div class="st-c-stack" style="height:' + (tot / sc.max * 100) + '%">' +
          (opts.capLabels && tot ? '<b class="st-c-cap">' + nf(tot) + '</b>' : '') +
          c.segs.slice().reverse().map(function(x){ return x.v ? '<i class="' + x.cls + '" style="flex-grow:' + x.v + '"></i>' : ''; }).join('') + '</div></div>';
      }).join('') + '</div></div>' +
      '<div class="st-c-x">' + cols.map(function(c, i){ return '<span>' + (i % every === 0 ? esc(c.label) : '') + '</span>'; }).join('') + '</div></div>';
    return h;
  }
  // horizontal stacked bars (two parts), total at the tip
  function stacked(rows, a, b){
    if (!rows.length) return '<p class="st-none">Nothing to show yet.</p>';
    var mx = Math.max.apply(null, rows.map(function(r){ return r.a + r.b; }).concat([1]));
    return '<ol class="st-rank no-rank">' + rows.map(function(r){
      var t = r.a + r.b;
      return '<li><span class="st-r-label">' + esc(r.label) + '</span><span class="st-r-track"><span class="st-r-stack" style="width:' + Math.max(1.5, t / mx * 100) + '%">' +
        (r.a ? '<i class="s1" style="flex-grow:' + r.a + '"' + tipAttr(nf(r.a), r.label + ' · ' + a) + '></i>' : '') +
        (r.b ? '<i class="s2" style="flex-grow:' + r.b + '"' + tipAttr(nf(r.b), r.label + ' · ' + b) + '></i>' : '') + '</span></span><b class="st-r-v">' + nf(t) + '</b></li>';
    }).join('') + '</ol>' + legend([{ cls: 's1', label: a }, { cls: 's2', label: b }]);
  }
  function tableHtml(head, rows){
    return '<table class="st-table"><thead><tr>' + head.map(function(c, i){ return '<th' + (i ? ' class="num"' : '') + '>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function(r){ return '<tr>' + r.map(function(c, i){ return '<td' + (i ? ' class="num"' : '') + '>' + esc(String(c)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }
  var showTable = {};
  function card(id, title, chart, hint, table, wide){
    var t = !!showTable[id];
    return '<section class="st-card' + (wide ? ' wide' : '') + (t ? ' show-table' : '') + '" data-card="' + id + '"><div class="st-card-head"><div><h3>' + esc(title) + '</h3>' +
      (hint ? '<p class="st-hint">' + esc(hint) + '</p>' : '') + '</div>' +
      (table ? '<button type="button" class="st-tv-btn" data-tv="' + id + '" aria-pressed="' + t + '" title="Switch between the chart and its numbers">' + (t ? 'Chart' : 'Table') + '</button>' : '') + '</div>' +
      '<div class="st-chart">' + chart + '</div>' + (table ? '<div class="st-tablev">' + table + '</div>' : '') + '</section>';
  }
  function section(t, sub){ return '<header class="st-section"><h2>' + esc(t) + '</h2><p>' + esc(sub) + '</p></header>'; }
  function kpi(n, label){ return '<div class="st-kpi"><b>' + esc(nf(n)) + '</b><span>' + esc(label) + '</span></div>'; }
  function plural(n, one, many){ return nf(n) + ' ' + (n === 1 ? one : many); }
  function entRanked(list, one, many){ return list.map(function(x){ return { html: nameBtn(x[0]), label: OM.entityName(x[0]), value: x[1], text: plural(x[1], one, many) }; }); }
  function entTable(list, col){ return tableHtml(['Name', col], list.map(function(x){ return [OM.entityName(x[0]), x[1]]; })); }

  var last = null;
  function render(){
    if (!visible()) return;
    var S = last = compute();
    var asOf = OM.getAsOf().key != null ? ' · as of a past month' : '';
    $('stScope').textContent = S.nodes + ' entities · ' + S.links + ' relationships on the map now' + asOf + '. Filters apply.';
    var h = '<div class="st-grid">';
    h += card('overview', 'Overview',
      '<div class="st-kpis">' + kpi(S.companies, 'companies') + kpi(S.people, 'individuals') + kpi(S.own, 'shareholdings') + kpi(S.dir, 'board roles') +
        kpi(S.cur, 'current') + kpi(S.prev, 'previous') + kpi(S.bo, 'beneficial owners (over 25%)') + kpi(S.openTop, 'owners not recorded') + '</div>' +
      '<div class="st-splits">' + split('Entities', { label: 'Companies', value: S.companies }, { label: 'Individuals', value: S.people }) +
        split('Relationships', { label: 'Shareholdings', value: S.own }, { label: 'Board roles', value: S.dir }) +
        split('Status', { label: 'Current', value: S.cur }, { label: 'Previous', value: S.prev }) + '</div>',
      'Beneficial owner: an individual with over 25%, directly or through companies. Owner not recorded: a company that owns others but has no recorded owner.', null, true);
    h += section('Data', 'How complete the records are, and how concentrated ownership is.');
    h += card('coverage', 'Data coverage', meters(S.coverage), 'Share of the data that is filled in. Short bars show where research is still needed.',
      tableHtml(['Measure', 'Share', 'Count', 'Of'], S.coverage.map(function(c){ return [c[0], pc(c[1], c[2]) + '%', c[1], c[2]]; })));
    var ramp = ['mut', 'mut', 'o1', 'o2', 'o3', 'o4'], short = ['None recorded', '% unknown', 'Under 25%', '25–50%', '50–75%', 'Over 75%'];
    h += card('concentration', 'Ownership concentration',
      columns(S.concentration.map(function(b, i){ return { label: short[i], segs: [{ v: b[1], cls: ramp[i], label: b[0] }] }; }), { capLabels: true }),
      'Companies by the size of their largest direct shareholder (current stakes). Gray: the size cannot be measured.',
      tableHtml(['Largest direct holder', 'Companies'], S.concentration.map(function(b){ return [b[0], b[1]]; })));
    h += section('Ownership and control', 'Who sits at the top of the chains, and who holds the most.');
    h += card('control', 'Who controls most', ranked(entRanked(S.controllers, 'company', 'companies')),
      'Individuals by the number of companies they control with over 50% effective ownership. ' + plural(S.controllingPeople, 'individual controls', 'individuals control') + ' at least one.', entTable(S.controllers, 'Companies controlled'));
    h += card('bo', 'Largest beneficial owners', ranked(S.boList.map(function(x){ return { html: nameBtn(x[0]), label: OM.entityName(x[0]), value: x[1], text: x[1] + '%', short: x[1] + '%' }; })),
      'Highest effective stake an individual holds in any one company.', tableHtml(['Name', 'Highest effective stake (%)'], S.boList.map(function(x){ return [OM.entityName(x[0]), x[1]]; })));
    h += card('holdings', 'Most holdings', ranked(entRanked(S.holdersTop, 'holding', 'holdings')), 'Companies holding shares in the most other companies.', entTable(S.holdersTop, 'Holdings'));
    h += card('connected', 'Most connected', ranked(entRanked(S.connTop, 'relationship', 'relationships')), 'Entities with the most relationships of any kind.', entTable(S.connTop, 'Relationships'));
    h += section('Boards', 'Directors and commissioners, and the people who link boards.');
    h += card('boards', 'Boards', '<div class="st-kpis small">' + kpi(S.boardAvg, 'average board size') + kpi(S.interlock, 'people on 2+ boards') + kpi(S.seatPeople, 'people with a seat') + '</div>' +
      '<h4>Most board seats</h4>' + ranked(entRanked(S.seatTop, 'seat', 'seats')), 'Current directors and commissioners only.', entTable(S.seatTop, 'Seats'));
    h += card('boardsize', 'Largest boards', ranked(entRanked(S.boardTop, 'member', 'members')) + '<h4>Roles</h4>' + ranked(S.roles.map(function(r){ return { label: r[0], value: r[1], text: nf(r[1]) }; }), { noRank: true }), null,
      tableHtml(['Company or role', 'Count'], S.boardTop.map(function(x){ return [OM.entityName(x[0]), x[1]]; }).concat(S.roles.map(function(r){ return ['Role: ' + r[0], r[1]]; }))));
    h += section('Over time', 'When the relationships in the data were first seen.');
    h += card('years', 'Relationships by year first seen',
      columns(S.years.map(function(y){ return { label: String(y[0]), segs: [{ v: y[1].cur, cls: 's1', label: 'Current' }, { v: y[1].prev, cls: 's2', label: 'Previous' }] }; })) +
        (S.years.length ? legend([{ cls: 's1', label: 'Current' }, { cls: 's2', label: 'Previous' }]) : ''),
      'The year of the earliest date recorded for each relationship, split by its status now. Undated relationships are not counted.',
      tableHtml(['Year', 'Current', 'Previous', 'Total'], S.years.map(function(y){ return [y[0], y[1].cur, y[1].prev, y[1].cur + y[1].prev]; })), true);
    h += section('Groups and countries', 'How the data spreads over company groups and jurisdictions.');
    h += card('groups', 'Company groups', stacked(S.groups.map(function(g){ return { label: g.name, a: g.companies, b: g.people }; }), 'Companies', 'Individuals'),
      'Entities in each group. A group counts every entity on its relationships.',
      tableHtml(['Group', 'Entities', 'Companies', 'Individuals', 'Relationships'], S.groups.map(function(g){ return [g.name, g.ents, g.companies, g.people, g.links]; })));
    h += card('countries', 'Countries', ranked(S.countries.map(function(c){ return { label: c[0], value: c[1], text: plural(c[1], 'entity', 'entities'), muted: c[0] === 'Not recorded' }; }), { noRank: true }),
      'Entities by country (jurisdiction) from their Profile. Gray: not recorded yet.', tableHtml(['Country', 'Entities'], S.countries));
    panel.querySelector('#stBody').innerHTML = h + '</div>';
  }

  // one tooltip for every mark: value first, label after; same on keyboard focus
  var tip = document.createElement('div'); tip.className = 'st-tip'; tip.hidden = true; tip.setAttribute('role', 'tooltip');
  var tipV = document.createElement('b'), tipL = document.createElement('span'); tip.appendChild(tipV); tip.appendChild(tipL);
  panel.appendChild(tip);
  var shownAt = 0;
  function showTip(el, x, y){
    tipV.textContent = el.dataset.tipV; tipL.textContent = el.dataset.tipL; tip.hidden = false; shownAt = Date.now();
    var pr = panel.getBoundingClientRect(), w = tip.offsetWidth, hgt = tip.offsetHeight;
    if (x == null){ var r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; }
    tip.style.left = Math.min(Math.max(8, x - pr.left - w / 2), pr.width - w - 8) + 'px';
    tip.style.top = Math.max(8, y - pr.top - hgt - 10) + 'px';
  }
  panel.addEventListener('pointermove', function(e){ var el = e.target.closest('[data-tip-v]'); if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true; });
  panel.addEventListener('pointerleave', function(){ tip.hidden = true; });
  panel.addEventListener('focusin', function(e){ var el = e.target.closest('[data-tip-v]'); if (el) showTip(el); });
  panel.addEventListener('focusout', function(){ tip.hidden = true; });
  panel.addEventListener('scroll', function(){ if (Date.now() - shownAt > 250) tip.hidden = true; }, true);

  $('stBody').addEventListener('click', function(e){
    var t = e.target.closest('[data-tv]');
    if (t){ var id = t.dataset.tv, c = t.closest('.st-card'); showTable[id] = !showTable[id]; c.classList.toggle('show-table', showTable[id]); t.textContent = showTable[id] ? 'Chart' : 'Table'; t.setAttribute('aria-pressed', String(showTable[id])); return; }
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
    S.years.forEach(function(y){ add('Relationships by year first seen (current / previous)', y[0], y[1].cur + ' / ' + y[1].prev); });
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
