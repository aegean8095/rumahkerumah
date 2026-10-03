/* "As of" slider for the Ownership Map (add-on, uses window.OwnershipMap only).
 *
 * Drag the slider to see the structure as it stood in a given month: only relationships
 * in force then are drawn, and each counts as current, so ownership chains and beneficial
 * owners are as they were. A relationship is in force from the first date it was seen;
 * if it has since been superseded it counts up to the last date it was seen, otherwise
 * up to today. Relationships with no date at all can be kept or left out.
 * This is an estimate from the dates recorded, not a legal record of tenure.
 */
(function(){
  'use strict';
  var OM = window.OwnershipMap, wrap = document.getElementById('map');
  if (!OM || !wrap) return;
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function keyOf(y, m){ return y * 12 + m; }
  function label(key){ var y = Math.floor((key - 1) / 12); return MONTHS[key - y * 12 - 1] + ' ' + y; }
  var now = new Date(), nowKey = keyOf(now.getFullYear(), now.getMonth() + 1);

  // ---------- bar ----------
  var bar = document.createElement('div');
  bar.className = 'overlay asof-bar'; bar.id = 'asofBar'; bar.hidden = true;
  bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Show the structure as of a date');
  bar.innerHTML =
    '<div class="asof-top"><span class="asof-title">Structure as of <b id="asofLabel">now</b></span>' +
      '<span class="asof-count" id="asofCount" aria-live="polite"></span>' +
      '<button type="button" class="chip-btn" data-asof="now">Now</button>' +
      '<button type="button" class="icon-btn" data-asof="close" aria-label="Close the date slider"><svg class="icon"><use href="#i-close"/></svg></button></div>' +
    '<input type="range" id="asofRange" step="1" aria-label="Month" aria-describedby="asofNote">' +
    '<div class="asof-ticks" id="asofTicks" aria-hidden="true"></div>' +
    '<div class="asof-foot"><label class="check-row"><input type="checkbox" id="asofUndated" checked><span>Keep relationships with no date (<span id="asofUndatedN">0</span>)</span></label>' +
      '<span class="asof-note" id="asofNote">Estimated from the dates seen in the documents.</span></div>';
  wrap.appendChild(bar);
  var $ = function(id){ return document.getElementById(id); };
  var range = $('asofRange'), minKey = 0, maxKey = 0, timer = null;

  function span(){
    var g = OM.fullGraph(), lo = Infinity, hi = -Infinity, undated = 0;
    g.links.forEach(function(l){
      if (!l.seen || !l.seen.length){ undated++; return; }
      lo = Math.min(lo, OM.dateSortKey(l.seen[0]));
      hi = Math.max(hi, OM.dateSortKey(l.seen[l.seen.length - 1]));
    });
    if (!isFinite(lo)){ lo = nowKey - 12; hi = nowKey; }
    return { lo: lo, hi: Math.max(hi, nowKey), undated: undated };
  }
  function ticks(){
    var y0 = Math.floor((minKey - 1) / 12), y1 = Math.floor((maxKey - 1) / 12), n = y1 - y0, step = n <= 6 ? 1 : n <= 14 ? 2 : n <= 30 ? 5 : 10;
    var html = '';
    for (var y = Math.ceil(y0 / step) * step; y <= y1; y += step){
      var pos = (keyOf(y, 1) - minKey) / (maxKey - minKey) * 100;
      if (pos >= 0 && pos <= 100) html += '<span style="left:' + pos + '%">' + y + '</span>';
    }
    $('asofTicks').innerHTML = html;
  }
  function counts(){
    var g = OM.graph; $('asofCount').textContent = g.nodes.length + ' entities · ' + g.links.length + ' relationships';
  }
  function show(key){
    $('asofLabel').textContent = key == null ? 'now' : label(key);
    range.value = key == null ? maxKey : key;
    range.setAttribute('aria-valuetext', key == null ? 'now' : label(key));
  }
  function apply(key, immediate){
    show(key);
    clearTimeout(timer);
    var go = function(){ OM.setAsOf(key >= maxKey ? null : key, $('asofUndated').checked); };
    if (immediate) go(); else timer = setTimeout(go, 160);
  }
  function openBar(){
    var s = span(); minKey = s.lo; maxKey = s.hi;
    range.min = minKey; range.max = maxKey; ticks();
    $('asofUndatedN').textContent = s.undated;
    bar.hidden = false; show(OM.getAsOf().key);
    btn.classList.add('is-on'); btn.setAttribute('aria-pressed', 'true'); counts();
  }
  function closeBar(){
    bar.hidden = true; clearTimeout(timer);
    btn.classList.remove('is-on'); btn.setAttribute('aria-pressed', 'false');
    if (OM.getAsOf().key != null) OM.setAsOf(null);
  }
  range.addEventListener('input', function(){ apply(+range.value, false); });
  range.addEventListener('change', function(){ apply(+range.value, true); });
  $('asofUndated').addEventListener('change', function(){ if (OM.getAsOf().key != null) OM.setAsOf(OM.getAsOf().key, this.checked); });
  bar.addEventListener('click', function(e){
    var b = e.target.closest('[data-asof]'); if (!b) return;
    if (b.dataset.asof === 'now'){ show(null); OM.setAsOf(null); }
    else closeBar();
  });

  // ---------- toolbar button ----------
  var sprite = document.querySelector('svg.sprite');
  if (sprite) sprite.insertAdjacentHTML('beforeend', '<symbol id="i-calendar" viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.75h11M5.5 2v2.5M10.5 2v2.5"/></symbol>');
  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'icon-btn'; btn.id = 'asofBtn'; btn.title = 'Show the structure as of a date'; btn.setAttribute('aria-label', 'Show the structure as of a date'); btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = '<svg class="icon"><use href="#i-calendar"/></svg>';
  btn.addEventListener('click', function(){ if (bar.hidden) openBar(); else closeBar(); });
  var tb = document.querySelector('.canvas-toolbar'); if (tb) tb.insertBefore(btn, tb.firstChild);

  // ---------- follow the app ----------
  document.addEventListener('om:asof', function(e){ if (!bar.hidden){ show(e.detail.key); } });
  document.addEventListener('om:change', function(){ if (!bar.hidden) counts(); });
  // Data quality always judges the current data: leave the past before it opens.
  document.addEventListener('om:tab', function(e){
    var tab = e.detail.tab;
    if (tab === 'quality'){ if (btn.classList.contains('is-on') || OM.getAsOf().key != null) closeBar(); }
    else if (tab === 'table' || tab === 'stats'){ if (!bar.hidden) bar.hidden = true; }
    else if (tab === 'map'){ if (btn.classList.contains('is-on')) bar.hidden = false; }
  });
})();
