/* Data quality tab for the Ownership Map.
 *
 * Looks at what the map shows (group and commodity filters apply; relationship and
 * timeline filters do not, every relationship counts) and lists what needs work in
 * five categories: incomplete company data, possible duplicates, group network to
 * complete, possible data errors, and profiles to update. Each finding can be marked
 * "Checked" or "Ignored" with a note; marks are kept in the dataset (collection
 * `reviews`), so they sync to GitHub with everything else. A finding's key includes
 * what it found (a total, a date), so a mark lapses when the data behind it changes.
 * Uses window.OwnershipMap and window.OwnershipMapTabs only.
 */
(function(){
  'use strict';
  var OM = window.OwnershipMap, TABS = window.OwnershipMapTabs;
  if (!OM || !TABS) return;
  var esc = OM.escapeHtml;
  var STALE_KEY = 'om-stale-months', SHOWN = 40;
  function load(k, d){ try { return localStorage.getItem(k) || d; } catch (e){ return d; } }
  var staleMonths = Math.max(1, Math.min(120, +load(STALE_KEY, 12) || 12));
  var showReviewed = false, expanded = {}, noteOpen = null, db = null;
  var reviews = new Map(), lastFindings = [];

  var CATS = [
    { id: 'incomplete', title: 'Incomplete company data', hint: 'Companies whose profile is missing parts: shareholders, board, percentages, sources or dates.' },
    { id: 'duplicates', title: 'Possible duplicates', hint: 'Entities that may be the same one written differently, and relationships recorded twice.' },
    { id: 'network', title: 'Group network to complete', hint: 'Where ownership chains stop, owners are unknown, or groups are not yet linked up.' },
    { id: 'errors', title: 'Possible data errors', hint: 'Numbers or types that look wrong: stakes not adding up to 100%, impossible values, loops.' },
    { id: 'stale', title: 'Profile update needed', hint: 'Companies whose latest profile data is older than the limit set here.' },
  ];

  // ---------- Panel ----------
  var panel = document.createElement('section');
  panel.className = 'overlay table-view qa-view';
  panel.id = 'qualityView';
  panel.setAttribute('aria-label', 'Data quality');
  panel.innerHTML =
    '<div class="tv-head qa-head">' +
      '<div class="qa-chips" id="qaChips" role="list"></div>' +
      '<label class="check-row qa-toggle"><input type="checkbox" id="qaShowReviewed"><span>Show checked and ignored (<span id="qaReviewedN">0</span>)</span></label>' +
      '<button type="button" class="text-btn text-btn--sm" id="qaExport"><svg class="icon" aria-hidden="true"><use href="#i-download"/></svg><span class="btn-label">Worklist CSV</span></button>' +
    '</div>' +
    '<div class="tv-scroll qa-body" id="qaBody"></div>';
  var $ = function(id){ return document.getElementById(id); };
  TABS.add({ id: 'quality', label: 'Data quality', icon: 'i-info', title: 'What is missing, doubtful or out of date', panel: panel, show: render });

  // Review marks live in the dataset.
  window.claude.use('db').then(function(d){
    db = d;
    d.collection('reviews').onSnapshot(function(snap){
      reviews = new Map(snap.docs.map(function(x){ return [decodeURIComponent(x.id), x.data()]; }));
      if (visible()) render();
    }, function(){});
  }, function(){});
  function visible(){ return TABS.current() === 'quality' && !panel.hidden; }

  // ---------- Helpers ----------
  function ent(id){
    return '<button type="button" class="link-btn qa-ent" data-ent="' + esc(id) + '">' + esc(OM.entityName(id)) + '</button>';
  }
  function pct(v){ return (Math.round(v * 100) / 100) + '%'; }
  function monthsAgo(d){ var now = new Date(); return now.getFullYear() * 12 + now.getMonth() + 1 - OM.dateSortKey(d); }
  var LEGAL = new Set(['pt', 'tbk', 'cv', 'ud', 'sdn', 'bhd', 'berhad', 'ltd', 'limited', 'pte', 'inc', 'corp', 'corporation', 'persero', 'company', 'co', 'llc', 'the']);
  function dupKey(name){
    return OM.looseKey(name).split(' ').filter(function(w){ return w && !LEGAL.has(w); }).join(' ');
  }
  // Levenshtein distance, giving up once it exceeds max.
  function within(a, b, max){
    if (Math.abs(a.length - b.length) > max) return false;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++){
      cur = [i]; var best = i;
      for (j = 1; j <= b.length; j++){
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return false;
      prev = cur;
    }
    return prev[b.length] <= max;
  }

  // ---------- Findings ----------
  function findings(){
    var g = OM.graph, M = OM.master, out = [];
    var nodes = new Map(g.nodes.map(function(n){ return [n.id, n]; }));
    var inOwn = new Map(), inDir = new Map(), outOwn = new Map(), touching = new Map();
    function push(m, k, v){ if (!m.has(k)) m.set(k, []); m.get(k).push(v); }
    g.links.forEach(function(l){
      var e = OM.linkEnds(l);
      if (l.type === 'ownership'){ push(inOwn, e[1], l); push(outOwn, e[0], l); } else push(inDir, e[1], l);
      push(touching, e[0], l); push(touching, e[1], l);
    });
    var isCo = function(id){ var n = nodes.get(id); return n && n.type === 'company'; };
    var recent = function(l){ return l.status !== 'previous'; };
    var mlink = function(l){ return M.links.get(l.id) || {}; };
    var profiled = g.nodes.filter(function(n){ return n.type === 'company' && (inOwn.has(n.id) || inDir.has(n.id)); });
    function add(cat, check, key, text, o){ out.push(Object.assign({ cat: cat, check: check, key: key, text: text }, o || {})); }

    // 2.1 Incomplete company data
    profiled.forEach(function(n){
      var id = n.id, own = inOwn.get(id) || [], dir = inDir.get(id) || [], all = own.concat(dir);
      if (!own.length) add('incomplete', 'No shareholders recorded', 'noowner|' + id, ent(id) + ' has its board recorded but no shareholders.', { ids: [id], todo: 'Add its shareholders from the latest company profile.' });
      if (!dir.length) add('incomplete', 'No directors or commissioners recorded', 'noboard|' + id, ent(id) + ' has shareholders recorded but no board.', { ids: [id], todo: 'Add its directors and commissioners.' });
      var nopct = own.filter(function(l){ return typeof l.value !== 'number'; }).length;
      if (nopct) add('incomplete', 'Stakes without a percentage', 'nopct|' + id + '|' + nopct, ent(id) + ': ' + nopct + ' of ' + own.length + ' shareholdings have no percentage.', { ids: [id], todo: 'Fill in the percentages (or share counts).' });
      var nosrc = all.filter(function(l){ return !(mlink(l).citations || []).length; }).length;
      if (nosrc) add('incomplete', 'Relationships without a source', 'nosrc|' + id + '|' + nosrc, ent(id) + ': ' + nosrc + ' of ' + all.length + ' relationships cite no source.', { ids: [id], todo: 'Add the document each relationship comes from.' });
      var nodate = all.filter(function(l){ return !l.date; }).length;
      if (nodate) add('incomplete', 'Relationships without a date', 'nodate|' + id + '|' + nodate, ent(id) + ': ' + nodate + ' of ' + all.length + ' relationships have no date.', { ids: [id], todo: 'Add the date of the document they come from.' });
    });

    // 2.2 Possible duplicates: names
    var cands = g.nodes.map(function(n){ return { n: n, k: dupKey(n.name), links: (touching.get(n.id) || []).length }; })
      .filter(function(c){ return c.k.length >= 3; });
    cands.sort(function(a, b){ return a.k.length - b.k.length; });
    for (var i = 0; i < cands.length; i++){
      for (var j = i + 1; j < cands.length; j++){
        var a = cands[i], b = cands[j];
        if (b.k.length - a.k.length > 2) break;
        if (a.n.type !== b.n.type) continue;
        var same = a.k === b.k, maxd = a.k.length >= 14 ? 2 : a.k.length >= 7 ? 1 : 0;
        if (!same && !(maxd && (a.k[0] === b.k[0] || a.k.slice(-3) === b.k.slice(-3)) && within(a.k, b.k, maxd))) continue;
        var keep = a.links >= b.links ? a : b, drop = keep === a ? b : a;
        var pair = [a.n.id, b.n.id].sort();
        add('duplicates', same ? 'Same name written differently' : 'Very similar names', 'dup|' + pair.join('|'),
          ent(a.n.id) + ' and ' + ent(b.n.id) + (same ? ' differ only in titles, legal form or punctuation.' : ' differ by a letter or two.'),
          { ids: pair, todo: 'If they are the same, merge into the one with more relationships.',
            merge: { from: drop.n.id, into: keep.n.id } });
      }
    }
    // 2.2 Possible duplicates: relationships recorded twice at the same time
    var pairs = new Map();
    g.links.filter(recent).forEach(function(l){ var e = OM.linkEnds(l); push(pairs, e[0] + '|' + e[1] + '|' + l.type, l); });
    pairs.forEach(function(list, k){
      if (list.length < 2) return;
      var e = OM.linkEnds(list[0]), own = list[0].type === 'ownership';
      var what = list.map(function(l){ return own ? (typeof l.value === 'number' ? pct(l.value) : '% unknown') : OM.canonRole(l.role || ''); }).join(', ');
      add('duplicates', own ? 'Two current stakes between the same pair' : 'Two current roles for the same person', 'duprel|' + k + '|' + what,
        ent(e[0]) + (own ? ' holds ' : ' has ') + list.length + (own ? ' current stakes in ' : ' current roles at ') + ent(e[1]) + ' (' + esc(what) + ').',
        { ids: [e[0], e[1]], link: list[0].id, todo: own ? 'Keep one stake and mark the other previous, or correct it.' : 'Check whether both roles are real; keep one if not.' });
    });

    // 2.3 Group network to complete
    var flags = OM.ownershipFlags();
    var below = function(id){ var n = 0; OM.effectiveStakes(id).forEach(function(){ n++; }); return n; };
    flags.openTop.forEach(function(id){
      if (!nodes.has(id)) return;
      var n = below(id);
      add('network', 'Owners not recorded: the chain stops here', 'opentop|' + id, 'The owners of ' + ent(id) + ' are not recorded, yet it holds stakes in ' + n + ' compan' + (n === 1 ? 'y' : 'ies') + ' below it.',
        { ids: [id], weight: n, todo: 'Add its shareholders from its own company profile.' });
    });
    var hasBo = new Set();
    g.nodes.forEach(function(n){
      if (n.type !== 'person') return;
      OM.effectiveStakes(n.id).forEach(function(f, t){ if (f * 100 > 25) hasBo.add(t); });
    });
    profiled.forEach(function(n){
      if (hasBo.has(n.id) || !(inOwn.get(n.id) || []).some(recent)) return;
      add('network', 'No beneficial owner identified', 'nobo|' + n.id, 'With the stakes recorded, no individual holds more than 25% of ' + ent(n.id) + ', directly or through companies (Perpres 13/2018).',
        { ids: [n.id], todo: 'Complete the ownership chain above it to reach the individuals.' });
    });
    var groupsOf = new Map();
    g.links.forEach(function(l){
      var e = OM.linkEnds(l), gs = mlink(l).groups || [];
      [e[0], e[1]].forEach(function(id){ if (!groupsOf.has(id)) groupsOf.set(id, new Set()); gs.forEach(function(x){ groupsOf.get(id).add(x); }); });
    });
    groupsOf.forEach(function(gs, id){
      if (!gs.size && nodes.has(id)) add('network', 'Not in any company group', 'nogroup|' + id, ent(id) + ' is not in any company group.', { ids: [id], todo: 'Add it to its corporate group (detail panel → Company groups).' });
      if (gs.size > 1 && !isCo(id)){
        var list = Array.from(gs).sort();
        add('network', 'People linking different groups', 'bridge|' + id + '|' + list.join(','), ent(id) + ' appears in ' + list.map(esc).join(' and ') + '.',
          { ids: [id], todo: 'Check whether these groups are connected, and record the link if so.' });
      }
    });
    var byGroup = new Map();
    g.links.forEach(function(l){ (mlink(l).groups || []).forEach(function(x){ push(byGroup, x, l); }); });
    byGroup.forEach(function(list, name){
      var parent = new Map();
      var find = function(x){ while (parent.get(x) !== x){ parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
      list.forEach(function(l){ var e = OM.linkEnds(l); [e[0], e[1]].forEach(function(x){ if (!parent.has(x)) parent.set(x, x); }); parent.set(find(e[0]), find(e[1])); });
      var roots = new Set(); parent.forEach(function(_, x){ roots.add(find(x)); });
      if (roots.size > 1) add('network', 'Group split into separate parts', 'split|' + name + '|' + roots.size,
        'Company group ' + esc(name) + ' falls into ' + roots.size + ' parts with no relationship between them.',
        { ids: [], todo: 'Look for the shareholders or directors that tie these parts together, or split the group.' });
    });

    // 2.4 Possible data errors
    profiled.forEach(function(n){
      var cur = (inOwn.get(n.id) || []).filter(recent), nums = cur.filter(function(l){ return typeof l.value === 'number'; });
      if (!nums.length) return;
      var sum = Math.round(nums.reduce(function(s, l){ return s + l.value; }, 0) * 100) / 100;
      if (Math.abs(sum - 100) <= 0.5) return;
      var unknown = cur.length - nums.length;
      add('errors', 'Current stakes do not add up to 100%', 'sum|' + n.id + '|' + sum, ent(n.id) + ': current stakes add up to ' + pct(sum) +
        (unknown ? ' (' + unknown + ' more without a percentage)' : '') + '.',
        { ids: [n.id], weight: Math.abs(100 - sum), todo: sum > 100 ? 'An old stake may still be marked current, or a stake was entered twice.' : 'A shareholder may be missing, or a percentage is wrong.' });
    });
    g.links.forEach(function(l){
      var e = OM.linkEnds(l);
      if (l.type === 'ownership' && typeof l.value === 'number' && (l.value > 100 || l.value <= 0))
        add('errors', 'Impossible percentage', 'range|' + l.id + '|' + l.value, ent(e[0]) + ' is recorded with ' + pct(l.value) + ' of ' + ent(e[1]) + '.', { ids: [e[0], e[1]], link: l.id, todo: 'Correct the percentage.' });
      if (l.type === 'directorship' && /share|saham|pemegang|holder/i.test(l.role || ''))
        add('errors', 'Board role that looks like a shareholding', 'roletype|' + l.id, ent(e[0]) + ' is recorded as “' + esc(l.role) + '” of ' + ent(e[1]) + ', which reads like a stake, not a board seat.',
          { ids: [e[0], e[1]], link: l.id, todo: 'Change the relationship type to shareholding.' });
    });
    g.nodes.forEach(function(n){
      if (n.type === 'person' && OM.inferType(n.name) === 'company')
        add('errors', 'Company recorded as an individual', 'etype|' + n.id, ent(n.id) + ' is recorded as an individual, but its name reads like a company.', { ids: [n.id], todo: 'Change its type to company (detail panel → Edit name or type).' });
    });
    // Ownership loops (Tarjan's strongly connected components on current stakes).
    var adj = new Map();
    g.links.forEach(function(l){ if (l.type === 'ownership' && recent(l)){ var e = OM.linkEnds(l); push(adj, e[0], e[1]); } });
    var idx = 0, stack = [], on = new Set(), num = new Map(), low = new Map();
    function strong(v){
      num.set(v, idx); low.set(v, idx); idx++; stack.push(v); on.add(v);
      (adj.get(v) || []).forEach(function(w){
        if (!num.has(w)){ strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
        else if (on.has(w)) low.set(v, Math.min(low.get(v), num.get(w)));
      });
      if (low.get(v) === num.get(v)){
        var comp = [], w;
        do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v);
        if (comp.length > 1){
          comp.sort();
          add('errors', 'Ownership loop', 'cycle|' + comp.join('|'), comp.map(ent).join(' → ') + ' own each other in a loop.',
            { ids: comp, todo: 'Cross-holdings are possible but rare: check the direction of each stake.' });
        }
      }
    }
    adj.forEach(function(_, v){ if (!num.has(v)) strong(v); });

    // 2.5 Profile update needed
    profiled.forEach(function(n){
      var latest = null;
      (inOwn.get(n.id) || []).concat(inDir.get(n.id) || []).forEach(function(l){
        if (l.date && (!latest || OM.dateSortKey(l.date) > OM.dateSortKey(latest))) latest = l.date;
      });
      var age = latest ? monthsAgo(latest) : null;
      if (latest && age < staleMonths) return;
      var size = (touching.get(n.id) || []).length + below(n.id);
      add('stale', latest ? 'Latest data older than ' + staleMonths + ' months' : 'No date on its data', 'stale|' + n.id + '|' + (latest ? OM.formatDate(latest) : 'none'),
        ent(n.id) + (latest ? ': latest data ' + esc(OM.formatDate(latest)) + ' (' + age + ' months ago).' : ': none of its relationships has a date.') +
        ' ' + size + ' relationship' + (size === 1 ? '' : 's') + ' in its network.',
        { ids: [n.id], weight: (age == null ? 999 : age) * 1000 + size, todo: 'Get its latest company profile (AHU) and read it in.', pdf: true });
    });

    out.forEach(function(f){ f.review = reviews.get(f.key) || null; });
    return out;
  }

  // ---------- Render ----------
  function itemHtml(f){
    var r = f.review;
    var acts = '';
    if (f.merge) acts += '<button type="button" class="chip-btn chip-btn--primary" data-act="merge">Merge</button>';
    if (f.pdf) acts += '<button type="button" class="chip-btn" data-act="pdf">Read newer profile PDF</button>';
    if (f.link) acts += '<button type="button" class="chip-btn" data-act="link">Open relationship</button>';
    if (r) acts += '<button type="button" class="chip-btn" data-act="reopen">Reopen</button>';
    else acts += '<button type="button" class="chip-btn" data-act="checked">Checked</button><button type="button" class="chip-btn" data-act="ignored">Ignore</button>';
    acts += '<button type="button" class="link-btn qa-note-btn" data-act="note">' + (r && r.note ? 'Edit note' : 'Note') + '</button>';
    return '<li class="qa-item' + (r ? ' is-' + r.status : '') + '" data-key="' + esc(f.key) + '">' +
      '<div class="qa-text">' + f.text + (f.todo ? '<span class="qa-todo">' + esc(f.todo) + '</span>' : '') +
        (r ? '<span class="qa-mark">' + (r.status === 'checked' ? 'Checked' : 'Ignored') + (r.at ? ' · ' + esc(new Date(r.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })) : '') +
          (r.note ? ' · ' + esc(r.note) : '') + '</span>' : '') + '</div>' +
      '<div class="qa-actions">' + acts + '</div>' +
      (noteOpen === f.key ? '<form class="qa-note-form" data-note-form><input class="well" name="note" value="' + esc(r && r.note || '') + '" placeholder="What you found or decided" aria-label="Note" autocomplete="off">' +
        '<button type="submit" class="btn">Save</button></form>' : '') +
    '</li>';
  }
  function render(){
    if (!OM.ready && !OM.preview){ $('qaBody').innerHTML = '<p class="tv-empty">Loading the dataset…</p>'; return; }
    var all = findings();
    lastFindings = all;
    var open = all.filter(function(f){ return !f.review; });
    $('qaReviewedN').textContent = all.length - open.length;
    $('qaShowReviewed').checked = showReviewed;
    $('qaChips').innerHTML = CATS.map(function(c){
      var n = open.filter(function(f){ return f.cat === c.id; }).length;
      return '<button type="button" class="qa-chip' + (n ? ' warn' : '') + '" data-jump="' + c.id + '" role="listitem"><b>' + n + '</b>' + esc(c.title) + '</button>';
    }).join('');
    var shown = showReviewed ? all : open;
    $('qaBody').innerHTML = CATS.map(function(c){
      var list = shown.filter(function(f){ return f.cat === c.id; });
      var checks = [];
      list.forEach(function(f){ if (checks.indexOf(f.check) < 0) checks.push(f.check); });
      var body = list.length ? checks.map(function(ch){
        var items = list.filter(function(f){ return f.check === ch; })
          .sort(function(a, b){ return (b.weight || 0) - (a.weight || 0) || a.key.localeCompare(b.key); });
        var k = c.id + '|' + ch, lim = expanded[k] ? items.length : SHOWN;
        return '<div class="qa-check"><h4>' + esc(ch) + ' <span class="ds-count">' + items.length + '</span></h4>' +
          '<ul class="qa-list">' + items.slice(0, lim).map(itemHtml).join('') + '</ul>' +
          (items.length > lim ? '<button type="button" class="link-btn qa-more" data-more="' + esc(k) + '">Show all ' + items.length + '</button>' : '') + '</div>';
      }).join('') : '<p class="qa-ok">' + (open.some(function(f){ return f.cat === c.id; }) || !all.some(function(f){ return f.cat === c.id; }) ? 'Nothing found.' : 'Everything here is checked or ignored.') + '</p>';
      return '<section class="qa-cat" id="qa-' + c.id + '"><h3>' + esc(c.title) + '</h3><p class="hint">' + esc(c.hint) +
        (c.id === 'stale' ? ' <label class="qa-limit">Limit <input class="well" type="number" min="1" max="120" id="qaStale" value="' + staleMonths + '"> months</label>' : '') +
        '</p>' + body + '</section>';
    }).join('');
    var nf = panel.querySelector('[data-note-form] input'); if (nf) nf.focus();
  }

  // ---------- Actions ----------
  function findingOf(el){ var li = el.closest('[data-key]'); return li && lastFindings.find(function(f){ return f.key === li.dataset.key; }); }
  function mark(f, status, note){
    if (!db) return;
    var ref = db.doc('reviews/' + encodeURIComponent(f.key));
    if (!status) return ref.delete();
    var cur = reviews.get(f.key) || {};
    return ref.set({ status: status, note: note != null ? note : (cur.note || ''), at: Date.now(), cat: f.cat, check: f.check });
  }
  panel.addEventListener('click', function(e){
    var j = e.target.closest('[data-jump]');
    if (j){ var s = $('qa-' + j.dataset.jump); if (s) s.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    var m = e.target.closest('[data-more]');
    if (m){ expanded[m.dataset.more] = true; render(); return; }
    var en = e.target.closest('[data-ent]');
    if (en){ OM.selectNode(en.dataset.ent); return; }
    var a = e.target.closest('[data-act]'); if (!a) return;
    var f = findingOf(a); if (!f) return;
    var act = a.dataset.act;
    if (act === 'checked' || act === 'ignored') mark(f, act);
    else if (act === 'reopen') mark(f, null);
    else if (act === 'note'){ noteOpen = noteOpen === f.key ? null : f.key; render(); }
    else if (act === 'link') OM.selectLink(f.link);
    else if (act === 'pdf'){ var inp = document.getElementById('pdfInput'); if (inp) inp.click(); }
    else if (act === 'merge'){
      var from = OM.entityName(f.merge.from), into = OM.entityName(f.merge.into);
      if (window.confirm('Merge “' + from + '” into “' + into + '”?\n\nEvery relationship of “' + from + '” moves to “' + into + '”, and “' + from + '” is kept as one of its spellings. This can be undone from the History.'))
        OM.mergeEntities(f.merge.from, f.merge.into);
    }
  });
  panel.addEventListener('submit', function(e){
    if (!e.target.matches('[data-note-form]')) return;
    e.preventDefault();
    var f = findingOf(e.target); if (!f) return;
    var note = e.target.elements.note.value.trim();
    noteOpen = null;
    var r = reviews.get(f.key);
    if (r || note) mark(f, r ? r.status : 'checked', note); else render();
  });
  panel.addEventListener('change', function(e){
    if (e.target.id === 'qaShowReviewed'){ showReviewed = e.target.checked; render(); }
    if (e.target.id === 'qaStale'){
      staleMonths = Math.max(1, Math.min(120, +e.target.value || 12));
      try { localStorage.setItem(STALE_KEY, String(staleMonths)); } catch (x){}
      render();
    }
  });

  // ---------- Worklist CSV ----------
  function plain(html){ var d = document.createElement('div'); d.innerHTML = html; return d.textContent; }
  function csvCell(v){ var s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  $('qaExport').addEventListener('click', function(){
    var title = {}; CATS.forEach(function(c){ title[c.id] = c.title; });
    var rows = [['Category', 'Check', 'Finding', 'Entities', 'Suggested action', 'Key']];
    lastFindings.filter(function(f){ return !f.review; }).forEach(function(f){
      rows.push([title[f.cat], f.check, plain(f.text), (f.ids || []).map(OM.entityName).join('; '), f.todo || '', f.key]);
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(function(r){ return r.map(csvCell).join(','); }).join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'ownership-map-worklist-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
  });

  // ---------- Follow the app ----------
  document.addEventListener('om:change', function(){ if (visible()) render(); });
  // The Checks panel in the sidebar points here for the full list.
  var checks = document.getElementById('checksList');
  if (checks && checks.parentElement){
    var link = document.createElement('button');
    link.type = 'button'; link.className = 'link-btn qa-from-checks';
    link.textContent = 'See every check in the Data quality tab';
    link.addEventListener('click', function(){ TABS.show('quality'); });
    checks.parentElement.appendChild(link);
  }
})();
