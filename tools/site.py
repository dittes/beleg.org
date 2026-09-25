#!/usr/bin/env python3
"""beleg.org – Seitengenerator.

Schreibt in alle Seiten: Meta-Tags (SEO, Open Graph, JSON-LD), Register-Navigation,
Kopfzeile und Fußzeile. Erzeugt Seiten aus Vorlagen (tools/tpl) sowie sitemap.xml
und robots.txt. Aufruf im Repo-Wurzelverzeichnis:

    python3 tools/site.py
"""
import json, re, pathlib, datetime, html

SITE = 'https://beleg.org'
TODAY = datetime.date.today().isoformat()
ROOT = pathlib.Path(__file__).resolve().parent.parent

ICONS = {
    'pruefen': '<path d="M4 1.5h7l3 3v12H4z"/><path d="m6.5 10 2 2 3.5-4"/>',
    'erstellen': '<path d="M4 1.5h7l3 3v12H4z"/><path d="M9 7.5v6M6 10.5h6"/>',
    'scannen': '<path d="M1.5 5V1.5H5M13 1.5h3.5V5M16.5 13v3.5H13M5 16.5H1.5V13"/><path d="M4 9h10"/>',
    'auslesen': '<rect x="2" y="3" width="14" height="12" rx="1"/><path d="M2 7h14M2 11h14M7 3v12"/>',
    'vorlagen': '<path d="M5.5 4.5h9v12h-9z"/><path d="M3 13.5V2h8.5"/>',
    'fristen': '<rect x="1.5" y="2.5" width="15" height="4" rx=".5"/><path d="M3 6.5v9h12v-9M7 10h4"/>',
    'ratgeber': '<path d="M2 3.5c2.5-1 5-1 7 .5v11c-2-1.5-4.5-1.5-7-.5zM16 3.5c-2.5-1-5-1-7 .5v11c2-1.5 4.5-1.5 7-.5z"/>',
}

NAV = [  # (Schlüssel, Pfad, Label)
    ('pruefen', 'e-rechnung-pruefen/', 'E-Rechnung prüfen'),
    ('erstellen', 'e-rechnung-erstellen/', 'E-Rechnung erstellen'),
    ('scannen', 'beleg-scannen/', 'Beleg scannen'),
    ('auslesen', 'belege-auslesen/', 'Belege auslesen'),
    ('vorlagen', 'eigenbeleg-erstellen/', 'Belegvorlagen'),
    ('fristen', 'aufbewahrungsfristen/', 'Aufbewahrung'),
    ('ratgeber', 'ratgeber/', 'Ratgeber'),
]

ARTICLES = [  # Ratgeber – Reihenfolge = Anzeige
    ('belegpflicht/', 'Belegpflicht', 'Wann du einen Beleg brauchst – und wann nicht'),
    ('beleg-vs-quittung/', 'Beleg, Quittung, Rechnung', 'Die Unterschiede einfach erklärt'),
    ('beleg-digitalisieren/', 'Belege digitalisieren', 'Scannen, ablegen, Papier vernichten – GoBD-konform'),
    ('e-rechnungspflicht/', 'E-Rechnungspflicht', 'Was ab 2025, 2027 und 2028 gilt'),
]

VORLAGE_TYPES = {
    'eigen': ('eigenbeleg-erstellen/', 'Eigenbeleg'),
    'bewirtung': ('bewirtungsbeleg-erstellen/', 'Bewirtungsbeleg'),
    'quittung': ('quittung-erstellen/', 'Quittung'),
}

def tool(key, **kw):
    return {'kind': 'tool', 'nav': key, **kw}

def article(**kw):
    return {'kind': 'article', 'nav': 'ratgeber', **kw}

PAGES = [
    {'path': '', 'kind': 'home', 'nav': None,
     'title': 'beleg.org – Belege prüfen, scannen, auslesen & erstellen',
     'desc': 'Kostenlose Werkzeuge für Belege: E-Rechnungen prüfen und erstellen, Belege scannen, Kontoauszüge in Excel umwandeln, Eigenbelege schreiben. Ohne Upload.',
     'kopf': [('Bereich', 'Start'), ('Seite', 'Werkzeuge für Belege'), ('Verarbeitung', 'lokal im Browser', True), ('Kosten', 'keine', False)]},

    tool('pruefen', path='e-rechnung-pruefen/', name='E-Rechnung prüfen',
         title='E-Rechnung prüfen & anzeigen – XRechnung und ZUGFeRD online öffnen',
         desc='XRechnung, ZUGFeRD und Factur-X kostenlos online öffnen, lesbar anzeigen und prüfen. Summen, Pflichtangaben und IBAN werden kontrolliert – ohne Upload.',
         kopf=[('Verarbeitung', 'lokal im Browser', True), ('Formate', 'CII · UBL · PDF', False)]),
    tool('erstellen', path='e-rechnung-erstellen/', name='E-Rechnung erstellen',
         title='E-Rechnung erstellen – XRechnung & ZUGFeRD kostenlos schreiben',
         desc='E-Rechnungen kostenlos im Browser erstellen: XRechnung 3.0 als XML oder PDF mit eingebetteten ZUGFeRD-Daten. Mit Live-Prüfung, ohne Konto.',
         kopf=[('Standard', 'EN 16931 · CII', True), ('Entwurf', 'nur auf diesem Gerät', False)]),
    tool('scannen', path='beleg-scannen/', name='Beleg scannen',
         title='Beleg scannen – mit dem Handy zum PDF, kostenlos im Browser',
         desc='Belege mit der Kamera scannen: Foto aufnehmen, automatisch zuschneiden, Schrift verbessern und mehrere Seiten als PDF speichern. Ohne App, ohne Upload.',
         kopf=[('Kamera', 'bleibt auf dem Gerät', True), ('Ausgabe', 'PDF · JPG', False)]),
    tool('auslesen', path='belege-auslesen/', name='Belege auslesen', tpl='auslesen', mode='auto',
         title='Belege auslesen – Kassenbons & Rechnungen per Texterkennung erfassen',
         desc='Daten aus Kassenbons, Rechnungen und Scans automatisch auslesen: Händler, Datum, Beträge und Umsatzsteuer. Export als Excel oder CSV, Texterkennung im Browser.',
         kopf=[('Texterkennung', 'lokal im Browser', True), ('Ausgabe', 'XLSX · CSV', False)],
         vars={'h1': 'Belege <em>auslesen</em>,<br>statt abtippen.', 'eyebrow': 'Belege auslesen · OCR',
               'lede': 'Leg Kassenbons, Rechnungen, Scans oder Handyfotos ab. beleg.org liest den Text, erkennt Datum, Beträge und Umsatzsteuer und macht daraus eine Tabelle, die du prüfen und als Excel oder CSV speichern kannst.',
               'content': 'auslesen-belege'}),
    tool('auslesen', path='kontoauszug-in-excel/', name='Kontoauszug in Excel umwandeln', tpl='auslesen', mode='statement',
         title='Kontoauszug in Excel umwandeln – PDF zu XLSX & CSV, kostenlos',
         desc='Kontoauszüge als PDF in Excel oder CSV umwandeln: Buchungen, Verwendungszweck und Beträge werden erkannt und der Saldo abgeglichen. Kostenlos, ohne Upload.',
         kopf=[('Verarbeitung', 'lokal im Browser', True), ('Ausgabe', 'XLSX · CSV', False)],
         vars={'h1': 'Kontoauszug in<br><em>Excel</em> umwandeln.', 'eyebrow': 'Kontoauszug · PDF zu Excel',
               'lede': 'Leg einen oder mehrere Kontoauszüge als PDF ab. beleg.org erkennt jede Buchung mit Datum, Empfänger, Verwendungszweck und Betrag, gleicht den Saldo ab und speichert alles als Excel-Tabelle oder CSV.',
               'content': 'auslesen-kontoauszug'}),
    *[tool('vorlagen', path=p, name=f'{n} erstellen', tpl='vorlage', vtype=t,
           title={'eigen': 'Eigenbeleg erstellen – Vorlage kostenlos online ausfüllen (PDF)',
                  'bewirtung': 'Bewirtungsbeleg erstellen – Vorlage online ausfüllen & drucken',
                  'quittung': 'Quittung erstellen – Vorlage online ausfüllen, mit Betrag in Worten'}[t],
           desc={'eigen': 'Eigenbeleg online erstellen, wenn der Originalbeleg fehlt: Vorlage ausfüllen, Vorschau prüfen, als PDF drucken. Kostenlos, ohne Anmeldung, ohne Werbung.',
                 'bewirtung': 'Bewirtungsbeleg für Geschäftsessen online ausfüllen: Anlass, Teilnehmende, Betrag und Trinkgeld – mit 70/30-Aufteilung und Druckvorlage als PDF.',
                 'quittung': 'Quittung online erstellen: Betrag mit Umsatzsteuer, Betrag in Worten, Kleinunternehmer-Hinweis. Kostenlos als PDF drucken, ohne Anmeldung.'}[t],
           kopf=[('Ausgabe', 'Druck / PDF · A4', True), ('Entwurf', 'nur auf diesem Gerät', False)])
      for t, (p, n) in VORLAGE_TYPES.items()],
    tool('fristen', path='aufbewahrungsfristen/', name='Aufbewahrungsfristen',
         title='Aufbewahrungsfristen 2026 – Rechner: Darf der Beleg weg?',
         desc='Aufbewahrungsfristen-Rechner für Rechnungen, Kontoauszüge, Lohnunterlagen und Geschäftsbriefe. Mit neuer 8-Jahres-Frist für Buchungsbelege und Schredder-Plan.',
         kopf=[('Rechtsstand', 'AO / HGB / UStG 2025', True), ('Grundlage', '§ 147 AO · § 257 HGB', False)]),

    {'path': 'ratgeber/', 'kind': 'hub', 'nav': 'ratgeber', 'name': 'Ratgeber',
     'title': 'Ratgeber rund um Belege – Belegpflicht, Quittung, Digitalisierung',
     'desc': 'Verständliche Artikel zu Belegen: Belegpflicht, Unterschied zwischen Beleg, Quittung und Rechnung, Belege digitalisieren und E-Rechnungspflicht.',
     'kopf': [('Bereich', 'Ratgeber'), ('Seite', 'Alle Artikel'), ('Stand', 'September 2026', True)]},
    article(path='belegpflicht/', name='Belegpflicht',
            title='Belegpflicht: Wann du einen Beleg brauchst – einfach erklärt',
            desc='Belegpflicht einfach erklärt: Belegausgabepflicht an der Kasse, Pflichtangaben auf Rechnungen, Kleinbetragsrechnung, Eigenbeleg und Tipps für Privatpersonen.'),
    article(path='beleg-vs-quittung/', name='Beleg, Quittung, Rechnung',
            title='Beleg vs. Quittung vs. Rechnung – die Unterschiede einfach erklärt',
            desc='Beleg, Quittung, Rechnung, Kassenbon, Kontoauszug: Was ist was, was beweist welches Dokument, und was reicht für Steuer und Vorsteuerabzug? Mit Übersichtstabelle.'),
    article(path='beleg-digitalisieren/', name='Belege digitalisieren',
            title='Belege digitalisieren: Scannen und Original vernichten (GoBD)',
            desc='Belege digitalisieren und Papier sparen: Was die GoBD beim ersetzenden Scannen verlangen, wie du mit dem Handy richtig scannst und wie du Belege sinnvoll ablegst.'),
    article(path='e-rechnungspflicht/', name='E-Rechnungspflicht',
            title='E-Rechnungspflicht 2025–2028: Wer muss was und ab wann?',
            desc='Die E-Rechnungspflicht im Überblick: Empfang seit 2025, Versand ab 2027 und 2028, Ausnahmen für Kleinunternehmer und Kleinbetragsrechnungen, erlaubte Formate.'),

    {'path': 'impressum/', 'kind': 'legal', 'nav': None, 'name': 'Impressum', 'noindex': False,
     'title': 'Impressum · beleg.org', 'desc': 'Impressum von beleg.org – Anbieterkennzeichnung nach § 5 DDG.',
     'kopf': [('Bereich', 'Rechtliches'), ('Seite', 'Impressum'), ('Grundlage', '§ 5 DDG · § 18 MStV', True)]},
    {'path': 'datenschutz/', 'kind': 'legal', 'nav': None, 'name': 'Datenschutz',
     'title': 'Datenschutz · beleg.org', 'desc': 'Datenschutzerklärung von beleg.org: Deine Dateien werden ausschließlich in deinem Browser verarbeitet. Keine Cookies, kein Tracking.',
     'kopf': [('Bereich', 'Rechtliches'), ('Seite', 'Datenschutzerklärung'), ('Stand', 'September 2026', True)]},
    {'path': '404.html', 'kind': 'legal', 'nav': None, 'name': 'Seite nicht gefunden', 'noindex': True, 'absolute': True,
     'title': 'Seite nicht gefunden · beleg.org', 'desc': 'Diese Seite gibt es nicht.',
     'kopf': [('Bereich', 'Fehler 404'), ('Seite', 'Nicht gefunden')]},
]

# ————————————————————————————————————————————————————————————————

def prefix(page):
    if page.get('absolute'):
        return '/'
    return '../' * page['path'].count('/')

def file_of(page):
    p = page['path']
    return ROOT / (p if p.endswith('.html') else p + 'index.html')

def esc(s):
    return s.replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;')

def faqs(s):
    clean = lambda h: html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', h))).strip()
    return [{'@type': 'Question', 'name': clean(q), 'acceptedAnswer': {'@type': 'Answer', 'text': clean(a)}}
            for q, a in re.findall(r'<details class="faq__item"><summary>(.*?)</summary>\s*<div>(.*?)</div>\s*</details>', s, re.S)]

def meta(page, faq=()):
    pre = prefix(page)
    url = f"{SITE}/{page['path']}" if not page['path'].endswith('.html') else None
    crumbs = [('beleg.org', f'{SITE}/')]
    if page['kind'] == 'article':
        crumbs.append(('Ratgeber', f'{SITE}/ratgeber/'))
    if page['kind'] != 'home' and url:
        crumbs.append((page.get('name', page['title']), url))
    ld = []
    if page['kind'] == 'home':
        ld.append({'@context': 'https://schema.org', '@type': 'WebSite', 'name': 'beleg.org', 'url': f'{SITE}/', 'inLanguage': 'de-DE',
                   'description': page['desc'], 'publisher': {'@type': 'Person', 'name': 'Andreas Dittes'}})
    if page['kind'] == 'tool':
        ld.append({'@context': 'https://schema.org', '@type': 'WebApplication', 'name': page['name'], 'url': url,
                   'description': page['desc'], 'applicationCategory': 'BusinessApplication', 'operatingSystem': 'Web',
                   'inLanguage': 'de-DE', 'isAccessibleForFree': True,
                   'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'EUR'}})
    if page['kind'] == 'article':
        ld.append({'@context': 'https://schema.org', '@type': 'Article', 'headline': page['title'].split(':')[0].split(' – ')[0],
                   'description': page['desc'], 'url': url, 'inLanguage': 'de-DE', 'datePublished': '2026-09-25', 'dateModified': TODAY,
                   'author': {'@type': 'Person', 'name': 'Andreas Dittes'},
                   'publisher': {'@type': 'Organization', 'name': 'beleg.org', 'url': f'{SITE}/'},
                   'mainEntityOfPage': url})
    if faq:
        ld.append({'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': list(faq)})
    if len(crumbs) > 1:
        ld.append({'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': u} for i, (n, u) in enumerate(crumbs)]})
    lines = [
        '<!-- meta: generiert von tools/site.py -->',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f'<title>{esc(page["title"])}</title>',
        f'<meta name="description" content="{esc(page["desc"])}">',
    ]
    if page.get('noindex'):
        lines.append('<meta name="robots" content="noindex">')
    if url:
        lines += [f'<link rel="canonical" href="{url}">',
                  '<meta property="og:type" content="{}">'.format('article' if page['kind'] == 'article' else 'website'),
                  '<meta property="og:site_name" content="beleg.org">',
                  '<meta property="og:locale" content="de_DE">',
                  f'<meta property="og:title" content="{esc(page["title"])}">',
                  f'<meta property="og:description" content="{esc(page["desc"])}">',
                  f'<meta property="og:url" content="{url}">',
                  f'<meta property="og:image" content="{SITE}/assets/og.png">',
                  '<meta name="twitter:card" content="summary_large_image">']
    lines += ['<meta name="theme-color" content="#0c2582">',
              f'<link rel="icon" href="{pre}assets/favicon.svg" type="image/svg+xml">',
              f'<link rel="apple-touch-icon" href="{pre}assets/apple-touch-icon.png">',
              f'<link rel="preload" href="{pre}assets/fonts/Newsreader-normal-400-latin.woff2" as="font" type="font/woff2" crossorigin>',
              f'<link rel="stylesheet" href="{pre}assets/fonts/fonts.css">']
    for block in ld:
        lines.append(f'<script type="application/ld+json">{json.dumps(block, ensure_ascii=False)}</script>')
    lines.append('<!-- /meta -->')
    return '\n  '.join(lines)

def nav(page):
    pre = prefix(page)
    home = pre or './'
    tabs = []
    for key, path, label in NAV:
        cur = ' aria-current="page"' if page.get('nav') == key else ''
        tabs.append(f'      <a class="tab" href="{pre}{path}"{cur}><svg class="tab__ic" viewBox="0 0 18 18" aria-hidden="true">{ICONS[key]}</svg><span class="tab__label">{label}</span></a>')
    mark = '''<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M9 4h22v30l-3.67-2.5L23.67 34 20 31.5 16.33 34l-3.66-2.5L9 34V4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 12h12M14 17h12M14 22h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="28" cy="25" r="5.5" fill="#6ea0ff" stroke="#0c2582" stroke-width="2"/><path d="m25.6 25 1.6 1.6 3-3.2" stroke="#0c2582" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'''
    return f'''<aside class="register" aria-label="Hauptnavigation">
    <a class="register__mark" href="{home}" aria-label="beleg.org Startseite">
      {mark}
      <span class="register__word">beleg<i>.org</i></span>
    </a>
    <nav>
{chr(10).join(tabs)}
    </nav>
    <div class="register__foot"><span>Kein Upload</span><span>Kein Konto</span><span>Kein Tracking</span></div>
    <script>(function(){{var t=document.querySelector('.register .tab[aria-current]');if(t&&t.parentNode.scrollWidth>t.parentNode.clientWidth)t.parentNode.scrollLeft=t.offsetLeft-48;}})()</script>
  </aside>'''

def kopf(page):
    cells = page.get('kopf')
    if page['kind'] == 'tool':
        cells = [('Bereich', 'Werkzeug'), ('Seite', page['name'])] + page['kopf']
    elif page['kind'] == 'article':
        cells = [('Bereich', 'Ratgeber'), ('Artikel', page['name']), ('Stand', 'September 2026', True)]
    out = []
    for i, c in enumerate(cells):
        k, v = c[0], c[1]
        flag = c[2] if len(c) > 2 else None
        hide = ' kopf__cell--hide' if flag is False or (i == 0) else ''
        dot = '<span class="dot"></span>' if flag is True else ''
        out.append(f'      <div class="kopf__cell{hide}"><span class="kopf__k">{k}</span><span class="kopf__v">{dot}{v}</span></div>')
    return '<div class="kopf">\n' + '\n'.join(out) + '\n    </div>'

def footer(page):
    pre = prefix(page)
    tools_ = ''.join(f'<li><a href="{pre}{p}">{l}</a></li>' for k, p, l in NAV if k != 'ratgeber')
    tools_ += f'<li><a href="{pre}kontoauszug-in-excel/">Kontoauszug in Excel</a></li>'
    vorl = ''.join(f'<li><a href="{pre}{p}">{n} erstellen</a></li>' for p, n in VORLAGE_TYPES.values())
    arts = ''.join(f'<li><a href="{pre}{p}">{n}</a></li>' for p, n, _ in ARTICLES)
    return f'''<footer class="colophon">
      <div class="colophon__brand"><b>beleg<i>.org</i></b><span>Werkzeuge für Belege. Kostenlos, ohne Konto, ohne Tracking. Deine Dateien bleiben auf deinem Gerät.</span></div>
      <nav class="colophon__cols" aria-label="Fußzeile">
        <div><p>Werkzeuge</p><ul>{tools_}</ul></div>
        <div><p>Vorlagen</p><ul>{vorl}</ul></div>
        <div><p>Ratgeber</p><ul>{arts}</ul></div>
        <div><p>Rechtliches</p><ul><li><a href="{pre}impressum/">Impressum</a></li><li><a href="{pre}datenschutz/">Datenschutz</a></li></ul></div>
      </nav>
      <p class="colophon__legal">Keine Steuer- oder Rechtsberatung. Angaben ohne Gewähr.</p>
    </footer>'''

def render_template(page):
    tpl = (ROOT / 'tools' / 'tpl' / f"{page['tpl']}.html").read_text()
    vars_ = dict(page.get('vars', {}))
    if page['tpl'] == 'auslesen':
        vars_['mode'] = page['mode']
        vars_['content'] = (ROOT / 'tools' / 'tpl' / f"{vars_['content']}.html").read_text()
    if page['tpl'] == 'vorlage':
        t = page['vtype']
        vars_['vtype'] = t
        vars_['content'] = (ROOT / 'tools' / 'tpl' / f'vorlage-{t}.html').read_text()
        for key, (p, n) in VORLAGE_TYPES.items():
            vars_[f'cur_{key}'] = ' aria-current="page"' if key == t else ''
        vars_['form'] = (ROOT / 'tools' / 'tpl' / f'vorlage-form-{t}.html').read_text()
        vars_['lede'] = {'eigen': 'Wenn der Originalbeleg fehlt, dokumentierst du die Ausgabe mit einem Eigenbeleg. Formular ausfüllen, Vorschau prüfen, drucken oder als PDF speichern.',
                         'bewirtung': 'Für jedes Geschäftsessen brauchst du einen Bewirtungsbeleg mit Anlass und Teilnehmenden. Hier füllst du ihn aus und druckst ihn zum Anheften an die Restaurantrechnung.',
                         'quittung': 'Eine Quittung bestätigt, dass du Geld erhalten hast. Mit Umsatzsteuer, Betrag in Worten und Unterschriftsfeld, fertig zum Drucken oder als PDF.'}[t]
        vars_['h1'] = {'eigen': 'Eigenbeleg <em>erstellen.</em>', 'bewirtung': 'Bewirtungsbeleg <em>erstellen.</em>', 'quittung': 'Quittung <em>erstellen.</em>'}[t]
    for k, v in vars_.items():
        tpl = tpl.replace('{{' + k + '}}', v)
    left = [x for x in re.findall(r'\{\{\w+\}\}', tpl) if x != '{{pre}}']
    assert not left, f'Unbelegte Platzhalter in {page["path"]}: {left}'
    return tpl

def process(page):
    f = file_of(page)
    if page.get('tpl'):
        f.parent.mkdir(parents=True, exist_ok=True)
        s = render_template(page)
    else:
        s = f.read_text()
    m = meta(page, faqs(s))
    if '<!-- meta:' in s:
        s = re.sub(r'<!-- meta:.*?<!-- /meta -->', lambda _: m, s, count=1, flags=re.S)
    else:
        for pat in [r'\s*<meta charset="utf-8">', r'\s*<meta name="viewport"[^>]*>', r'\s*<title>.*?</title>', r'\s*<meta name="description"[^>]*>',
                    r'\s*<meta name="theme-color"[^>]*>', r'\s*<link rel="icon"[^>]*>', r'\s*<link rel="stylesheet" href="[^"]*fonts\.css">']:
            s = re.sub(pat, '', s, count=1, flags=re.S)
        s = s.replace('<head>', '<head>\n  ' + m, 1)
    s = re.sub(r'<aside class="register".*?</aside>|<!--NAV-->', lambda _: nav(page), s, count=1, flags=re.S)
    s = re.sub(r'<div class="kopf">.*?\n    </div>|<!--KOPF-->', lambda _: kopf(page), s, count=1, flags=re.S)
    s = re.sub(r'<footer class="colophon">.*?</footer>|<!--FOOTER-->', lambda _: footer(page), s, count=1, flags=re.S)
    # Pfad-Präfix in Vorlagen
    s = s.replace('{{pre}}', prefix(page))
    f.write_text(s)
    return f

def main():
    for page in PAGES:
        f = file_of(page)
        if not page.get('tpl') and not f.exists():
            print('fehlt  ', page['path'])
            continue
        process(page)
        print('ok     ', page['path'] or '/')
    urls = [p for p in PAGES if not p.get('noindex') and not p['path'].endswith('.html')]
    prio = {'home': '1.0', 'tool': '0.9', 'hub': '0.6', 'article': '0.7', 'legal': '0.2'}
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for p in urls:
        sm.append(f'  <url><loc>{SITE}/{p["path"]}</loc><lastmod>{TODAY}</lastmod><priority>{prio[p["kind"]]}</priority></url>')
    sm.append('</urlset>')
    (ROOT / 'sitemap.xml').write_text('\n'.join(sm) + '\n')
    (ROOT / 'robots.txt').write_text(f'User-agent: *\nAllow: /\nDisallow: /tools/\n\nSitemap: {SITE}/sitemap.xml\n')
    print('sitemap.xml, robots.txt')

if __name__ == '__main__':
    main()
