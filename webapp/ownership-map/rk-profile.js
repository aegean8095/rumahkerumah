/* Entity profile fields (add-on, uses window.OwnershipMap only).
 * Every entity can carry: address, country (jurisdiction) and identity registry
 * numbers (company registration no., KTP/NIK, passport, NPWP, ...).
 * They are stored on the entity record (address, country, identities[{kind, number}]),
 * so backups, GitHub saving, history and merge carry them. This file adds the editing
 * block to the detail panel; the table, CSV, search and report read the fields directly. */
(function(){
  'use strict';
  var OM = window.OwnershipMap, panel = document.getElementById('detailPanel');
  if (!OM || !panel) return;
  var busy = false, esc = OM.escapeHtml;
  var KINDS = ['Company registration no.', 'NIB', 'NPWP (tax no.)', 'KTP / NIK', 'Passport no.', 'Other ID'];
  var COUNTRIES = ['Indonesia', 'Singapore', 'Malaysia', 'Hong Kong', 'China', 'Japan', 'South Korea', 'Netherlands', 'United Kingdom', 'British Virgin Islands', 'Cayman Islands', 'Mauritius', 'Seychelles', 'Samoa', 'Labuan', 'Australia', 'United States'];

  function canEdit(){ return OM.ready && !OM.preview; }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }

  function save(id, mutate, summary){
    var before = OM.master.entities.get(id); if (!before) return;
    var after = clone(before); mutate(after);
    if (!after.address) delete after.address;
    if (!after.country) delete after.country;
    if (!(after.identities || []).length) delete after.identities;
    after.updatedAt = Date.now();
    return OM.withBusy(function(){
      return OM.commitChanges([{ kind: 'entity', id: id, before: clone(before), after: after }], summary + ': ' + before.name)
        .then(function(res){ OM.reportWrite(res, 'Saved.'); });
    });
  }

  function html(id, e){
    var ids = e.identities || [];
    return '<div class="detail-block rk-profile" data-id="' + esc(id) + '"><h4>Profile</h4>' +
      '<label class="rk-field"><span>Country (jurisdiction)</span><input class="well" name="country" list="rkCountries" value="' + esc(e.country || '') + '" placeholder="Where it is incorporated, or the person’s nationality" autocomplete="off"></label>' +
      '<label class="rk-field"><span>Address</span><textarea class="well" name="address" rows="2" placeholder="Registered address, or residence for a person">' + esc(e.address || '') + '</textarea></label>' +
      '<button type="button" class="btn" data-rkp="save" style="width:fit-content">Save country and address</button>' +
      '<div class="rk-field"><span>Identity registry</span>' +
        (ids.length ? '<ul class="rk-ids">' + ids.map(function(i, n){
          return '<li><span class="rk-id-kind">' + esc(i.kind) + '</span><span class="rk-id-num">' + esc(i.number) + '</span>' +
            '<button type="button" class="link-btn" data-rkp="del" data-idx="' + n + '" aria-label="Remove ' + esc(i.kind) + '">Remove</button></li>'; }).join('') + '</ul>'
          : '<p class="detail-empty" style="margin:0">No identity number yet.</p>') +
        '<div class="rk-id-add"><select class="well" name="kind" aria-label="Kind of identity number">' + KINDS.map(function(k){ return '<option>' + esc(k) + '</option>'; }).join('') + '</select>' +
          '<input class="well" name="number" placeholder="Number" aria-label="Identity number" autocomplete="off">' +
          '<button type="button" class="btn" data-rkp="add">Add</button></div></div>' +
      '<datalist id="rkCountries">' + COUNTRIES.map(function(c){ return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
      '</div>';
  }

  function enhance(){
    if (busy || panel.hidden || !canEdit()) return;
    var heading = document.getElementById('detailHeading');
    if (!heading || heading.textContent.trim() !== 'Entity detail') return;
    var id = OM.selectedEntityId && OM.selectedEntityId(); if (!id) return;
    var e = OM.master.entities.get(id); if (!e) return;
    var old = panel.querySelector('.rk-profile');
    if (old && old.dataset.id === id) return;
    var note = Array.from(panel.querySelectorAll('.detail-block')).find(function(b){ var h = b.querySelector('h4'); return h && h.textContent.trim() === 'Note'; });
    var anchor = note || panel.querySelector('.rk-detail-tools') || panel.querySelector('.detail-actions'); if (!anchor) return;
    busy = true;
    try {
      panel.querySelectorAll('.rk-profile').forEach(function(n){ n.remove(); });
      anchor.insertAdjacentHTML('afterend', html(id, e));
    } finally { busy = false; }
  }

  panel.addEventListener('click', function(ev){
    var b = ev.target.closest('[data-rkp]'); if (!b) return;
    var box = b.closest('.rk-profile'), id = box && box.dataset.id; if (!id) return;
    var act = b.dataset.rkp;
    if (act === 'save'){
      var country = box.querySelector('[name=country]').value.trim(), address = box.querySelector('[name=address]').value.trim();
      save(id, function(x){ x.country = country; x.address = address; }, 'Updated country and address');
    } else if (act === 'add'){
      var kind = box.querySelector('[name=kind]').value, input = box.querySelector('[name=number]'), number = input.value.trim();
      if (!number){ input.focus(); return; }
      var cur = OM.master.entities.get(id);
      if ((cur.identities || []).some(function(i){ return i.kind === kind && i.number === number; })) return;
      save(id, function(x){ x.identities = (x.identities || []).concat({ kind: kind, number: number }); }, 'Added ' + kind);
    } else if (act === 'del'){
      var n = +b.dataset.idx;
      save(id, function(x){ x.identities.splice(n, 1); }, 'Removed an identity number');
    }
  });

  new MutationObserver(enhance).observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('om:change', enhance);
  enhance();
})();
