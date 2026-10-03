/* Company report for the Ownership Map (add-on, uses window.OwnershipMap only).
 *
 * A printable summary of one company, built from the whole dataset (group, commodity and
 * as-of filters do not apply): who holds its shares, directly and through other companies,
 * which individuals pass the 25% beneficial owner test (Perpres 13/2018), its directors and
 * commissioners, what it holds, shared directors, points that need checking, and its sources.
 * "Print / Save as PDF" uses the browser's print dialog; only the report is printed.
 * Open from the entity detail panel, or OwnershipMapReport.open(entityId).
 */
(function(){
  'use strict';
  var OM = window.OwnershipMap;
  if (!OM) return;
  var esc = OM.escapeHtml, STALE_MONTHS = 12;

  function pct(v){ return (Math.round(v * 100) / 100) + '%'; }
  function seenText(l){
    var s = l.seen || [];
    if (!s.length) return '';
    var a = OM.formatDate(s[0]), b = OM.formatDate(s[s.length - 1]);
    return a === b ? a : a + ' – ' + b;
  }
  function monthsAgo(d){ var n = new Date(); return n.getFullYear() * 12 + n.getMonth() + 1 - OM.dateSortKey(d); }
  function table(head, rows, empty){
    if (!rows.length) return '<p class="rp-none">' + esc(empty) + '</p>';
    return '<table class="rp-table"><thead><tr>' + head.map(function(h){ return '<th' + (h.num ? ' class="num"' : '') + '>' + esc(h.t) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function(r){ return '<tr>' + r.map(function(c, i){ return '<td' + (head[i].num ? ' class="num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }

  // ---------- data ----------
  function collect(id){
    var g = OM.fullGraph(), M = OM.master;
    var nodes = new Map(g.nodes.map(function(n){ return [n.id, n]; }));
    var ents = M.entities, ml = function(l){ return M.links.get(l.id) || {}; };
    var recent = function(l){ return l.status !== 'previous'; };
    var ownIn = [], dirIn = [], ownOut = [], dirOut = [];
    g.links.forEach(function(l){
      var e = OM.linkEnds(l);
      if (l.type === 'ownership'){ if (e[1] === id) ownIn.push(l); if (e[0] === id) ownOut.push(l); }
      else { if (e[1] === id) dirIn.push(l); if (e[0] === id) dirOut.push(l); }
    });
    // Who holds how much of this company, directly or through chains of current known stakes.
    var byTarget = new Map();
    g.links.forEach(function(l){
      if (l.type !== 'ownership' || !recent(l) || typeof l.value !== 'number') return;
      var e = OM.linkEnds(l); if (!byTarget.has(e[1])) byTarget.set(e[1], []); byTarget.get(e[1]).push({ holder: e[0], v: l.value / 100 });
    });
    var holders = new Map();
    (function up(cur, frac, depth, seen){
      if (depth > 8) return;
      (byTarget.get(cur) || []).forEach(function(x){
        if (seen.has(x.holder)) return;
        var f = frac * x.v; holders.set(x.holder, (holders.get(x.holder) || 0) + f);
        var next = new Set(seen); next.add(x.holder); up(x.holder, f, depth + 1, next);
      });
    })(id, 1, 0, new Set([id]));
    var directHolders = new Set(ownIn.filter(recent).map(function(l){ return OM.linkEnds(l)[0]; }));
    var chain = Array.from(holders.entries()).map(function(h){ return { id: h[0], v: h[1] * 100, direct: directHolders.has(h[0]), person: (ents.get(h[0]) || {}).type === 'person' || (nodes.get(h[0]) || {}).type === 'person' }; })
      .sort(function(a, b){ return b.v - a.v; });
    var bo = chain.filter(function(h){ return h.person && h.v > 25; });
    // Latest date on any relationship of this company.
    var latest = null;
    ownIn.concat(dirIn).forEach(function(l){ if (l.date && (!latest || OM.dateSortKey(l.date) > OM.dateSortKey(latest))) latest = l.date; });
    // Other boards its current directors sit on.
    var shared = [];
    dirIn.filter(recent).forEach(function(l){
      var p = OM.linkEnds(l)[0];
      g.links.forEach(function(o){
        if (o.type !== 'directorship' || !recent(o)) return;
        var e = OM.linkEnds(o); if (e[0] === p && e[1] !== id) shared.push({ person: p, company: e[1], role: o.role });
      });
    });
    // Points to check.
    var pts = [], curStakes = ownIn.filter(recent), nums = curStakes.filter(function(l){ return typeof l.value === 'number'; });
    var total = Math.round(nums.reduce(function(s, l){ return s + l.value; }, 0) * 100) / 100;
    if (!ownIn.length) pts.push('No shareholders are recorded.');
    if (!dirIn.length) pts.push('No directors or commissioners are recorded.');
    if (nums.length && Math.abs(total - 100) > 0.5) pts.push('Current stakes add up to ' + pct(total) + ', not 100%' + (curStakes.length > nums.length ? ' (' + (curStakes.length - nums.length) + ' stake(s) have no percentage)' : '') + '.');
    else if (curStakes.length > nums.length) pts.push((curStakes.length - nums.length) + ' of ' + curStakes.length + ' current stakes have no percentage.');
    if (ownIn.length && !bo.length) pts.push('No individual holding more than 25% could be identified, directly or through companies.');
    var stops = chain.filter(function(h){ return !h.person && !(byTarget.get(h.id) || []).length; });
    if (stops.length) pts.push('The owners of ' + stops.map(function(h){ return OM.entityName(h.id); }).join(', ') + ' are not recorded, so the chain stops there.');
    if (!latest) pts.push('None of its relationships has a date.');
    else if (monthsAgo(latest) >= STALE_MONTHS) pts.push('The latest data is from ' + OM.formatDate(latest) + ' (' + monthsAgo(latest) + ' months ago); a newer company profile is needed.');
    if (ownIn.concat(dirIn).some(function(l){ return !(ml(l).citations || []).length; })) pts.push('Some relationships cite no source.');
    // Sources.
    var src = new Map();
    ownIn.concat(dirIn).concat(ownOut).forEach(function(l){ (ml(l).citations || []).forEach(function(c){ var k = c.text + '|' + (c.date || ''); if (!src.has(k)) src.set(k, { text: c.text, n: 0 }); src.get(k).n++; }); });
    return { g: g, ml: ml, ownIn: ownIn, dirIn: dirIn, ownOut: ownOut, dirOut: dirOut, chain: chain, bo: bo, latest: latest, shared: shared, pts: pts, total: total, sources: Array.from(src.values()).sort(function(a, b){ return b.n - a.n; }), nums: nums, curStakes: curStakes };
  }

  // ---------- report ----------
  function build(id){
    var d = collect(id), e = OM.master.entities.get(id) || { name: OM.entityName(id) };
    var groups = new Set(); d.ownIn.concat(d.dirIn, d.ownOut, d.dirOut).forEach(function(l){ (d.ml(l).groups || []).forEach(function(x){ groups.add(x); }); });
    var status = function(l){ return l.status === 'previous' ? 'Previous' : 'Current'; };
    var name = function(x){ return '<b>' + esc(OM.entityName(x)) + '</b>'; };
    var today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    var html =
      '<header class="rp-head"><div><h1>' + esc(e.name) + '</h1><p class="rp-sub">Company' + (groups.size ? ' · ' + Array.from(groups).sort().map(esc).join(', ') : '') + ((e.clusters || []).length ? ' · ' + e.clusters.map(esc).join(', ') : '') + '</p></div>' +
        '<div class="rp-meta"><div>Report of ' + esc(today) + '</div><div>Latest data: ' + (d.latest ? esc(OM.formatDate(d.latest)) : 'no dates recorded') + '</div></div></header>' +
      '<section class="rp-summary">' +
        '<div><b>' + d.ownIn.length + '</b><span>shareholders recorded</span></div>' +
        '<div><b>' + (d.nums.length ? esc(pct(d.total)) : '—') + '</b><span>current stakes added up</span></div>' +
        '<div><b>' + d.dirIn.length + '</b><span>directors and commissioners</span></div>' +
        '<div><b>' + d.ownOut.length + '</b><span>companies it holds shares in</span></div>' +
        '<div><b>' + d.bo.length + '</b><span>beneficial owner' + (d.bo.length === 1 ? '' : 's') + ' (over 25%)</span></div>' +
      '</section>' +
      '<section><h2>Shareholders</h2>' + table([{ t: 'Name' }, { t: 'Stake', num: true }, { t: 'Status' }, { t: 'Dates seen' }, { t: 'Source' }],
        d.ownIn.slice().sort(function(a, b){ return (b.value || 0) - (a.value || 0); }).map(function(l){
          var cs = d.ml(l).citations || [];
          return [name(OM.linkEnds(l)[0]), typeof l.value === 'number' ? esc(pct(l.value)) : 'unknown', status(l), esc(seenText(l)), cs.length ? esc(cs[0].text) : '—']; }), 'No shareholders recorded.') + '</section>' +
      '<section><h2>Who holds it, directly and indirectly</h2>' + table([{ t: 'Name' }, { t: 'Type' }, { t: 'Effective stake', num: true }, { t: 'Note' }],
        d.chain.map(function(h){ return [name(h.id), h.person ? 'Individual' : 'Company', esc(pct(h.v)), (h.person && h.v > 25 ? '<b>Beneficial owner</b> (Perpres 13/2018)' : '') + (h.direct ? '' : (h.person && h.v > 25 ? ', ' : '') + 'indirect')]; }),
        'Nothing to show: no current stakes with known percentages.') +
        '<p class="rp-fine">Percentages are multiplied along chains of current ownership, and parallel paths are added up. A stake with an unknown percentage, or marked previous, breaks the chain.</p></section>' +
      '<section><h2>Directors and commissioners</h2>' + table([{ t: 'Name' }, { t: 'Role' }, { t: 'Status' }, { t: 'Dates seen' }, { t: 'Source' }],
        d.dirIn.slice().sort(function(a, b){ return (a.status === 'previous') - (b.status === 'previous') || OM.canonRole(a.role || '').localeCompare(OM.canonRole(b.role || '')); }).map(function(l){
          var cs = d.ml(l).citations || [];
          return [name(OM.linkEnds(l)[0]), esc(OM.canonRole(l.role || 'Director')), status(l), esc(seenText(l)), cs.length ? esc(cs[0].text) : '—']; }), 'No directors or commissioners recorded.') + '</section>' +
      '<section><h2>Companies it holds shares in</h2>' + table([{ t: 'Name' }, { t: 'Stake', num: true }, { t: 'Status' }, { t: 'Dates seen' }],
        d.ownOut.slice().sort(function(a, b){ return (b.value || 0) - (a.value || 0); }).map(function(l){ return [name(OM.linkEnds(l)[1]), typeof l.value === 'number' ? esc(pct(l.value)) : 'unknown', status(l), esc(seenText(l))]; }), 'It holds no shares in other companies in the data.') + '</section>' +
      (d.shared.length ? '<section><h2>Other boards its directors sit on</h2><ul class="rp-list">' + d.shared.slice(0, 14).map(function(s){ return '<li>' + name(s.person) + ' — ' + esc(OM.canonRole(s.role || 'Director')) + ' at ' + name(s.company) + '</li>'; }).join('') +
        (d.shared.length > 14 ? '<li>and ' + (d.shared.length - 14) + ' more</li>' : '') + '</ul></section>' : '') +
      '<section class="rp-points"><h2>Points to check</h2>' + (d.pts.length ? '<ul class="rp-list">' + d.pts.map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '<p class="rp-none">Nothing found. The data for this company looks complete as recorded.</p>') + '</section>' +
      '<section><h2>Sources</h2>' + (d.sources.length ? '<ol class="rp-list rp-src">' + d.sources.map(function(s){ return '<li>' + esc(s.text) + ' <span class="rp-n">(' + s.n + ' relationship' + (s.n === 1 ? '' : 's') + ')</span></li>'; }).join('') + '</ol>' : '<p class="rp-none">No sources recorded.</p>') + '</section>' +
      '<footer class="rp-foot">Prepared from the Ownership Map dataset as recorded. It shows what the documents say, not a legal opinion on ownership or control.</footer>';
    return html;
  }

  // ---------- overlay ----------
  var overlay = null;
  function open(id){
    close();
    overlay = document.createElement('div');
    overlay.className = 'report-overlay'; overlay.id = 'reportOverlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'Company report');
    overlay.innerHTML = '<div class="report-bar"><span>Company report</span><span class="report-bar-actions"><button type="button" class="btn btn--primary" data-rp="print">Print / Save as PDF</button><button type="button" class="btn" data-rp="close">Close</button></span></div>' +
      '<article class="report-sheet" id="reportSheet">' + build(id) + '</article>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e){
      var b = e.target.closest('[data-rp]'); if (!b) return;
      if (b.dataset.rp === 'print') window.print(); else close();
    });
    overlay.querySelector('[data-rp="print"]').focus();
  }
  function close(){ if (overlay){ overlay.remove(); overlay = null; } }
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && overlay) close(); });
  window.OwnershipMapReport = { open: open, close: close, html: build };
})();
