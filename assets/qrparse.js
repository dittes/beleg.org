// Inhalt eines QR-Codes deuten: Link, GiroCode, WLAN, Kontakt, Termin, E-Mail, Telefon, SMS, Ort, Schweizer QR-Rechnung, Text
import { ibanValid, fmtIban } from './common.js?v=dd1f3874';

const SHORTENERS = /(^|\.)(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|t\.ly|s\.id|rb\.gy|qrco\.de|linktr\.ee)$/i;

function mecard(s, prefix) {
  const out = {};
  for (const part of s.slice(prefix.length).split(/(?<!\\);/)) {
    const i = part.indexOf(':'); if (i < 1) continue;
    const k = part.slice(0, i).toUpperCase(), v = part.slice(i + 1).replace(/\\([;:,\\])/g, '$1');
    if (v) out[k] = out[k] ? `${out[k]}, ${v}` : v;
  }
  return out;
}
function vfield(text, key) {
  const m = text.match(new RegExp(`^${key}(?:;[^:\\n]*)?:(.*)$`, 'gmi'));
  return m ? m.map((l) => l.replace(/^[^:]*:/, '').trim()).filter(Boolean) : [];
}

/** Rückgabe: { type, title, fields: [[k, v]], warnings: [], actions: [{ kind, label, value }] } */
export function parseQr(raw) {
  const s = String(raw).trim();
  const r = { type: 'text', title: 'Text', fields: [], warnings: [], actions: [{ kind: 'copy', label: 'Text kopieren', value: s }] };

  // Link
  if (/^https?:\/\//i.test(s)) {
    let u; try { u = new URL(s); } catch { return r; }
    Object.assign(r, { type: 'url', title: 'Link' });
    r.fields.push(['Domain', u.hostname], ['Adresse', s]);
    if (u.protocol !== 'https:') r.warnings.push('Unverschlüsselte Verbindung (http). Keine persönlichen Daten eingeben.');
    if (/^xn--|\.xn--/.test(u.hostname)) r.warnings.push('Die Domain enthält Sonderzeichen (Punycode). Das kann eine nachgeahmte Adresse sein.');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)) r.warnings.push('Der Link führt direkt auf eine IP-Adresse statt auf eine Domain.');
    if (SHORTENERS.test(u.hostname)) r.warnings.push('Kurz-Link: Das eigentliche Ziel ist nicht erkennbar.');
    if (u.username || u.password) r.warnings.push('Der Link enthält Zugangsdaten. Das ist ein typisches Merkmal von Phishing.');
    r.actions = [{ kind: 'open', label: `${u.hostname} öffnen`, value: s }, { kind: 'copy', label: 'Link kopieren', value: s }];
    return r;
  }
  // GiroCode (EPC)
  if (/^BCD\r?\n/.test(s)) {
    const l = s.split(/\r?\n/);
    const iban = l[6] || '', amount = (l[7] || '').replace(/^EUR/, '');
    Object.assign(r, { type: 'epc', title: 'GiroCode (Überweisung)' });
    r.fields.push(['Empfänger', l[5] || ''], ['IBAN', fmtIban(iban)]);
    if (l[4]) r.fields.push(['BIC', l[4]]);
    if (amount) r.fields.push(['Betrag', `${Number(amount).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`]);
    if (l[9] || l[10]) r.fields.push(['Verwendungszweck', l[10] || l[9]]);
    if (!ibanValid(iban)) r.warnings.push('Die IBAN hat eine ungültige Prüfziffer.');
    r.warnings.push('Prüfe vor dem Überweisen, ob Empfänger und IBAN zum Rechnungssteller passen. Gefälschte Zahlungscodes sind eine bekannte Betrugsmasche.');
    r.actions = [{ kind: 'copy', label: 'IBAN kopieren', value: iban }, { kind: 'copy', label: 'Alle Daten kopieren', value: r.fields.map(([k, v]) => `${k}: ${v}`).join('\n') }];
    return r;
  }
  // Schweizer QR-Rechnung
  if (/^SPC\r?\n/.test(s)) {
    const l = s.split(/\r?\n/);
    Object.assign(r, { type: 'spc', title: 'QR-Rechnung (Schweiz)' });
    r.fields.push(['Empfänger', l[5] || ''], ['IBAN', fmtIban(l[3] || '')]);
    if (l[18]) r.fields.push(['Betrag', `${l[18]} ${l[19] || ''}`]);
    if (l[28]) r.fields.push(['Referenz', l[28]]);
    if (l[29]) r.fields.push(['Mitteilung', l[29]]);
    r.actions = [{ kind: 'copy', label: 'IBAN kopieren', value: l[3] || '' }];
    return r;
  }
  // WLAN
  if (/^WIFI:/i.test(s)) {
    const m = mecard(s, 'WIFI:');
    Object.assign(r, { type: 'wifi', title: 'WLAN-Zugang' });
    r.fields.push(['Netzwerk (SSID)', m.S || ''], ['Verschlüsselung', m.T || 'keine'], ['Passwort', m.P || '–']);
    if (m.H === 'true') r.fields.push(['Versteckt', 'ja']);
    r.actions = m.P ? [{ kind: 'copy', label: 'Passwort kopieren', value: m.P }, { kind: 'copy', label: 'Netzwerkname kopieren', value: m.S || '' }] : [{ kind: 'copy', label: 'Netzwerkname kopieren', value: m.S || '' }];
    return r;
  }
  // Kontakt: vCard / MECARD
  if (/^BEGIN:VCARD/i.test(s)) {
    Object.assign(r, { type: 'vcard', title: 'Kontakt (vCard)' });
    const fn = vfield(s, 'FN')[0] || vfield(s, 'N')[0]?.split(';').filter(Boolean).reverse().join(' ') || '';
    r.fields.push(['Name', fn]);
    for (const [k, lab] of [['ORG', 'Firma'], ['TITLE', 'Position'], ['TEL', 'Telefon'], ['EMAIL', 'E-Mail'], ['URL', 'Web'], ['ADR', 'Adresse']]) for (const v of vfield(s, k)) r.fields.push([lab, v.replace(/;+/g, ' ').trim()]);
    r.actions = [{ kind: 'file', label: 'Kontakt speichern (.vcf)', value: s, name: `${(fn || 'kontakt').replace(/[^\wäöüÄÖÜß-]+/g, '_')}.vcf`, mime: 'text/vcard' }, { kind: 'copy', label: 'Text kopieren', value: s }];
    return r;
  }
  if (/^MECARD:/i.test(s)) {
    const m = mecard(s, 'MECARD:');
    Object.assign(r, { type: 'vcard', title: 'Kontakt' });
    const name = (m.N || '').split(',').reverse().join(' ').trim();
    r.fields.push(['Name', name]);
    if (m.TEL) r.fields.push(['Telefon', m.TEL]); if (m.EMAIL) r.fields.push(['E-Mail', m.EMAIL]); if (m.URL) r.fields.push(['Web', m.URL]); if (m.ADR) r.fields.push(['Adresse', m.ADR]);
    const vcf = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\n${m.TEL ? `TEL:${m.TEL}\n` : ''}${m.EMAIL ? `EMAIL:${m.EMAIL}\n` : ''}${m.URL ? `URL:${m.URL}\n` : ''}END:VCARD\n`;
    r.actions = [{ kind: 'file', label: 'Kontakt speichern (.vcf)', value: vcf, name: 'kontakt.vcf', mime: 'text/vcard' }];
    return r;
  }
  // Termin
  if (/BEGIN:VEVENT/i.test(s)) {
    Object.assign(r, { type: 'event', title: 'Termin' });
    const dt = (v) => (v ? v.replace(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}).*)?$/, (_, y, mo, d, h, mi) => `${d}.${mo}.${y}${h ? ` ${h}:${mi}` : ''}`) : '');
    r.fields.push(['Titel', vfield(s, 'SUMMARY')[0] || ''], ['Beginn', dt(vfield(s, 'DTSTART')[0])], ['Ende', dt(vfield(s, 'DTEND')[0])]);
    if (vfield(s, 'LOCATION')[0]) r.fields.push(['Ort', vfield(s, 'LOCATION')[0]]);
    const ics = /BEGIN:VCALENDAR/i.test(s) ? s : `BEGIN:VCALENDAR\nVERSION:2.0\n${s}\nEND:VCALENDAR\n`;
    r.actions = [{ kind: 'file', label: 'Termin speichern (.ics)', value: ics, name: 'termin.ics', mime: 'text/calendar' }];
    return r;
  }
  // E-Mail
  if (/^mailto:/i.test(s) || /^MATMSG:/i.test(s)) {
    let to, subject = '', body = '';
    if (/^MATMSG:/i.test(s)) { const m = mecard(s, 'MATMSG:'); to = m.TO; subject = m.SUB || ''; body = m.BODY || ''; }
    else { const u = new URL(s); to = decodeURIComponent(u.pathname); subject = u.searchParams.get('subject') || ''; body = u.searchParams.get('body') || ''; }
    Object.assign(r, { type: 'mail', title: 'E-Mail' });
    r.fields.push(['An', to || '']); if (subject) r.fields.push(['Betreff', subject]); if (body) r.fields.push(['Text', body]);
    r.actions = [{ kind: 'open', label: 'E-Mail schreiben', value: `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` }, { kind: 'copy', label: 'Adresse kopieren', value: to || '' }];
    return r;
  }
  // Telefon / SMS
  if (/^tel:/i.test(s)) {
    const n = s.slice(4);
    Object.assign(r, { type: 'tel', title: 'Telefonnummer', fields: [['Nummer', n]], actions: [{ kind: 'open', label: 'Anrufen', value: s }, { kind: 'copy', label: 'Nummer kopieren', value: n }] });
    return r;
  }
  if (/^(sms|smsto):/i.test(s)) {
    const [, n = '', text = ''] = s.match(/^(?:sms|smsto):([^:?]*)[:?]?(?:body=)?(.*)$/i) || [];
    Object.assign(r, { type: 'sms', title: 'SMS', fields: [['Nummer', n], ['Text', decodeURIComponent(text)]], actions: [{ kind: 'copy', label: 'Nummer kopieren', value: n }] });
    return r;
  }
  // Ort
  if (/^geo:/i.test(s)) {
    const [lat, lon] = s.slice(4).split(/[,;?]/);
    Object.assign(r, { type: 'geo', title: 'Ort', fields: [['Breite', lat], ['Länge', lon]], actions: [{ kind: 'open', label: 'In OpenStreetMap öffnen', value: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}` }] });
    return r;
  }
  r.fields.push(['Inhalt', s]);
  return r;
}
