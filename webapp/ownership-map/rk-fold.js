/* Foldable sidebar panels (add-on, no dependency on the other modules).
 * Click a panel's heading (or press Enter / Space on it) to fold it down to the heading
 * and open it again. The state is remembered per browser. A panel that is hidden by the
 * app (for example Company groups with no groups) stays hidden. */
(function(){
  'use strict';
  var side = document.getElementById('sidebar');
  if (!side) return;
  var KEY = 'om-folded-panels', folded = {};
  try { folded = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch(e){ folded = {}; }
  function store(){ try { localStorage.setItem(KEY, JSON.stringify(folded)); } catch(e){} }

  function set(panel, fold){
    panel.classList.toggle('rk-folded', fold);
    var h = panel.querySelector('h2');
    if (h) h.setAttribute('aria-expanded', String(!fold));
    if (fold) folded[panel.id] = 1; else delete folded[panel.id];
    store();
  }
  function setup(panel){
    var h = panel.querySelector('h2'); if (!h || h.dataset.rkFold) return;
    h.dataset.rkFold = '1';
    h.setAttribute('role', 'button'); h.tabIndex = 0; h.classList.add('rk-fold-head');
    h.setAttribute('aria-expanded', String(!folded[panel.id]));
    h.title = 'Click to fold or unfold this panel';
    panel.classList.toggle('rk-folded', !!folded[panel.id]);
    var toggle = function(){ set(panel, !panel.classList.contains('rk-folded')); };
    h.addEventListener('click', toggle);
    h.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); } });
  }
  side.querySelectorAll('section.panel[id]').forEach(setup);

  window.OwnershipMapFold = {
    open: function(id){ var p = document.getElementById(id); if (p && p.classList.contains('rk-folded')) set(p, false); },
    isFolded: function(id){ var p = document.getElementById(id); return !!(p && p.classList.contains('rk-folded')); },
  };
})();
