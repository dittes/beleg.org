# beleg.org

Werkzeuge für Belege – statisch, ohne Build-Schritt für die Laufzeit, alles läuft im Browser (kein Upload, kein Konto, kein Tracking).

## Seiten

| Pfad | Inhalt |
|---|---|
| `/` | Startseite / Übersicht |
| `/e-rechnung-pruefen/` | XRechnung, ZUGFeRD, Factur-X lesen & prüfen (CII + UBL, auch PDF mit eingebettetem XML) |
| `/e-rechnung-erstellen/` | XRechnung 3.0 (XML) oder PDF mit eingebettetem `factur-x.xml` erstellen |
| `/beleg-scannen/` | Kamera → Ränder erkennen → entzerren → Filter → PDF/JPG |
| `/belege-auslesen/` | OCR für Kassenbons/Rechnungen → Tabelle → XLSX/CSV |
| `/kontoauszug-in-excel/` | Wie oben, voreingestellt auf Kontoauszüge (Saldenabgleich) |
| `/eigenbeleg-erstellen/`, `/bewirtungsbeleg-erstellen/`, `/quittung-erstellen/` | Belegvorlagen mit A4-Vorschau |
| `/aufbewahrungsfristen/` | Fristenrechner + Schredder-Plan (Rechtsstand 2025, BEG IV) |
| `/ratgeber/` + `/belegpflicht/`, `/beleg-vs-quittung/`, `/beleg-digitalisieren/`, `/e-rechnungspflicht/` | Ratgeber |
| `/impressum/`, `/datenschutz/`, `/404.html` | Rechtliches |

## Seiten erzeugen

Navigation, Kopfzeile, Fußzeile, Meta-Tags (Title, Description, Canonical, Open Graph, JSON-LD inkl. FAQPage aus den sichtbaren FAQs), `sitemap.xml` und `robots.txt` schreibt ein Generator:

```bash
python3 tools/site.py
```

- Seitenkonfiguration (Titel, Beschreibungen, Navigation): `tools/site.py`
- Vorlagen für Seitenfamilien: `tools/tpl/` (`auslesen.html` → 2 Seiten, `vorlage.html` → 3 Seiten, plus Textbausteine)
- Alle anderen Seiten werden direkt bearbeitet; der Generator ersetzt nur die markierten Bereiche.

## Lokal starten

```bash
python3 -m http.server 4173
```

## Aufbau

- `assets/site.css` – Designsystem
- `assets/einvoice.js` – E-Rechnung lesen (CII/UBL), prüfen, darstellen, erzeugen (CII)
- `assets/recognize.js` – Erkennungsregeln Kontoauszug/Beleg (reine Funktionen, in Node testbar)
- `assets/imaging.js` – Scanner-Bildverarbeitung (Kantenerkennung, Entzerrung, Filter)
- `assets/viewer.js`, `rechnung.js`, `scanner.js`, `erkennen.js`, `werkstatt.js`, `fristen.js` – je Werkzeug
- `vendor/` – selbst gehostete Bibliotheken: pdf.js, pdf-lib, Tesseract.js (+ Sprachmodell `deu`), SheetJS
- `assets/fonts/` – selbst gehostete Schriften (keine Verbindung zu Google)

Die E-Rechnungs-Prüfung ist eine Plausibilitätsprüfung und ersetzt nicht die Schematron-Validierung des KoSIT-Validators. Die erzeugte ZUGFeRD-PDF ist nicht PDF/A-3-zertifiziert.
