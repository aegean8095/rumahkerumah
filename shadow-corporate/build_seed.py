#!/usr/bin/env python3
"""Builds webapp/ownership-map/data/seed.json from shadow-corporate/cSPKaltim.csv.

Mirrors the Ownership Map's own import rules (name tidying, entity type, date
format, relationship identity) so the result matches pasting the CSV into the app.
Run from the repo root:  python3 shadow-corporate/build_seed.py
"""
import csv, json, re, time, unicodedata

SRC = 'shadow-corporate/cSPKaltim.csv'
OUT = 'webapp/ownership-map/data/seed.json'
GROUP = 'Kaltim'
CITATION = {'text': 'cSPKaltim.csv (shadow-corporate)', 'date': None}

KEEP_UPPER = {'PT','CV','UD','PD','LLC','NV','BV','SA','SH','SE','SP','ST','MM','MH','MBA','MSI','MKN','IR','DR','HJ','H','II','III','IV','SPD','SPT','SKM','SSI'}
ROLE_CANON = {
    'direktur utama': 'President Director', 'presiden direktur': 'President Director', 'direktur': 'Director',
    'anggota direksi': 'Director', 'direktur independen': 'Independent Director',
    'wakil direktur utama': 'Vice President Director', 'wakil presiden direktur': 'Vice President Director',
    'komisaris utama': 'President Commissioner', 'presiden komisaris': 'President Commissioner', 'komisaris': 'Commissioner',
    'anggota dewan komisaris': 'Commissioner', 'komisaris independen': 'Independent Commissioner',
    'wakil komisaris utama': 'Vice President Commissioner', 'wakil presiden komisaris': 'Vice President Commissioner',
}

def tidy_caps(s):
    if re.search(r'[a-z]', s): return s
    words = s.split(' ')
    if len(words) < 2: return s
    out = []
    for w in words:
        if re.sub(r'[.,]', '', w) in KEEP_UPPER: out.append(w); continue
        out.append(re.sub(r"(^|[-'(/])([a-z])", lambda m: m.group(1) + m.group(2).upper(), w.lower()))
    return ' '.join(out)

def normalize_name(raw):
    s = re.sub(r'\s+', ' ', (raw or '').strip())
    m = re.match(r'^(.+?)\s*,\s*(PT|CV|UD|PD)\.?$', s, re.I) or re.match(r'^(.+?)\s+(PT|CV)\.?$', s, re.I)
    if m: s = m.group(2).upper() + ' ' + m.group(1).strip()
    s = re.sub(r'^(P\.?\s?T|C\.?\s?V|U\.?\s?D|P\.?\s?D)\.?(?=\s)', lambda x: re.sub(r'[.\s]', '', x.group(0)).upper(), s, flags=re.I)
    return tidy_caps(s)

def name_key(d): return re.sub(r'\s+', ' ', re.sub(r'[.,]', '', d.lower())).strip()

def infer_type(n):
    n = n.strip()
    if re.match(r'^(PT|CV|UD|PD|Firma|Yayasan|Koperasi|Perum|Perseroan)\b', n, re.I): return 'company'
    if re.search(r'\b(Tbk|Ltd|LLC|Inc|Corp|Corporation|Company|Limited|GmbH|Pte|Group|Holdings?|Sdn\.?\s*Bhd\.?|Bhd\.?|Berhad|S\.?A\.?|N\.?V\.?|B\.?V\.?)\.?$', n, re.I): return 'company'
    return 'person'

def slugify(name):
    s = unicodedata.normalize('NFKD', (name or '').lower())
    s = re.sub(r'[̀-ͯ]', '', s)
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', s))[:60] or 'entity'

def ym(d):  # DD-MM-YYYY -> YYYY-MM
    m = re.match(r'^\s*(\d{1,2})-(\d{1,2})-(\d{4})\s*$', d or '')
    return f'{m.group(3)}-{int(m.group(2)):02d}' if m else None

def title_case(s): return re.sub(r'\w\S*', lambda t: t.group(0)[0].upper() + t.group(0)[1:].lower(), s)

def main():
    now = int(time.time() * 1000)
    entities, key_to_id, links, by_key = {}, {}, {}, {}

    def ent(raw):
        name = normalize_name(raw); k = name_key(name)
        if k in key_to_id: return key_to_id[k]
        base = 'e-' + slugify(name); i, eid = 2, base
        while eid in entities: eid = f'{base}-{i}'; i += 1
        entities[eid] = {'name': name, 'type': infer_type(name), 'aliases': [], 'note': '', 'createdAt': now, 'updatedAt': now}
        key_to_id[k] = eid
        return eid

    rows = list(csv.DictReader(open(SRC, encoding='utf-8-sig')))
    skipped = 0
    for r in rows:
        company, other = (r['company'] or '').strip(), (r['linkedEntity'] or '').strip()
        if not company or not other: skipped += 1; continue
        seen = sorted({x for x in (ym(r['startTenure']), ym(r['endTenure'])) if x})
        # A row typed DIRECTORSHIP but titled SHAREHOLDER (PT Sylvaduta) is a stake, not a board seat.
        if r['linkType'].strip().upper() == 'SHAREHOLDING' or 'SHAREHOLDER' in r['positionTitle'].upper():
            m = re.match(r'^\s*([\d.,]+)\s*%?\s*$', r['sharePercent'] or '')
            value = float(m.group(1).replace(',', '.')) if m else None
            if value is not None and value == int(value): value = int(value)
            typ, role = 'ownership', None
        else:
            typ, value = 'directorship', None
            role = ROLE_CANON.get(r['positionTitle'].strip().lower()) or title_case(r['positionTitle'].strip())
        s, t = ent(other), ent(company)   # owner/person -> company
        key = '|'.join([s, t, typ, str(value) if (typ == 'ownership' and value is not None) else ('' if typ == 'ownership' else role.lower()), ''])
        if key in by_key:
            d = links[by_key[key]]
            d['seen'] = sorted(set(d['seen']) | set(seen)); d['date'] = d['seen'][-1] if d['seen'] else None
            continue
        lid = f'l-{len(links) + 1:04d}'
        by_key[key] = lid
        links[lid] = {'source': s, 'target': t, 'type': typ, 'value': value, 'role': role,
                      'date': seen[-1] if seen else None, 'status': None, 'seen': seen,
                      'groups': [GROUP], 'citations': [dict(CITATION)], 'note': '', 'createdAt': now, 'updatedAt': now}
    json.dump({'entities': entities, 'links': links}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'{len(rows)} rows -> {len(entities)} entities, {len(links)} relationships, {skipped} skipped -> {OUT}')

main()
