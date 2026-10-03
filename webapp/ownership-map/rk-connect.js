/* Connection finder for the Ownership Map (add-on, uses window.OwnershipMap only).
 *
 * "How is A connected to B?" Finds the shortest chains of relationships between two
 * entities (shareholdings and board roles, in either direction) over the whole dataset,
 * ignoring group and map filters. Each chain is written out step by step; a pure
 * ownership chain also gets its indirect stake. A chain can be shown alone on the map
 * or lit up in context.
 *
 * Open from: the button in the zoom toolbar, the selection bar (two entities selected),
 * the entity detail panel, or OwnershipMapConnect.open(fromId, toId).
 */
(function(){
  'use strict';
  var OM = window.OwnershipMap, wrap = document.getElementById('map');
  if (!OM || !wrap) return;
  var esc = OM.escapeHtml, MAX_PATHS = 8;

  // ---------- panel ----------
  var panel = document.createElement('section');
  panel.className = 'overlay connect-panel'; panel.id = 'connectPanel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Find connection');
  panel.innerHTML =
    '<div class="cn-head"><h3>Find connection</h3><button type="button" class="icon-btn" data-cn="close" aria-label="Close"><svg class="icon"><use href="#i-close"/></svg></button></div>' +
    '<form class="cn-form" id="cnForm">' +
      '<label class="field-l">From<input class="well" id="cnFrom" list="cnNames" autocomplete="off" placeholder="Company or person" required></label>' +
      '<button type="button" class="icon-btn cn-swap" data-cn="swap" title="Swap" aria-label="Swap from and to"><svg class="icon" viewBox="0 0 16 16"><path d="M5 3 2.5 5.5 5 8M2.5 5.5h9M11 8l2.5 2.5L11 13M13.5 10.5h-9"/></svg></button>' +
      '<label class="field-l">To<input class="well" id="cnTo" list="cnNames" autocomplete="off" placeholder="Company or person" required></label>' +
      '<datalist id="cnNames"></datalist>' +
      '<label class="check-row"><input type="checkbox" id="cnPrev" checked><span>Include previous relationships</span></label>' +
      '<button type="submit" class="btn btn--primary">Find connection</button>' +
    '</form>' +
    '<div class="cn-results" id="cnResults" aria-live="polite"></div>';
  wrap.appendChild(panel);
  var $ = function(id){ return document.getElementById(id); };

  // ---------- names → entities ----------
  var nameIndex = new Map();
  function rebuildNames(){
    nameIndex = new Map();
    var opts = [];
    OM.master.entities.forEach(function(e, id){
      [e.name].concat(e.aliases || []).forEach(function(n){ if (n){ nameIndex.set(OM.nameKey(n), id); } });
      opts.push(e.name);
    });
    opts.sort(function(a, b){ return a.localeCompare(b); });
    $('cnNames').innerHTML = opts.map(function(n){ return '<option value="' + esc(n) + '"></option>'; }).join('');
  }
  function resolve(text){
    text = (text || '').trim(); if (!text) return null;
    var id = nameIndex.get(OM.nameKey(text)); if (id) return id;
    var loose = OM.looseKey(text), found = null;
    OM.master.entities.forEach(function(e, eid){ if (!found && OM.looseKey(e.name) === loose) found = eid; });
    return found;
  }

  // ---------- search ----------
  function findPaths(a, b, withPrevious){
    var g = OM.fullGraph();
    var adj = new Map();
    g.links.forEach(function(l){
      if (!withPrevious && l.status === 'previous') return;
      var e = OM.linkEnds(l);
      [[e[0], e[1]], [e[1], e[0]]].forEach(function(p){
        if (!adj.has(p[0])) adj.set(p[0], new Map());
        var m = adj.get(p[0]); if (!m.has(p[1])) m.set(p[1], []); m.get(p[1]).push(l);
      });
    });
    var dist = new Map([[a, 0]]), parents = new Map(), q = [a];
    while (q.length){
      var x = q.shift();
      if (x === b) break;
      (adj.get(x) ? Array.from(adj.get(x).keys()) : []).forEach(function(y){
        if (!dist.has(y)){ dist.set(y, dist.get(x) + 1); parents.set(y, [x]); q.push(y); }
        else if (dist.get(y) === dist.get(x) + 1) parents.get(y).push(x);
      });
    }
    if (!dist.has(b)) return { paths: [], total: 0 };
    var out = [], total = 0;
    (function walk(node, tail){
      if (node === a){ total++; if (out.length < MAX_PATHS) out.push([a].concat(tail)); return; }
      parents.get(node).forEach(function(p){ if (total < 200) walk(p, [node].concat(tail)); });
    })(b, []);
    return { paths: out.map(function(nodes){ return { nodes: nodes, steps: nodes.slice(1).map(function(n, i){ return adj.get(nodes[i]).get(n); }) }; }), total: total };
  }

  // ---------- writing a chain out ----------
  function pct(v){ return (Math.round(v * 100) / 100) + '%'; }
  function when(l){
    var s = l.seen || [];
    if (!s.length) return '';
    var a = OM.formatDate(s[0]), b = OM.formatDate(s[s.length - 1]);
    return a === b ? a : a + ' – ' + b;
  }
  function ent(id){ return '<button type="button" class="link-btn cn-ent" data-ent="' + esc(id) + '">' + esc(OM.entityName(id)) + '</button>'; }
  function describe(u, v, links){
    return links.map(function(l){
      var e = OM.linkEnds(l), prev = l.status === 'previous' ? ' <span class="cn-tag">previous</span>' : '', w = when(l), d = w ? ' <span class="cn-when">' + esc(w) + '</span>' : '';
      if (l.type === 'ownership'){
        var p = typeof l.value === 'number' ? pct(l.value) : 'a stake';
        return e[0] === u ? ent(u) + ' holds <b>' + esc(p) + '</b> of ' + ent(v) + prev + d
                          : ent(u) + ' is held <b>' + esc(p) + '</b> by ' + ent(v) + prev + d;
      }
      var role = esc(OM.canonRole(l.role || 'Director'));
      return e[0] === u ? ent(u) + ' is <b>' + role + '</b> of ' + ent(v) + prev + d
                        : ent(u) + ' has ' + ent(v) + ' as <b>' + role + '</b>' + prev + d;
    }).join('<br><span class="cn-and">and</span> ');
  }
  // A chain made only of current, known stakes all pointing the same way multiplies out.
  function indirectStake(path){
    var dir = null, prod = 1;
    for (var i = 0; i < path.steps.length; i++){
      var l = path.steps[i].filter(function(x){ return x.type === 'ownership' && x.status !== 'previous' && typeof x.value === 'number'; })[0];
      if (!l) return null;
      var e = OM.linkEnds(l), d = e[0] === path.nodes[i] ? 'fwd' : 'back';
      if (dir && d !== dir) return null; dir = d; prod *= l.value / 100;
    }
    if (path.steps.length < 2) return null;
    var owner = dir === 'fwd' ? path.nodes[0] : path.nodes[path.nodes.length - 1], owned = dir === 'fwd' ? path.nodes[path.nodes.length - 1] : path.nodes[0];
    return { owner: owner, owned: owned, value: prod * 100 };
  }

  // ---------- results ----------
  var current = null;
  function render(res, a, b){
    var el = $('cnResults');
    if (!res.paths.length){
      el.innerHTML = '<p class="cn-none">No chain of relationships links ' + ent(a) + ' and ' + ent(b) + ' in the data so far. They may still be connected through relationships that are not recorded yet.</p>';
      current = null; return;
    }
    var len = res.paths[0].nodes.length - 1;
    current = res.paths;
    el.innerHTML = '<p class="cn-summary"><b>' + res.total + '</b> shortest connection' + (res.total === 1 ? '' : 's') + ', <b>' + len + '</b> step' + (len === 1 ? '' : 's') + ' each' +
      (res.total > res.paths.length ? ' (showing ' + res.paths.length + ')' : '') + '.</p>' +
      res.paths.map(function(p, i){
        var ind = indirectStake(p);
        return '<div class="cn-path" data-i="' + i + '"><ol>' + p.steps.map(function(links, k){ return '<li>' + describe(p.nodes[k], p.nodes[k + 1], links) + '</li>'; }).join('') + '</ol>' +
          (ind ? '<p class="cn-ind">Indirect stake: ' + ent(ind.owner) + ' holds about <b>' + esc(pct(ind.value)) + '</b> of ' + ent(ind.owned) + ' (multiplied along the chain).</p>' : '') +
          '<div class="cn-actions"><button type="button" class="chip-btn" data-cn="only">Show only this</button><button type="button" class="chip-btn" data-cn="light">Light up on map</button></div></div>';
      }).join('');
  }
  function run(){
    var a = resolve($('cnFrom').value), b = resolve($('cnTo').value), el = $('cnResults');
    if (!a || !b){ el.innerHTML = '<p class="cn-none">' + (!a ? 'No entity called “' + esc($('cnFrom').value) + '”.' : 'No entity called “' + esc($('cnTo').value) + '”.') + ' Pick a name from the list.</p>'; current = null; return; }
    if (a === b){ el.innerHTML = '<p class="cn-none">Pick two different entities.</p>'; current = null; return; }
    render(findPaths(a, b, $('cnPrev').checked), a, b);
  }

  // ---------- actions ----------
  function pathEdgeIds(p){ var ids = []; p.steps.forEach(function(ls){ ls.forEach(function(l){ ids.push(l.id); }); }); return ids; }
  panel.addEventListener('submit', function(e){ e.preventDefault(); run(); });
  panel.addEventListener('click', function(e){
    var en = e.target.closest('[data-ent]'); if (en){ OM.selectNode(en.dataset.ent); return; }
    var b = e.target.closest('[data-cn]'); if (!b) return;
    var act = b.dataset.cn;
    if (act === 'close'){ close(); return; }
    if (act === 'swap'){ var t = $('cnFrom').value; $('cnFrom').value = $('cnTo').value; $('cnTo').value = t; if ($('cnResults').innerHTML) run(); return; }
    var box = b.closest('.cn-path'), p = box && current && current[+box.dataset.i]; if (!p) return;
    if (act === 'only'){ if (window.OwnershipMapHL) window.OwnershipMapHL.clear(); OM.focusOnSet(p.nodes, 0); }
    if (act === 'light'){
      var hidden = OM.hiddenIds(); if (p.nodes.some(function(n){ return hidden.has(n); })) OM.showAllNodes();
      setTimeout(function(){ if (window.OwnershipMapHL) window.OwnershipMapHL.set(p.nodes, pathEdgeIds(p)); }, 700);
    }
  });
  function open(from, to){
    rebuildNames();
    panel.hidden = false; wrap.classList.add('cn-open');
    if (from) $('cnFrom').value = OM.entityName(from);
    if (to) $('cnTo').value = OM.entityName(to);
    if (from && to) run(); else (from ? $('cnTo') : $('cnFrom')).focus();
  }
  function close(){ panel.hidden = true; wrap.classList.remove('cn-open'); if (window.OwnershipMapHL) window.OwnershipMapHL.clear(); }
  window.OwnershipMapConnect = { open: open, close: close };
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !panel.hidden && panel.contains(document.activeElement)) close(); });
  new MutationObserver(function(){ if (wrap.classList.contains('table-mode')){ panel.hidden = true; wrap.classList.remove('cn-open'); } }).observe(wrap, { attributes: true, attributeFilter: ['class'] });

  // ---------- toolbar button ----------
  var sprite = document.querySelector('svg.sprite');
  if (sprite) sprite.insertAdjacentHTML('beforeend', '<symbol id="i-path" viewBox="0 0 16 16"><circle cx="3.5" cy="12.5" r="1.9"/><circle cx="12.5" cy="3.5" r="1.9"/><path d="M5 11 11 5" stroke-dasharray="1.6 1.6"/></symbol>');
  var tb = document.querySelector('.canvas-toolbar');
  if (tb){
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'icon-btn'; btn.id = 'connectBtn'; btn.title = 'Find how two entities are connected'; btn.setAttribute('aria-label', 'Find connection');
    btn.innerHTML = '<svg class="icon"><use href="#i-path"/></svg>';
    btn.addEventListener('click', function(){ if (panel.hidden) open(); else close(); });
    tb.insertBefore(btn, tb.firstChild);
  }
})();
