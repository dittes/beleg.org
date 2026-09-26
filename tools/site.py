#!/usr/bin/env python3
"""beleg.org – Seitengenerator.

Schreibt in alle Seiten: Meta-Tags (SEO, Open Graph, JSON-LD), Register-Navigation,
Kopfzeile und Fußzeile. Erzeugt Seiten aus Vorlagen (tools/tpl) sowie sitemap.xml
und robots.txt. Aufruf im Repo-Wurzelverzeichnis:

    python3 tools/site.py
"""
import json, re, pathlib, datetime, html, hashlib

SITE = 'https://beleg.org'
TODAY = datetime.date.today().isoformat()
ROOT = pathlib.Path(__file__).resolve().parent.parent

ICONS = {
    'pruefen': '<path d="M4 1.5h7l3 3v12H4z"/><path d="m6.5 10 2 2 3.5-4"/>',
    'erstellen': '<path d="M4 1.5h7l3 3v12H4z"/><path d="M9 7.5v6M6 10.5h6"/>',
    'leitweg': '<path d="M2 9h10M9 5.5 12.5 9 9 12.5"/><path d="M14.5 3v12"/>',
    'girocode': '<rect x="2" y="2" width="5" height="5"/><rect x="11" y="2" width="5" height="5"/><rect x="2" y="11" width="5" height="5"/><path d="M11 11h2v2h-2zM14 14h2v2h-2zM11 15h1M15 11h1"/>',
    'qrscan': '<path d="M1.5 5V1.5H5M13 1.5h3.5V5M16.5 13v3.5H13M5 16.5H1.5V13"/><rect x="4.5" y="4.5" width="3.5" height="3.5"/><rect x="10" y="4.5" width="3.5" height="3.5"/><rect x="4.5" y="10" width="3.5" height="3.5"/><path d="M10 10h1.5v1.5H10zM12 12h1.5v1.5H12z"/>',
    'barscan': '<path d="M1.5 5V1.5H5M13 1.5h3.5V5M16.5 13v3.5H13M5 16.5H1.5V13"/><path d="M5 5v8M7 5v8M9.5 5v8M11 5v8M13 5v8"/>',
    'scannen': '<path d="M1.5 5V1.5H5M13 1.5h3.5V5M16.5 13v3.5H13M5 16.5H1.5V13"/><path d="M4 9h10"/>',
    'auslesen': '<rect x="2" y="3" width="14" height="12" rx="1"/><path d="M2 7h14M2 11h14M7 3v12"/>',
    'umbenennen': '<path d="M2.5 4.5h8l3 4.5-3 4.5h-8z"/><circle cx="6" cy="9" r="1"/>',
    'vorlagen': '<path d="M5.5 4.5h9v12h-9z"/><path d="M3 13.5V2h8.5"/>',
    'reisekosten': '<rect x="2" y="5.5" width="14" height="10" rx="1"/><path d="M6.5 5.5V3h5v2.5M2 10h14"/>',
    'fristen': '<rect x="1.5" y="2.5" width="15" height="4" rx=".5"/><path d="M3 6.5v9h12v-9M7 10h4"/>',
    'pdf': '<path d="M3.5 1.5h7l3 3v12h-10z"/><path d="M6 9.5h6M6 12.5h6M6 6.5h2.5"/>',
    'rechner': '<rect x="3" y="1.5" width="12" height="15" rx="1"/><path d="M5.5 4.5h7v2.5h-7zM6 10h.01M9 10h.01M12 10h.01M6 13h.01M9 13h.01M12 13h.01"/>',
    'ratgeber': '<path d="M2 3.5c2.5-1 5-1 7 .5v11c-2-1.5-4.5-1.5-7-.5zM16 3.5c-2.5-1-5-1-7 .5v11c2-1.5 4.5-1.5 7-.5z"/>',
    # PDF-Werkzeuge
    'p-merge': '<rect x="1.5" y="2" width="6.5" height="9"/><rect x="10" y="7" width="6.5" height="9"/><path d="M8 6.5h4.5v-2"/>',
    'p-redact': '<path d="M3.5 1.5h7l3 3v12h-10z"/><rect x="5" y="8" width="7" height="2.5" fill="currentColor"/>',
    'p-stamp': '<path d="M7 2.5h4l-.7 5h2.7l1.5 3h-11l1.5-3h2.7z"/><path d="M3 13.5h12"/>',
    'p-sign': '<path d="M2 13c2-4 3.5-6 4.5-6s-.5 5 1 5 3-4 4.5-4 1 2 3.5 2"/><path d="M2 16h14"/>',
    'p-ocr': '<path d="M3.5 1.5h7l3 3v12h-10z"/><circle cx="8.5" cy="10" r="2.5"/><path d="m10.5 12 2 2"/>',
    'p-compress': '<path d="M9 1.5v5M6.5 4 9 6.5 11.5 4M9 16.5v-5M6.5 14 9 11.5l2.5 2.5M3 9h12"/>',
    'p-img2pdf': '<rect x="1.5" y="3" width="8" height="7" rx=".5"/><path d="m1.5 8.5 2.5-2 2 1.5 1.5-1 2 1.5"/><path d="M11 7.5h2.5l3 3v6h-5.5z"/>',
    'p-pdf2img': '<path d="M1.5 1.5h5l2 2v7h-7z"/><rect x="9.5" y="8" width="7" height="8.5" rx=".5"/><path d="m9.5 14.5 2-1.5 1.5 1 1.5-1 2 1.5"/>',
    'p-meta': '<path d="M3.5 1.5h7l3 3v12h-10z"/><path d="m6 8 5 5M11 8l-5 5"/>',
}

NAV_GROUPS = [  # (Gruppe, [(Schlüssel, Pfad, Label, Kurzbeschreibung)])
    ('E-Rechnung', [
        ('pruefen', 'e-rechnung-pruefen/', 'E-Rechnung prüfen', 'XRechnung & ZUGFeRD öffnen'),
        ('erstellen', 'e-rechnung-erstellen/', 'E-Rechnung erstellen', 'XML oder PDF schreiben'),
        ('leitweg', 'leitweg-id-pruefen/', 'Leitweg-ID prüfen', 'Aufbau & Prüfziffer'),
    ]),
    ('Belege', [
        ('scannen', 'beleg-scannen/', 'Beleg scannen', 'Kamera → PDF'),
        ('auslesen', 'belege-auslesen/', 'Belege auslesen', 'Texterkennung → Excel'),
        ('umbenennen', 'belege-umbenennen/', 'Belege umbenennen', 'Datum_Händler_Betrag.pdf'),
        ('vorlagen', 'eigenbeleg-erstellen/', 'Belegvorlagen', 'Eigenbeleg, Bewirtung, Quittung'),
        ('reisekosten', 'reisekostenabrechnung/', 'Reisekosten', 'Abrechnung mit Belegmappe'),
        ('fristen', 'aufbewahrungsfristen/', 'Aufbewahrung', 'Darf der Beleg weg?'),
    ]),
    ('Codes', [
        ('qrscan', 'qr-code-scanner/', 'QR-Code-Scanner', 'Kamera oder Bild, online'),
        ('barscan', 'barcode-scanner/', 'Barcode-Scanner', 'EAN, Code 128 & mehr'),
        ('girocode', 'girocode-erstellen/', 'GiroCode erstellen', 'QR-Code für Überweisungen'),
    ]),
    ('PDF', [
        ('pdf', 'pdf-werkstatt/', 'PDF-Werkstatt', 'Zusammenfügen, schwärzen, stempeln …'),
    ]),
    ('Rechnen', [
        ('rechner', 'rechner/', 'Rechner', 'MwSt, Skonto, Reise, Kleinunternehmer'),
    ]),
    ('Wissen', [
        ('ratgeber', 'ratgeber/', 'Ratgeber', 'Wissen rund um Belege'),
    ]),
]
NAV = [item for _, items in NAV_GROUPS for item in items]

PDF_TOOLS = [  # (Schlüssel, Pfad, Label, Kurzbeschreibung)
    ('p-merge', 'pdf-zusammenfuegen/', 'Zusammenfügen & teilen', 'Seiten sortieren, drehen, löschen, aufteilen'),
    ('p-redact', 'pdf-schwaerzen/', 'Schwärzen', 'IBAN, Beträge, Namen dauerhaft unkenntlich'),
    ('p-stamp', 'belegstempel/', 'Belegstempel', 'Gebucht, bezahlt, Kostenstelle'),
    ('p-sign', 'pdf-unterschreiben/', 'Unterschreiben', 'Unterschrift zeichnen und platzieren'),
    ('p-ocr', 'pdf-durchsuchbar-machen/', 'Durchsuchbar machen', 'Textebene per Texterkennung'),
    ('p-compress', 'pdf-verkleinern/', 'Verkleinern', 'Scans kleiner machen'),
    ('p-img2pdf', 'bilder-zu-pdf/', 'Bilder zu PDF', 'JPG, PNG zu einem PDF'),
    ('p-pdf2img', 'pdf-zu-bildern/', 'PDF zu Bildern', 'Seiten als JPG oder PNG'),
    ('p-meta', 'pdf-metadaten-entfernen/', 'Metadaten entfernen', 'Autor, Software, Zeitstempel löschen'),
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

    # ——— E-Rechnung-Ergänzungen
    tool('leitweg', path='leitweg-id-pruefen/', name='Leitweg-ID prüfen', tpl='tool', src='leitweg',
         title='Leitweg-ID prüfen – Prüfziffer berechnen & Aufbau erklärt',
         desc='Leitweg-ID für E-Rechnungen an Behörden prüfen: Aufbau, Grob- und Feinadressierung und Prüfziffer nach Mod 97-10. Prüfziffer online berechnen.'),
    tool('girocode', path='girocode-erstellen/', name='GiroCode erstellen', tpl='tool', src='girocode',
         title='GiroCode erstellen – QR-Code für Überweisungen (EPC-QR) kostenlos',
         desc='GiroCode (EPC-QR) für Rechnungen erstellen: IBAN, Betrag und Verwendungszweck als QR-Code, den Banking-Apps direkt einlesen. Als PNG oder SVG speichern.'),
    # ——— Codes
    tool('qrscan', path='qr-code-scanner/', name='QR Code Scanner', tpl='tool', src='qr-scanner',
         title='QR Code Scanner online & kostenlos – mit Kamera oder Bild scannen',
         desc='Kostenloser QR Code Scanner online: QR-Codes mit Handy- oder Webcam-Kamera scannen oder aus Bildern und Screenshots lesen. Ohne App, ohne Upload, mit Link-Prüfung.'),
    tool('barscan', path='barcode-scanner/', name='Barcode Scanner', tpl='tool', src='barcode-scanner',
         title='Barcode Scanner online & kostenlos – EAN, Code 128 & mehr scannen',
         desc='Kostenloser Barcode Scanner online: EAN, UPC, Code 128, Code 39 und DataMatrix mit der Kamera oder aus Bildern scannen. Mit Scanliste und CSV-Export, ohne App.'),
    # ——— Belege
    tool('umbenennen', path='belege-umbenennen/', name='Belege umbenennen', tpl='tool', src='umbenennen',
         title='Belege automatisch umbenennen – Datum, Händler, Betrag im Dateinamen',
         desc='Viele Belegscans auf einmal sinnvoll benennen: Datum, Händler und Betrag werden per Texterkennung erkannt. Download als ZIP, ohne Upload.'),
    tool('reisekosten', path='reisekostenabrechnung/', name='Reisekostenabrechnung', tpl='tool', src='reisekosten',
         title='Reisekostenabrechnung erstellen – mit Pauschalen 2026 & Belegmappe (PDF)',
         desc='Reisekostenabrechnung online: Verpflegungspauschalen, Kilometergeld, Übernachtung und Nebenkosten berechnen, Belege anhängen und als PDF-Mappe speichern.'),
    # ——— PDF-Werkstatt
    tool('pdf', path='pdf-werkstatt/', name='PDF-Werkstatt', tpl='tool', src='pdf-werkstatt',
         title='PDF-Werkstatt – PDF bearbeiten kostenlos & ohne Upload',
         desc='PDFs bearbeiten direkt im Browser: zusammenfügen, teilen, schwärzen, stempeln, unterschreiben, durchsuchbar machen, verkleinern. Keine Datei verlässt dein Gerät.'),
    tool('pdf', path='pdf-zusammenfuegen/', name='PDF zusammenfügen & teilen', tpl='tool', src='pdf-merge',
         title='PDF zusammenfügen & teilen – Seiten sortieren, drehen, löschen',
         desc='PDFs kostenlos zusammenfügen, aufteilen und Seiten sortieren, drehen oder löschen. Auch Bilder einfügen. Alles im Browser, ohne Upload.'),
    tool('pdf', path='pdf-schwaerzen/', name='PDF schwärzen', tpl='tool', src='pdf-redact',
         title='PDF schwärzen – IBAN, Beträge & Namen dauerhaft unkenntlich machen',
         desc='PDF sicher schwärzen: Bereiche markieren oder IBAN, Beträge und Suchbegriffe automatisch finden. Der Text darunter wird wirklich entfernt. Ohne Upload.'),
    tool('pdf', path='belegstempel/', name='Belegstempel', tpl='tool', src='pdf-stamp',
         title='Belegstempel digital – Kontierungsstempel auf PDF setzen',
         desc='Digitaler Kontierungsstempel für Belege: „Gebucht“, „Bezahlt“ oder „Eingegangen“ mit Datum, Konto und Kostenstelle auf PDFs und Scans setzen.'),
    tool('pdf', path='pdf-unterschreiben/', name='PDF unterschreiben', tpl='tool', src='pdf-sign',
         title='PDF unterschreiben – Unterschrift zeichnen & einfügen, kostenlos',
         desc='PDF online unterschreiben: Unterschrift mit Maus oder Finger zeichnen oder als Bild laden, auf der Seite platzieren und speichern. Ohne Upload, ohne Konto.'),
    tool('pdf', path='pdf-durchsuchbar-machen/', name='PDF durchsuchbar machen', tpl='tool', src='pdf-ocr',
         title='PDF durchsuchbar machen – OCR für gescannte PDFs, kostenlos',
         desc='Gescannte PDFs und Fotos mit Texterkennung durchsuchbar machen: Der Text wird als unsichtbare Ebene eingefügt und lässt sich suchen und kopieren.'),
    tool('pdf', path='pdf-verkleinern/', name='PDF verkleinern', tpl='tool', src='pdf-compress',
         title='PDF verkleinern – Scans komprimieren für E-Mail & Upload',
         desc='PDF-Dateien verkleinern: Scans und Fotos komprimieren, Graustufen und Auflösung wählen, Vorher-Nachher-Größe sehen. Kostenlos im Browser.'),
    tool('pdf', path='bilder-zu-pdf/', name='Bilder zu PDF', tpl='tool', src='pdf-img2pdf',
         title='Bilder zu PDF – JPG & PNG in ein PDF umwandeln, kostenlos',
         desc='JPG-, PNG- und WebP-Bilder zu einem PDF zusammenfassen: Reihenfolge sortieren, A4 oder Originalgröße wählen, speichern. Ohne Upload.'),
    tool('pdf', path='pdf-zu-bildern/', name='PDF zu Bildern', tpl='tool', src='pdf-pdf2img',
         title='PDF in JPG oder PNG umwandeln – alle Seiten als Bilder',
         desc='PDF-Seiten als JPG oder PNG speichern, mit wählbarer Auflösung. Einzelne Seiten oder alle als ZIP. Kostenlos und ohne Upload.'),
    tool('pdf', path='pdf-metadaten-entfernen/', name='PDF-Metadaten entfernen', tpl='tool', src='pdf-meta',
         title='PDF-Metadaten anzeigen & entfernen – Autor, Software, Zeitstempel',
         desc='PDF-Metadaten prüfen und löschen: Autor, Titel, Software, Erstellungsdatum und XMP-Daten entfernen, bevor du Dokumente weitergibst.'),
    # ——— Rechner
    tool('rechner', path='rechner/', name='Rechner', tpl='tool', src='rechner',
         title='MwSt-Rechner, Skonto-Rechner & Kleinunternehmer-Check 2026',
         desc='Kostenlose Rechner für Selbstständige: Brutto-Netto mit 19 % und 7 %, Skonto mit effektivem Jahreszins, Reisekosten-Pauschalen und Kleinunternehmergrenze 2026.'),

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

MARK = '''<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M9 4h22v30l-3.67-2.5L23.67 34 20 31.5 16.33 34l-3.66-2.5L9 34V4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 12h12M14 17h12M14 22h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="28" cy="25" r="5.5" fill="#6ea0ff" stroke="#0c2582" stroke-width="2"/><path d="m25.6 25 1.6 1.6 3-3.2" stroke="#0c2582" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'''

def icon(key, cls):
    return f'<svg class="{cls}" viewBox="0 0 18 18" aria-hidden="true">{ICONS[key]}</svg>'

def section_label(page):
    if page['kind'] == 'home':
        return 'Start'
    if page['kind'] == 'article':
        return 'Ratgeber'
    return page.get('name', '')

def nav(page):
    pre = prefix(page)
    home = pre or './'
    cur = lambda k: ' aria-current="page"' if page.get('nav') == k else ''
    groups = []
    for g, items in NAV_GROUPS:
        tabs = '\n'.join(f'      <a class="tab" href="{pre}{p}"{cur(k)}>{icon(k, "tab__ic")}<span class="tab__label">{l}</span></a>' for k, p, l, _ in items)
        groups.append(f'      <p class="register__k">{g}</p>\n{tabs}')
    # Mobilmenü
    mgroups = []
    for g, items in NAV_GROUPS:
        if g in ('PDF', 'Wissen'):
            continue
        cards = ''.join(f'<li><a href="{pre}{p}"{cur(k)}>{icon(k, "m__ic")}<span><b>{l}</b><small>{d}</small></span></a></li>' for k, p, l, d in items)
        mgroups.append(f'<p class="menu__k">{g}</p><ul class="menu__tools">{cards}</ul>')
    mpdf = ''.join(f'<a href="{pre}{p}">{l}</a>' for _, p, l, _ in PDF_TOOLS)
    mvorl = ''.join(f'<a href="{pre}{p}">{n}</a>' for p, n in VORLAGE_TYPES.values()) + f'<a href="{pre}kontoauszug-in-excel/">Kontoauszug in Excel</a>'
    marts = ''.join(f'<li><a href="{pre}{p}">{n}<small>{d}</small></a></li>' for p, n, d in ARTICLES)
    return f'''<aside class="register" aria-label="Hauptnavigation">
    <a class="register__mark" href="{home}" aria-label="beleg.org Startseite">
      {MARK}
      <span class="register__word">beleg<i>.org</i></span>
    </a>
    <nav>
{chr(10).join(groups)}
    </nav>
    <div class="register__foot"><span>Kein Upload · Kein Konto</span><span>Kein Tracking</span></div>
  </aside>
  <header class="topbar">
    <a class="topbar__mark" href="{home}" aria-label="beleg.org Startseite">{MARK}<span>beleg<i>.org</i></span></a>
    <span class="topbar__here">{section_label(page)}</span>
    <button class="topbar__btn" type="button" aria-haspopup="dialog" aria-controls="menu" onclick="document.getElementById('menu').showModal()"><span>Menü</span><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 5h14M2 9h14M2 13h14"/></svg></button>
  </header>
  <dialog class="menu" id="menu" aria-label="Menü" onclick="if(event.target===this)this.close()">
    <div class="menu__in">
      <div class="menu__head"><a class="topbar__mark" href="{home}">{MARK}<span>beleg<i>.org</i></span></a><button class="topbar__btn" type="button" onclick="this.closest('dialog').close()"><span>Schließen</span><svg viewBox="0 0 18 18" aria-hidden="true"><path d="m4 4 10 10M14 4 4 14"/></svg></button></div>
      <nav aria-label="Menü">
        {''.join(mgroups)}
        <p class="menu__k"><a href="{pre}pdf-werkstatt/">PDF-Werkstatt →</a></p>
        <div class="menu__chips">{mpdf}</div>
        <p class="menu__k">Direkt zu</p>
        <div class="menu__chips">{mvorl}</div>
        <p class="menu__k">Ratgeber</p>
        <ul class="menu__arts">{marts}<li><a href="{pre}ratgeber/">Alle Artikel<small>Übersicht</small></a></li></ul>
      </nav>
      <p class="menu__foot"><a href="{pre}impressum/">Impressum</a> · <a href="{pre}datenschutz/">Datenschutz</a></p>
    </div>
  </dialog>'''

def home_tools(page):
    out = []
    for g, items in NAV_GROUPS:
        if g == 'Wissen':
            continue
        if g == 'PDF':
            items = [(k, p, l, d) for k, p, l, d in PDF_TOOLS]
            head = f'<h3 class="tgroup__h">PDF-Werkstatt <a href="pdf-werkstatt/">Alle PDF-Werkzeuge →</a></h3>'
        else:
            head = f'<h3 class="tgroup__h">{g}</h3>'
        tiles = ''.join(f'<a class="task{" task--lead" if i == 0 and g == "E-Rechnung" else ""}" href="{p}"><svg class="ic" viewBox="0 0 18 18">{ICONS[k]}</svg><span class="task__t">{l}</span><span class="task__d">{d}</span><span class="task__go">Öffnen <i>→</i></span></a>' for i, (k, p, l, d) in enumerate(items))
        cols = 4 if len(items) % 4 == 0 else 3 if len(items) % 3 == 0 else min(len(items), 3)
        out.append(f'        <div class="tgroup">{head}<div class="tasks__grid" style="--cols:{cols}">{tiles}</div></div>')
    out.append('        <div class="also"><span>Direkt zu</span><a href="kontoauszug-in-excel/">Kontoauszug in Excel</a><a href="eigenbeleg-erstellen/">Eigenbeleg</a><a href="bewirtungsbeleg-erstellen/">Bewirtungsbeleg</a><a href="quittung-erstellen/">Quittung</a></div>')
    return '<!--HOMETOOLS-->\n' + '\n'.join(out) + '\n<!--/HOMETOOLS-->'

def subnav(page):
    pre = prefix(page)
    cur = lambda p: ' aria-current="page"' if page['path'] == p else ''
    items = [('pdf', 'pdf-werkstatt/', 'Übersicht')] + [(k, p, l) for k, p, l, _ in PDF_TOOLS]
    wide = ''.join(f'<a href="{pre}{p}"{cur(p)}>{icon(k, "")}{l}</a>' for k, p, l in items)
    here = next((l for k, p, l in items if p == page['path']), 'Übersicht')
    grid = ''.join(f'<a href="{pre}{p}"{cur(p)}>{icon(k, "")}{l}</a>' for k, p, l in items)
    return (f'      <nav class="subnav" aria-label="PDF-Werkzeuge">{wide}</nav>\n'
            f'      <details class="subnav-m"><summary><span>PDF-Werkzeug</span><b>{here}</b></summary><nav class="subnav-m__grid" aria-label="PDF-Werkzeuge">{grid}</nav></details>')

def pdf_grid(page):
    pre = prefix(page)
    return ''.join(f'<a class="task" href="{pre}{p}"><svg class="ic" viewBox="0 0 18 18">{ICONS[k]}</svg><span class="task__t">{l}</span><span class="task__d">{d}</span><span class="task__go">Öffnen <i>→</i></span></a>' for k, p, l, d in PDF_TOOLS)

def kopf(page):
    return ''  # Info-Leiste entfällt

def footer(page):
    pre = prefix(page)
    li = lambda p, l: f'<li><a href="{pre}{p}">{l}</a></li>'
    col_e = ''.join(li(p, l) for _, p, l, _ in NAV_GROUPS[0][1]) + ''.join(li(p, l) for _, p, l, _ in dict(NAV_GROUPS)['Codes'])
    col_b = ''.join(li(p, l) for _, p, l, _ in NAV_GROUPS[1][1]) + li('kontoauszug-in-excel/', 'Kontoauszug in Excel')
    col_p = ''.join(li(p, l) for _, p, l, _ in PDF_TOOLS)
    col_v = ''.join(li(p, f'{n} erstellen') for p, n in VORLAGE_TYPES.values()) + li('rechner/', 'Rechner')
    arts = ''.join(li(p, n) for p, n, _ in ARTICLES)
    return f'''<footer class="colophon">
      <div class="colophon__brand"><b>beleg<i>.org</i></b><span>Werkzeuge für Belege. Kostenlos, ohne Konto, ohne Tracking. Deine Dateien bleiben auf deinem Gerät.</span></div>
      <nav class="colophon__cols" aria-label="Fußzeile">
        <div><p>E-Rechnung &amp; Codes</p><ul>{col_e}</ul></div>
        <div><p>Belege</p><ul>{col_b}</ul></div>
        <div><p>PDF-Werkstatt</p><ul>{col_p}</ul></div>
        <div><p>Vorlagen</p><ul>{col_v}</ul></div>
        <div><p>Ratgeber</p><ul>{arts}<li><a href="{pre}impressum/">Impressum</a></li><li><a href="{pre}datenschutz/">Datenschutz</a></li></ul></div>
      </nav>
      <p class="colophon__legal">Keine Steuer- oder Rechtsberatung. Angaben ohne Gewähr.</p>
    </footer>'''

def render_template(page):
    tpl = (ROOT / 'tools' / 'tpl' / f"{page['tpl']}.html").read_text()
    vars_ = dict(page.get('vars', {}))
    if page['tpl'] == 'tool':
        src = (ROOT / 'tools' / 'tpl' / 'tools' / f"{page['src']}.html").read_text()
        for name, body in re.findall(r'<!--@(\w+)-->\n?(.*?)(?=<!--@\w+-->|\Z)', src, re.S):
            vars_[name] = body.rstrip()
        for k in ('style', 'content', 'script'):
            vars_.setdefault(k, '')
        vars_['subnav'] = subnav(page) if page.get('nav') == 'pdf' else ''
        vars_['body'] = vars_.get('body', '').replace('{{pdfgrid}}', pdf_grid(page))
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
    s = re.sub(r'<aside class="register".*?</aside>(\s*<header class="topbar">.*?</dialog>)?|<!--NAV-->', lambda _: nav(page), s, count=1, flags=re.S)
    s = re.sub(r'\n    <div class="kopf">.*?\n    </div>\n|\n    <!--KOPF-->\n', '\n', s, count=1, flags=re.S)
    s = re.sub(r'<footer class="colophon">.*?</footer>|<!--FOOTER-->', lambda _: footer(page), s, count=1, flags=re.S)
    # Pfad-Präfix in Vorlagen
    if page['kind'] == 'home':
        s = re.sub(r'<!--HOMETOOLS-->.*?<!--/HOMETOOLS-->|<!--HOMETOOLS-->', lambda _: home_tools(page), s, count=1, flags=re.S)
    s = s.replace('{{pre}}', prefix(page))
    s = version_refs(s)
    f.write_text(s)
    return f

# ——— Cache-Versionierung: ?v=<hash> an allen eigenen JS/CSS-Verweisen ———
IMPORT_RE = re.compile(r'''(from\s+['"]|import\(\s*['"])\./([\w-]+)\.js(?:\?v=\w+)?(['"])''')
VERSIONS = {}

def asset_versions():
    js = {f.stem: f for f in (ROOT / 'assets').glob('*.js')}
    norm = {k: IMPORT_RE.sub(lambda m: f'{m.group(1)}./{m.group(2)}.js{m.group(3)}', f.read_text()) for k, f in js.items()}
    deps = {k: set(m.group(2) for m in IMPORT_RE.finditer(v)) & set(js) for k, v in norm.items()}
    memo = {}
    def h(k, stack=()):
        if k in memo: return memo[k]
        sub = ''.join(h(d, stack + (k,)) for d in sorted(deps[k]) if d not in stack)
        memo[k] = hashlib.sha1((norm[k] + sub).encode()).hexdigest()[:8]
        return memo[k]
    for k in js:
        VERSIONS[f'{k}.js'] = h(k)
    for f in (ROOT / 'assets').glob('*.css'):
        VERSIONS[f.name] = hashlib.sha1(f.read_bytes()).hexdigest()[:8]
    fonts = ROOT / 'assets' / 'fonts' / 'fonts.css'
    VERSIONS['fonts/fonts.css'] = hashlib.sha1(fonts.read_bytes()).hexdigest()[:8]
    # Importe in den JS-Dateien selbst versionieren
    for k, f in js.items():
        out = IMPORT_RE.sub(lambda m: f'{m.group(1)}./{m.group(2)}.js?v={VERSIONS[m.group(2) + ".js"]}{m.group(3)}', f.read_text())
        if out != f.read_text():
            f.write_text(out)

def version_refs(s):
    return re.sub(r'(assets/)((?:fonts/)?[\w.-]+\.(?:js|css))(?:\?v=\w+)?(["\'])',
                  lambda m: f'{m.group(1)}{m.group(2)}?v={VERSIONS[m.group(2)]}{m.group(3)}' if m.group(2) in VERSIONS else m.group(0), s)

def main():
    asset_versions()
    for page in PAGES:
        f = file_of(page)
        if page.get('tpl') == 'tool' and not (ROOT / 'tools' / 'tpl' / 'tools' / f"{page['src']}.html").exists():
            print('offen  ', page['path'])
            continue
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
