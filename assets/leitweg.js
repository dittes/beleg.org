// Leitweg-ID (Adressierung von E-Rechnungen an die öffentliche Verwaltung)
// Aufbau: Grobadressierung (2–12 Ziffern) – Feinadressierung (optional, bis 30 Zeichen A–Z, 0–9) – Prüfziffer (2 Ziffern)
// Prüfziffer nach ISO/IEC 7064, Mod 97-10 (wie IBAN).

export function checkDigits(body) {
  const s = String(body).replace(/-/g, '').toUpperCase();
  let rem = 0;
  for (const ch of s + '00') {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return String(98 - rem).padStart(2, '0');
}

const GROB = {
  '99': 'Bund', '01': 'Schleswig-Holstein', '02': 'Hamburg', '03': 'Niedersachsen', '04': 'Bremen', '05': 'Nordrhein-Westfalen',
  '06': 'Hessen', '07': 'Rheinland-Pfalz', '08': 'Baden-Württemberg', '09': 'Bayern', '10': 'Saarland', '11': 'Berlin',
  '12': 'Brandenburg', '13': 'Mecklenburg-Vorpommern', '14': 'Sachsen', '15': 'Sachsen-Anhalt', '16': 'Thüringen',
};

/** Prüft eine Leitweg-ID. Rückgabe { ok, errors[], parts, expected, region } */
export function validate(input) {
  const raw = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
  const errors = [];
  const parts = raw.split('-');
  let grob = '', fein = '', pz = '';
  if (parts.length === 3) [grob, fein, pz] = parts;
  else if (parts.length === 2) [grob, pz] = parts;
  else errors.push('Eine Leitweg-ID besteht aus zwei oder drei Teilen, getrennt durch Bindestriche.');
  if (grob && !/^\d{2,12}$/.test(grob)) errors.push('Die Grobadressierung muss aus 2 bis 12 Ziffern bestehen.');
  if (fein && !/^[A-Z0-9]{1,30}$/.test(fein)) errors.push('Die Feinadressierung darf nur Buchstaben und Ziffern enthalten (max. 30).');
  if (pz && !/^\d{2}$/.test(pz)) errors.push('Die Prüfziffer besteht aus genau 2 Ziffern.');
  const expected = grob ? checkDigits(grob + fein) : '';
  if (!errors.length && pz !== expected) errors.push(`Die Prüfziffer stimmt nicht: erwartet ${expected}, angegeben ${pz}.`);
  const region = GROB[grob.slice(0, 2)] || '';
  return { ok: !errors.length && !!raw, errors, parts: { grob, fein, pz }, expected, region, normalized: [grob, fein, expected].filter(Boolean).join('-') };
}

export const looksLikeLeitweg = (s) => /^\d{2,12}(-[A-Z0-9]{1,30})?-\d{2}$/i.test(String(s || '').trim());
