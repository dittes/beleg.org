// E-Rechnung: Lesen (CII + UBL), Prüfen, Darstellen und Erzeugen (CII).
// Alles läuft im Browser.

import { esc, money, dec, fmtDate, round2, ibanValid, fmtIban } from './common.js';

/* ————————————————— XML-Helfer ————————————————— */
const kids = (el, name) => el ? [...el.children].filter((c) => c.localName === name) : [];
const kid = (el, name) => kids(el, name)[0] || null;
function at(el, ...path) {
  let cur = el;
  for (const p of path) { cur = kid(cur, p); if (!cur) return null; }
  return cur;
}
const txt = (el, ...path) => { const n = path.length ? at(el, ...path) : el; return n ? n.textContent.trim() : ''; };
const num = (el, ...path) => { const t = txt(el, ...path); return t === '' ? null : Number(t); };
const d102 = (s) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s || '');

export const TYPE_CODES = {
  '380': 'Rechnung', '381': 'Gutschrift', '384': 'Korrekturrechnung', '389': 'Gutschrift (Selbstfakturierung)',
  '326': 'Teilrechnung', '875': 'Teilschlussrechnung', '876': 'Teilrechnung', '877': 'Schlussrechnung', '751': 'Rechnungsinformation',
};
export const UNIT_CODES = {
  C62: 'Stk.', H87: 'Stk.', XPP: 'Stk.', HUR: 'Std.', DAY: 'Tag(e)', MON: 'Monat(e)', WEE: 'Woche(n)', ANN: 'Jahr(e)', MIN: 'Min.',
  LS: 'pauschal', KGM: 'kg', GRM: 'g', MTR: 'm', MTK: 'm²', MTQ: 'm³', LTR: 'l', KMT: 'km', KWH: 'kWh', SET: 'Satz', P1: '%',
};
export const TAX_CATEGORIES = {
  S: 'Regelsatz', Z: 'Nullsatz', E: 'steuerbefreit', AE: 'Reverse Charge', K: 'innergem. Lieferung', G: 'Ausfuhr', O: 'nicht steuerbar', L: 'IGIC', M: 'IPSI',
};
export const MEANS_CODES = { '58': 'SEPA-Überweisung', '30': 'Überweisung', '59': 'SEPA-Lastschrift', '42': 'Zahlung auf Bankkonto', '48': 'Kartenzahlung', '49': 'Lastschrift', '57': 'Dauerauftrag', '10': 'Bar', '1': 'nicht definiert', '97': 'Verrechnung', 'ZZZ': 'sonstige' };

/* ————————————————— Erkennen & Lesen ————————————————— */
export function parseXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('Die Datei ist kein gültiges XML.');
  const root = doc.documentElement;
  if (root.localName === 'CrossIndustryInvoice') return parseCII(root);
  if (root.localName === 'Invoice' || root.localName === 'CreditNote') return parseUBL(root);
  if (root.localName === 'CrossIndustryDocument') throw new Error('Das ist ein ZUGFeRD-1.0-Dokument. Diese veraltete Version wird nicht unterstützt.');
  throw new Error(`Unbekanntes Format (<${root.localName}>). Erwartet: XRechnung/ZUGFeRD (CII) oder UBL.`);
}

function party(p) {
  if (!p) return null;
  const addr = kid(p, 'PostalTradeAddress');
  let vatId = '', taxNo = '';
  for (const r of kids(p, 'SpecifiedTaxRegistration')) {
    const id = kid(r, 'ID');
    if (!id) continue;
    if (id.getAttribute('schemeID') === 'VA') vatId = id.textContent.trim();
    else if (id.getAttribute('schemeID') === 'FC') taxNo = id.textContent.trim();
  }
  const c = kid(p, 'DefinedTradeContact');
  return {
    name: txt(p, 'Name'),
    legalId: txt(p, 'SpecifiedLegalOrganization', 'ID'),
    tradeName: txt(p, 'SpecifiedLegalOrganization', 'TradingBusinessName'),
    street: [txt(addr, 'LineOne'), txt(addr, 'LineTwo'), txt(addr, 'LineThree')].filter(Boolean).join(', '),
    zip: txt(addr, 'PostcodeCode'), city: txt(addr, 'CityName'), country: txt(addr, 'CountryID'),
    vatId, taxNo,
    endpoint: txt(p, 'URIUniversalCommunication', 'URIID'),
    contact: c ? {
      name: txt(c, 'PersonName') || txt(c, 'DepartmentName'),
      phone: txt(c, 'TelephoneUniversalCommunication', 'CompleteNumber'),
      email: txt(c, 'EmailURIUniversalCommunication', 'URIID'),
    } : null,
  };
}

function parseCII(root) {
  const ctx = kid(root, 'ExchangedDocumentContext');
  const docEl = kid(root, 'ExchangedDocument');
  const tx = kid(root, 'SupplyChainTradeTransaction');
  const agr = kid(tx, 'ApplicableHeaderTradeAgreement');
  const del = kid(tx, 'ApplicableHeaderTradeDelivery');
  const set = kid(tx, 'ApplicableHeaderTradeSettlement');
  const sum = kid(set, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const means = kid(set, 'SpecifiedTradeSettlementPaymentMeans');
  const terms = kids(set, 'SpecifiedTradePaymentTerms');
  const period = kid(set, 'BillingSpecifiedPeriod');

  const lines = kids(tx, 'IncludedSupplyChainTradeLineItem').map((li) => {
    const qEl = at(li, 'SpecifiedLineTradeDelivery', 'BilledQuantity');
    const priceEl = at(li, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice');
    const tax = at(li, 'SpecifiedLineTradeSettlement', 'ApplicableTradeTax');
    const basis = priceEl ? kid(priceEl, 'BasisQuantity') : null;
    return {
      id: txt(li, 'AssociatedDocumentLineDocument', 'LineID'),
      note: txt(li, 'AssociatedDocumentLineDocument', 'IncludedNote', 'Content'),
      name: txt(li, 'SpecifiedTradeProduct', 'Name'),
      desc: txt(li, 'SpecifiedTradeProduct', 'Description'),
      sku: txt(li, 'SpecifiedTradeProduct', 'SellerAssignedID'),
      qty: qEl ? Number(qEl.textContent) : null,
      unit: qEl?.getAttribute('unitCode') || '',
      price: num(priceEl, 'ChargeAmount'),
      priceBase: basis ? Number(basis.textContent) || 1 : 1,
      net: num(li, 'SpecifiedLineTradeSettlement', 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount'),
      taxCat: txt(tax, 'CategoryCode'),
      taxRate: num(tax, 'RateApplicablePercent'),
    };
  });

  const taxes = kids(set, 'ApplicableTradeTax').map((t) => ({
    cat: txt(t, 'CategoryCode'), rate: num(t, 'RateApplicablePercent'),
    basis: num(t, 'BasisAmount'), amount: num(t, 'CalculatedAmount'),
    reason: txt(t, 'ExemptionReason'), reasonCode: txt(t, 'ExemptionReasonCode'),
  }));

  const allowances = kids(set, 'SpecifiedTradeAllowanceCharge').map((a) => ({
    charge: txt(a, 'ChargeIndicator', 'Indicator') === 'true',
    amount: num(a, 'ActualAmount'), reason: txt(a, 'Reason'),
    taxCat: txt(a, 'CategoryTradeTax', 'CategoryCode'), taxRate: num(a, 'CategoryTradeTax', 'RateApplicablePercent'),
  }));

  // Steuerbetrag in Rechnungswährung (es kann zwei TaxTotalAmount geben)
  const cur = txt(set, 'InvoiceCurrencyCode');
  const taxTotals = kids(sum, 'TaxTotalAmount');
  const taxTotalEl = taxTotals.find((e) => !e.getAttribute('currencyID') || e.getAttribute('currencyID') === cur) || taxTotals[0];

  return {
    format: 'CII',
    syntax: 'UN/CEFACT CII',
    profile: txt(ctx, 'GuidelineSpecifiedDocumentContextParameter', 'ID'),
    businessProcess: txt(ctx, 'BusinessProcessSpecifiedDocumentContextParameter', 'ID'),
    number: txt(docEl, 'ID'),
    typeCode: txt(docEl, 'TypeCode'),
    issueDate: d102(txt(docEl, 'IssueDateTime', 'DateTimeString')),
    notes: kids(docEl, 'IncludedNote').map((n) => txt(n, 'Content')).filter(Boolean),
    currency: cur,
    buyerReference: txt(agr, 'BuyerReference'),
    orderRef: txt(agr, 'BuyerOrderReferencedDocument', 'IssuerAssignedID'),
    contractRef: txt(agr, 'ContractReferencedDocument', 'IssuerAssignedID'),
    seller: party(kid(agr, 'SellerTradeParty')),
    buyer: party(kid(agr, 'BuyerTradeParty')),
    deliveryDate: d102(txt(del, 'ActualDeliverySupplyChainEvent', 'OccurrenceDateTime', 'DateTimeString')),
    period: period ? { start: d102(txt(period, 'StartDateTime', 'DateTimeString')), end: d102(txt(period, 'EndDateTime', 'DateTimeString')) } : null,
    payment: {
      meansCode: txt(means, 'TypeCode'),
      info: txt(means, 'Information'),
      iban: txt(means, 'PayeePartyCreditorFinancialAccount', 'IBANID'),
      accountName: txt(means, 'PayeePartyCreditorFinancialAccount', 'AccountName'),
      bic: txt(means, 'PayeeSpecifiedCreditorFinancialInstitution', 'BICID'),
      reference: txt(set, 'PaymentReference'),
      terms: terms.map((t) => txt(t, 'Description')).filter(Boolean).join(' '),
      dueDate: d102(terms.map((t) => txt(t, 'DueDateDateTime', 'DateTimeString')).find(Boolean) || ''),
    },
    allowances,
    lines, taxes,
    totals: {
      lines: num(sum, 'LineTotalAmount'), charges: num(sum, 'ChargeTotalAmount'), allowances: num(sum, 'AllowanceTotalAmount'),
      taxBasis: num(sum, 'TaxBasisTotalAmount'), tax: taxTotalEl ? Number(taxTotalEl.textContent) : null,
      rounding: num(sum, 'RoundingAmount'),
      grand: num(sum, 'GrandTotalAmount'), prepaid: num(sum, 'TotalPrepaidAmount'), due: num(sum, 'DuePayableAmount'),
    },
  };
}

function ublParty(p) {
  if (!p) return null;
  const addr = kid(p, 'PostalAddress');
  let vatId = '', taxNo = '';
  for (const s of kids(p, 'PartyTaxScheme')) {
    const id = txt(s, 'CompanyID'), scheme = txt(s, 'TaxScheme', 'ID');
    if (scheme === 'VAT') vatId = id; else taxNo = id;
  }
  const c = kid(p, 'Contact');
  return {
    name: txt(p, 'PartyName', 'Name') || txt(p, 'PartyLegalEntity', 'RegistrationName'),
    legalId: txt(p, 'PartyLegalEntity', 'CompanyID'),
    tradeName: '',
    street: [txt(addr, 'StreetName'), txt(addr, 'AdditionalStreetName')].filter(Boolean).join(', '),
    zip: txt(addr, 'PostalZone'), city: txt(addr, 'CityName'), country: txt(addr, 'Country', 'IdentificationCode'),
    vatId, taxNo,
    endpoint: txt(p, 'EndpointID'),
    contact: c ? { name: txt(c, 'Name'), phone: txt(c, 'Telephone'), email: txt(c, 'ElectronicMail') } : null,
  };
}

function parseUBL(root) {
  const credit = root.localName === 'CreditNote';
  const mt = kid(root, 'LegalMonetaryTotal');
  const taxTotals = kids(root, 'TaxTotal');
  const cur = txt(root, 'DocumentCurrencyCode');
  const mainTax = taxTotals.find((t) => kid(t, 'TaxAmount')?.getAttribute('currencyID') === cur) || taxTotals[0];
  const means = kid(root, 'PaymentMeans');
  const period = kid(root, 'InvoicePeriod');
  const lines = kids(root, credit ? 'CreditNoteLine' : 'InvoiceLine').map((l) => {
    const q = kid(l, credit ? 'CreditedQuantity' : 'InvoicedQuantity');
    const cat = at(l, 'Item', 'ClassifiedTaxCategory');
    const bq = at(l, 'Price', 'BaseQuantity');
    return {
      id: txt(l, 'ID'), note: txt(l, 'Note'),
      name: txt(l, 'Item', 'Name'), desc: txt(l, 'Item', 'Description'), sku: txt(l, 'Item', 'SellersItemIdentification', 'ID'),
      qty: q ? Number(q.textContent) : null, unit: q?.getAttribute('unitCode') || '',
      price: num(l, 'Price', 'PriceAmount'), priceBase: bq ? Number(bq.textContent) || 1 : 1,
      net: num(l, 'LineExtensionAmount'),
      taxCat: txt(cat, 'ID'), taxRate: num(cat, 'Percent'),
    };
  });
  return {
    format: 'UBL',
    syntax: 'OASIS UBL 2.1',
    profile: txt(root, 'CustomizationID'),
    businessProcess: txt(root, 'ProfileID'),
    number: txt(root, 'ID'),
    typeCode: txt(root, credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'),
    issueDate: txt(root, 'IssueDate'),
    notes: kids(root, 'Note').map((n) => n.textContent.trim()).filter(Boolean),
    currency: cur,
    buyerReference: txt(root, 'BuyerReference'),
    orderRef: txt(root, 'OrderReference', 'ID'),
    contractRef: txt(root, 'ContractDocumentReference', 'ID'),
    seller: ublParty(at(root, 'AccountingSupplierParty', 'Party')),
    buyer: ublParty(at(root, 'AccountingCustomerParty', 'Party')),
    deliveryDate: txt(root, 'Delivery', 'ActualDeliveryDate'),
    period: period ? { start: txt(period, 'StartDate'), end: txt(period, 'EndDate') } : null,
    payment: {
      meansCode: txt(means, 'PaymentMeansCode'),
      info: '',
      iban: txt(means, 'PayeeFinancialAccount', 'ID'),
      accountName: txt(means, 'PayeeFinancialAccount', 'Name'),
      bic: txt(means, 'PayeeFinancialAccount', 'FinancialInstitutionBranch', 'ID'),
      reference: txt(means, 'PaymentID'),
      terms: txt(root, 'PaymentTerms', 'Note'),
      dueDate: txt(root, 'DueDate') || txt(means, 'PaymentDueDate'),
    },
    allowances: kids(root, 'AllowanceCharge').map((a) => ({
      charge: txt(a, 'ChargeIndicator') === 'true', amount: num(a, 'Amount'),
      reason: txt(a, 'AllowanceChargeReason'), taxCat: txt(a, 'TaxCategory', 'ID'), taxRate: num(a, 'TaxCategory', 'Percent'),
    })),
    lines,
    taxes: kids(mainTax, 'TaxSubtotal').map((s) => ({
      cat: txt(s, 'TaxCategory', 'ID'), rate: num(s, 'TaxCategory', 'Percent'),
      basis: num(s, 'TaxableAmount'), amount: num(s, 'TaxAmount'),
      reason: txt(s, 'TaxCategory', 'TaxExemptionReason'), reasonCode: txt(s, 'TaxCategory', 'TaxExemptionReasonCode'),
    })),
    totals: {
      lines: num(mt, 'LineExtensionAmount'), charges: num(mt, 'ChargeTotalAmount'), allowances: num(mt, 'AllowanceTotalAmount'),
      taxBasis: num(mt, 'TaxExclusiveAmount'), tax: num(mainTax, 'TaxAmount'), rounding: num(mt, 'PayableRoundingAmount'),
      grand: num(mt, 'TaxInclusiveAmount'), prepaid: num(mt, 'PrepaidAmount'), due: num(mt, 'PayableAmount'),
    },
  };
}

/* ————————————————— Profil erkennen ————————————————— */
export function describeProfile(p = '') {
  const s = p.toLowerCase();
  if (s.includes('xrechnung')) {
    const v = (p.match(/xrechnung_(\d+\.\d+)/i) || [])[1];
    return { name: `XRechnung${v ? ' ' + v : ''}`, xr: true, level: 'EN 16931 + CIUS DE' };
  }
  if (s.includes('#conformant#urn:factur-x.eu:1p0:extended') || s.includes('extended')) return { name: 'ZUGFeRD / Factur-X Extended', level: 'EN 16931 erweitert' };
  if (s.includes('en16931') && !s.includes('#')) return { name: 'ZUGFeRD / Factur-X EN 16931', level: 'EN 16931 (Comfort)' };
  if (s.includes('basicwl')) return { name: 'ZUGFeRD / Factur-X Basic WL', level: 'keine vollständige E-Rechnung', weak: true };
  if (s.includes('basic')) return { name: 'ZUGFeRD / Factur-X Basic', level: 'Teilmenge von EN 16931' };
  if (s.includes('minimum')) return { name: 'ZUGFeRD / Factur-X Minimum', level: 'keine vollständige E-Rechnung', weak: true };
  if (s.includes('peppol')) return { name: 'Peppol BIS Billing 3.0', level: 'EN 16931 + CIUS Peppol' };
  if (s.includes('en16931')) return { name: 'EN 16931', level: 'EN 16931' };
  return { name: p || 'unbekannt', level: '–' };
}

/* ————————————————— Prüfung ————————————————— */
// Plausibilitätsprüfung – ersetzt keine vollständige Schematron-Validierung (KoSIT).
export function check(m) {
  const out = [];
  const add = (level, code, text, detail = '') => out.push({ level, code, text, detail });
  const near = (a, b, tol = 0.011) => a !== null && b !== null && Math.abs(a - b) <= tol;
  const prof = describeProfile(m.profile);
  const t = m.totals;

  // Pflichtangaben
  if (prof.weak) add('warn', 'Profil', `Profil ${prof.name} gilt in Deutschland nicht als E-Rechnung.`, 'Minimum und Basic WL enthalten keine Rechnungspositionen und reichen für den Vorsteuerabzug nicht aus.');
  add(m.number ? 'ok' : 'err', 'BT-1', m.number ? 'Rechnungsnummer vorhanden' : 'Rechnungsnummer fehlt');
  add(m.issueDate && !Number.isNaN(Date.parse(m.issueDate)) ? 'ok' : 'err', 'BT-2', m.issueDate ? 'Rechnungsdatum vorhanden' : 'Rechnungsdatum fehlt');
  add(TYPE_CODES[m.typeCode] ? 'ok' : 'warn', 'BT-3', TYPE_CODES[m.typeCode] ? `Rechnungsart: ${TYPE_CODES[m.typeCode]} (${m.typeCode})` : `Ungewöhnlicher Rechnungstyp: ${m.typeCode || 'fehlt'}`);
  add(m.currency ? 'ok' : 'err', 'BT-5', m.currency ? `Währung: ${m.currency}` : 'Währung fehlt');

  const s = m.seller || {}, b = m.buyer || {};
  add(s.name ? 'ok' : 'err', 'BT-27', s.name ? 'Name des Verkäufers vorhanden' : 'Name des Verkäufers fehlt');
  add(s.city && s.zip && s.country ? 'ok' : 'err', 'BG-5', s.city && s.zip && s.country ? 'Anschrift des Verkäufers vollständig' : 'Anschrift des Verkäufers unvollständig', 'Ort, PLZ und Land sind erforderlich.');
  add(b.name ? 'ok' : 'err', 'BT-44', b.name ? 'Name des Käufers vorhanden' : 'Name des Käufers fehlt');
  add(b.city && b.zip && b.country ? 'ok' : 'warn', 'BG-8', b.city && b.zip && b.country ? 'Anschrift des Käufers vollständig' : 'Anschrift des Käufers unvollständig');

  const hasS = m.taxes.some((x) => x.cat === 'S') || m.lines.some((l) => l.taxCat === 'S');
  if (s.vatId || s.taxNo) {
    add('ok', '§14 UStG', `Steuernummer/USt-IdNr. des Verkäufers: ${s.vatId || s.taxNo}`);
    if (s.vatId && s.vatId.startsWith('DE') && !/^DE\d{9}$/.test(s.vatId.replace(/\s/g, ''))) add('warn', 'BT-31', 'USt-IdNr. hat nicht das deutsche Format DE + 9 Ziffern');
  } else add(hasS ? 'err' : 'warn', 'BR-CO-26', 'Weder USt-IdNr. noch Steuernummer des Verkäufers angegeben');

  if (m.deliveryDate || (m.period && (m.period.start || m.period.end))) add('ok', '§14 UStG', 'Leistungsdatum bzw. -zeitraum angegeben');
  else add('warn', '§14 UStG', 'Kein Leistungsdatum angegeben', 'Nach § 14 Abs. 4 Nr. 6 UStG nötig – außer es stimmt mit dem Rechnungsdatum überein und die Rechnung sagt das.');

  // Positionen
  if (!m.lines.length) add('err', 'BG-25', 'Keine Rechnungspositionen enthalten');
  else {
    add('ok', 'BG-25', `${m.lines.length} Position${m.lines.length === 1 ? '' : 'en'} enthalten`);
    const bad = m.lines.filter((l) => l.qty !== null && l.price !== null && l.net !== null && !near(round2(l.qty * l.price / (l.priceBase || 1)), l.net, 0.02));
    if (bad.length) add('warn', 'BT-131', `Bei ${bad.length} Position${bad.length === 1 ? '' : 'en'} ergibt Menge × Preis nicht den Nettobetrag`, `Betrifft Position ${bad.map((l) => l.id || '?').join(', ')}. Das kann bei Rabatten auf Positionsebene korrekt sein.`);
    const noName = m.lines.filter((l) => !l.name);
    if (noName.length) add('err', 'BT-153', `${noName.length} Position(en) ohne Bezeichnung`);
  }

  // Summen
  const lineSum = round2(m.lines.reduce((a, l) => a + (l.net || 0), 0));
  if (t.lines !== null) add(near(lineSum, t.lines) ? 'ok' : 'err', 'BR-CO-10', near(lineSum, t.lines) ? 'Summe der Positionen stimmt' : 'Summe der Positionen weicht ab', `Berechnet ${money(lineSum, m.currency)}, angegeben ${money(t.lines, m.currency)}.`);
  const basisCalc = round2((t.lines || 0) - (t.allowances || 0) + (t.charges || 0));
  if (t.taxBasis !== null) add(near(basisCalc, t.taxBasis) ? 'ok' : 'err', 'BR-CO-13', near(basisCalc, t.taxBasis) ? 'Nettobetrag stimmt' : 'Nettobetrag weicht ab', `Positionen − Nachlässe + Zuschläge = ${money(basisCalc, m.currency)}, angegeben ${money(t.taxBasis, m.currency)}.`);

  let taxOk = true;
  for (const x of m.taxes) {
    if (x.rate !== null && x.basis !== null && x.amount !== null) {
      const exp = round2(x.basis * x.rate / 100);
      if (!near(exp, x.amount)) { taxOk = false; add('err', 'BR-CO-17', `Steuer bei ${dec(x.rate)} % stimmt nicht`, `${money(x.basis, m.currency)} × ${dec(x.rate)} % = ${money(exp, m.currency)}, angegeben ${money(x.amount, m.currency)}.`); }
    }
    if (['E', 'AE', 'K', 'G', 'O'].includes(x.cat) && !x.reason && !x.reasonCode) add('err', 'BR-E-10', `Steuerbefreiung (${x.cat}) ohne Begründung`, 'Zum Beispiel „Kleinunternehmer gemäß § 19 UStG“.');
  }
  if (m.taxes.length && taxOk) add('ok', 'BR-CO-17', 'Steuerbeträge je Steuersatz stimmen');
  if (!m.taxes.length) add('err', 'BG-23', 'Keine Umsatzsteueraufschlüsselung enthalten');
  const taxSum = round2(m.taxes.reduce((a, x) => a + (x.amount || 0), 0));
  if (t.tax !== null) add(near(taxSum, t.tax) ? 'ok' : 'err', 'BR-CO-14', near(taxSum, t.tax) ? 'Umsatzsteuer gesamt stimmt' : 'Umsatzsteuer gesamt weicht ab', `Summe der Steuersätze ${money(taxSum, m.currency)}, angegeben ${money(t.tax, m.currency)}.`);
  if (t.grand !== null && t.taxBasis !== null) {
    const g = round2(t.taxBasis + (t.tax || 0));
    add(near(g, t.grand) ? 'ok' : 'err', 'BR-CO-15', near(g, t.grand) ? 'Bruttobetrag stimmt' : 'Bruttobetrag weicht ab', `Netto + Steuer = ${money(g, m.currency)}, angegeben ${money(t.grand, m.currency)}.`);
  }
  if (t.due !== null && t.grand !== null) {
    const d = round2(t.grand - (t.prepaid || 0) + (t.rounding || 0));
    add(near(d, t.due) ? 'ok' : 'err', 'BR-CO-16', near(d, t.due) ? 'Zahlbetrag stimmt' : 'Zahlbetrag weicht ab', `Brutto − Anzahlungen = ${money(d, m.currency)}, angegeben ${money(t.due, m.currency)}.`);
  }

  // Zahlung
  const p = m.payment;
  if (t.due > 0 && !p.dueDate && !p.terms) add('err', 'BR-CO-25', 'Zahlbetrag offen, aber weder Fälligkeitsdatum noch Zahlungsbedingungen');
  else if (p.dueDate || p.terms) add('ok', 'BT-9/20', p.dueDate ? `Fällig am ${fmtDate(p.dueDate)}` : 'Zahlungsbedingungen angegeben');
  if (p.iban) add(ibanValid(p.iban) ? 'ok' : 'err', 'BT-84', ibanValid(p.iban) ? 'IBAN-Prüfziffer korrekt' : 'IBAN ist ungültig (Prüfziffer)', fmtIban(p.iban));
  else if (['58', '30', '42'].includes(p.meansCode)) add('err', 'BR-61', 'Überweisung angegeben, aber keine IBAN');

  // XRechnung-Zusatzregeln
  if (prof.xr) {
    add(m.buyerReference ? 'ok' : 'err', 'BR-DE-15', m.buyerReference ? `Käuferreferenz / Leitweg-ID: ${m.buyerReference}` : 'Käuferreferenz (Leitweg-ID) fehlt – Pflicht in XRechnung');
    const c = s.contact || {};
    add(c.name && c.phone && c.email ? 'ok' : 'err', 'BR-DE-2', c.name && c.phone && c.email ? 'Kontakt des Verkäufers vollständig' : 'Kontakt des Verkäufers unvollständig', 'XRechnung verlangt Name, Telefon und E-Mail.');
    add(s.endpoint ? 'ok' : 'err', 'BT-34', s.endpoint ? 'Elektronische Adresse des Verkäufers vorhanden' : 'Elektronische Adresse des Verkäufers fehlt');
    add(b.endpoint ? 'ok' : 'err', 'BT-49', b.endpoint ? 'Elektronische Adresse des Käufers vorhanden' : 'Elektronische Adresse des Käufers fehlt');
    add(p.meansCode ? 'ok' : 'err', 'BR-DE-1', p.meansCode ? `Zahlungsart: ${MEANS_CODES[p.meansCode] || p.meansCode}` : 'Zahlungsart fehlt');
    if (/^\d{2,12}-[A-Za-z0-9]{0,30}-\d{2}$/.test(m.buyerReference) || /^\d{2,12}-\d{2}$/.test(m.buyerReference)) add('ok', 'Leitweg-ID', 'Käuferreferenz hat das Format einer Leitweg-ID (öffentliche Hand)');
  }

  const score = { ok: out.filter((x) => x.level === 'ok').length, warn: out.filter((x) => x.level === 'warn').length, err: out.filter((x) => x.level === 'err').length };
  return { items: out, score, profile: prof };
}

/* ————————————————— Lesefassung (HTML) ————————————————— */
const addrBlock = (p) => {
  if (!p) return '<p class="small">–</p>';
  const lines = [p.street, [p.zip, p.city].filter(Boolean).join(' '), p.country && p.country !== 'DE' ? p.country : ''].filter(Boolean);
  return `<p class="inv__name">${esc(p.name || '–')}</p><p>${lines.map(esc).join('<br>')}</p>`;
};

export function renderInvoice(m, { compact = false } = {}) {
  const cur = m.currency || 'EUR';
  const prof = describeProfile(m.profile);
  const s = m.seller || {}, b = m.buyer || {};
  const title = TYPE_CODES[m.typeCode] || 'Rechnung';
  const rows = m.lines.map((l) => `
    <tr>
      <td class="mono muted">${esc(l.id)}</td>
      <td><b>${esc(l.name || '–')}</b>${l.desc ? `<div class="inv__desc">${esc(l.desc)}</div>` : ''}${l.note ? `<div class="inv__desc">${esc(l.note)}</div>` : ''}</td>
      <td class="r num">${l.qty !== null ? dec(l.qty, 4) : '–'} <span class="muted">${esc(UNIT_CODES[l.unit] || l.unit)}</span></td>
      <td class="r num">${l.price !== null ? money(l.price, cur) : '–'}</td>
      <td class="r num muted">${l.taxRate !== null ? dec(l.taxRate) + ' %' : esc(l.taxCat)}</td>
      <td class="r num"><b>${money(l.net, cur)}</b></td>
    </tr>`).join('');
  const taxRows = m.taxes.map((x) => `
    <tr><td>USt. ${x.rate !== null ? dec(x.rate) + ' %' : ''} <span class="muted">auf ${money(x.basis, cur)}${x.cat && x.cat !== 'S' ? ' · ' + esc(TAX_CATEGORIES[x.cat] || x.cat) : ''}</span>${x.reason ? `<div class="inv__desc">${esc(x.reason)}</div>` : ''}</td><td class="r num">${money(x.amount, cur)}</td></tr>`).join('');
  const allow = m.allowances.map((a) => `<tr><td>${a.charge ? 'Zuschlag' : 'Nachlass'}${a.reason ? ': ' + esc(a.reason) : ''}</td><td class="r num">${a.charge ? '' : '−'}${money(a.amount, cur)}</td></tr>`).join('');
  const leist = m.period && (m.period.start || m.period.end)
    ? `${fmtDate(m.period.start)} – ${fmtDate(m.period.end)}`
    : (m.deliveryDate ? fmtDate(m.deliveryDate) : '–');
  const p = m.payment;
  const t = m.totals;

  return `
  <article class="inv ${compact ? 'inv--compact' : ''}">
    <header class="inv__head">
      <div class="inv__from">${addrBlock(s)}
        ${s.contact && (s.contact.name || s.contact.email || s.contact.phone) ? `<p class="small">${[s.contact.name, s.contact.phone, s.contact.email].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
      </div>
      <div class="inv__badge">
        <span class="inv__fmt">${esc(prof.name)}</span>
        <span class="inv__syn">${esc(m.syntax || '')}</span>
      </div>
    </header>
    <div class="inv__addr">
      <div><span class="inv__k">Rechnung an</span>${addrBlock(b)}</div>
      <dl class="inv__meta">
        <div><dt>${esc(title)} Nr.</dt><dd class="num">${esc(m.number || '–')}</dd></div>
        <div><dt>Datum</dt><dd class="num">${fmtDate(m.issueDate)}</dd></div>
        <div><dt>Leistung</dt><dd class="num">${leist}</dd></div>
        ${p.dueDate ? `<div><dt>Fällig</dt><dd class="num">${fmtDate(p.dueDate)}</dd></div>` : ''}
        ${m.buyerReference ? `<div><dt>Käuferref.</dt><dd class="num">${esc(m.buyerReference)}</dd></div>` : ''}
        ${m.orderRef ? `<div><dt>Bestellung</dt><dd class="num">${esc(m.orderRef)}</dd></div>` : ''}
      </dl>
    </div>
    <h3 class="inv__title">${esc(title)} <span class="num">${esc(m.number || '')}</span></h3>
    ${m.notes.length ? `<div class="inv__notes">${m.notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
    <div class="inv__scroll">
    <table class="table inv__lines">
      <thead><tr><th>Pos.</th><th>Bezeichnung</th><th class="r">Menge</th><th class="r">Einzelpreis</th><th class="r">USt.</th><th class="r">Netto</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">Keine Positionen</td></tr>'}</tbody>
    </table>
    </div>
    <div class="inv__sum">
      <table class="table">
        <tr><td>Summe Positionen</td><td class="r num">${money(t.lines, cur)}</td></tr>
        ${allow}
        <tr><td>Nettobetrag</td><td class="r num">${money(t.taxBasis, cur)}</td></tr>
        ${taxRows}
        <tr class="inv__grand"><td>Gesamtbetrag</td><td class="r num">${money(t.grand, cur)}</td></tr>
        ${t.prepaid ? `<tr><td>Bereits gezahlt</td><td class="r num">−${money(t.prepaid, cur)}</td></tr>` : ''}
        ${t.due !== null && t.due !== t.grand ? `<tr class="inv__grand"><td>Zu zahlen</td><td class="r num">${money(t.due, cur)}</td></tr>` : ''}
      </table>
    </div>
    <footer class="inv__foot">
      <div><span class="inv__k">Zahlung</span>
        <p>${esc(MEANS_CODES[p.meansCode] || p.meansCode || '–')}${p.accountName ? ` an ${esc(p.accountName)}` : ''}</p>
        ${p.iban ? `<p class="num">IBAN ${esc(fmtIban(p.iban))}${p.bic ? ` · BIC ${esc(p.bic)}` : ''}</p>` : ''}
        ${p.reference ? `<p>Verwendungszweck: <span class="num">${esc(p.reference)}</span></p>` : ''}
        ${p.terms ? `<p class="small">${esc(p.terms)}</p>` : ''}
      </div>
      <div><span class="inv__k">Steuer</span>
        ${s.vatId ? `<p>USt-IdNr. <span class="num">${esc(s.vatId)}</span></p>` : ''}
        ${s.taxNo ? `<p>Steuernr. <span class="num">${esc(s.taxNo)}</span></p>` : ''}
        ${b.vatId ? `<p class="small">Käufer: <span class="num">${esc(b.vatId)}</span></p>` : ''}
        ${!s.vatId && !s.taxNo ? '<p>–</p>' : ''}
      </div>
    </footer>
  </article>`;
}

/* ————————————————— Erzeugen (CII) ————————————————— */
const x = (v) => esc(v);
const amt = (n) => round2(n).toFixed(2);
const d8 = (iso) => (iso || '').replaceAll('-', '');

export const GUIDELINES = {
  xrechnung: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
  en16931: 'urn:cen.eu:en16931:2017',
};

// Berechnet Summen aus Formularwerten → vollständiges Modell
export function buildModel(f) {
  const ku = !!f.kleinunternehmer;
  const lines = (f.lines || []).filter((l) => l.name || l.price).map((l, i) => {
    const qty = Number(l.qty) || 0, price = Number(l.price) || 0;
    const rate = ku ? 0 : Number(l.rate) || 0;
    return {
      id: String(i + 1), name: l.name || '', desc: l.desc || '', note: '', sku: '',
      qty, unit: l.unit || 'C62', price, priceBase: 1, net: round2(qty * price),
      taxCat: ku ? 'E' : (rate === 0 ? 'Z' : 'S'), taxRate: rate,
    };
  });
  const groups = new Map();
  for (const l of lines) {
    const k = `${l.taxCat}|${l.taxRate}`;
    groups.set(k, (groups.get(k) || 0) + l.net);
  }
  const taxes = [...groups].map(([k, basis]) => {
    const [cat, rate] = k.split('|');
    return {
      cat, rate: Number(rate), basis: round2(basis), amount: round2(basis * Number(rate) / 100),
      reason: cat === 'E' ? 'Kleinunternehmer gemäß § 19 UStG – es wird keine Umsatzsteuer berechnet.' : '', reasonCode: '',
    };
  });
  const lineSum = round2(lines.reduce((a, l) => a + l.net, 0));
  const tax = round2(taxes.reduce((a, t) => a + t.amount, 0));
  const grand = round2(lineSum + tax);
  const iban = (f.iban || '').replace(/\s/g, '').toUpperCase();
  return {
    format: 'CII', syntax: 'UN/CEFACT CII',
    profile: f.profile === 'en16931' ? GUIDELINES.en16931 : GUIDELINES.xrechnung,
    businessProcess: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    number: f.number || '', typeCode: '380', issueDate: f.issueDate || '',
    notes: [f.note, ku ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.' : ''].filter(Boolean),
    currency: 'EUR',
    buyerReference: f.buyerReference || f.number || '',
    orderRef: f.orderRef || '', contractRef: '',
    seller: {
      name: f.sName || '', street: f.sStreet || '', zip: f.sZip || '', city: f.sCity || '', country: f.sCountry || 'DE',
      vatId: f.sVatId || '', taxNo: f.sTaxNo || '', legalId: '', tradeName: '',
      endpoint: f.sEmail || '',
      contact: { name: f.sContact || f.sName || '', phone: f.sPhone || '', email: f.sEmail || '' },
    },
    buyer: {
      name: f.bName || '', street: f.bStreet || '', zip: f.bZip || '', city: f.bCity || '', country: f.bCountry || 'DE',
      vatId: f.bVatId || '', taxNo: '', legalId: '', tradeName: '', endpoint: f.bEmail || '', contact: null,
    },
    deliveryDate: f.periodMode === 'period' ? '' : (f.deliveryDate || ''),
    period: f.periodMode === 'period' ? { start: f.periodStart || '', end: f.periodEnd || '' } : null,
    payment: {
      meansCode: iban ? '58' : '1', info: '', iban, accountName: f.accountName || f.sName || '', bic: (f.bic || '').toUpperCase(),
      reference: f.number || '',
      terms: f.dueDays !== '' && f.dueDays !== undefined ? (Number(f.dueDays) === 0 ? 'Zahlbar sofort ohne Abzug.' : `Zahlbar innerhalb von ${Number(f.dueDays)} Tagen ohne Abzug.`) : '',
      dueDate: f.dueDate || '',
    },
    allowances: [], lines, taxes,
    totals: { lines: lineSum, charges: 0, allowances: 0, taxBasis: lineSum, tax, rounding: null, grand, prepaid: 0, due: grand },
  };
}

function ciiParty(tag, p, { contact = true } = {}) {
  const c = p.contact || {};
  return `
      <ram:${tag}>
        <ram:Name>${x(p.name)}</ram:Name>${contact && (c.name || c.phone || c.email) ? `
        <ram:DefinedTradeContact>${c.name ? `
          <ram:PersonName>${x(c.name)}</ram:PersonName>` : ''}${c.phone ? `
          <ram:TelephoneUniversalCommunication><ram:CompleteNumber>${x(c.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : ''}${c.email ? `
          <ram:EmailURIUniversalCommunication><ram:URIID>${x(c.email)}</ram:URIID></ram:EmailURIUniversalCommunication>` : ''}
        </ram:DefinedTradeContact>` : ''}
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${x(p.zip)}</ram:PostcodeCode>
          <ram:LineOne>${x(p.street)}</ram:LineOne>
          <ram:CityName>${x(p.city)}</ram:CityName>
          <ram:CountryID>${x(p.country || 'DE')}</ram:CountryID>
        </ram:PostalTradeAddress>${p.endpoint ? `
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(p.endpoint)}</ram:URIID></ram:URIUniversalCommunication>` : ''}${p.vatId ? `
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(p.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}${p.taxNo ? `
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${x(p.taxNo)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:${tag}>`;
}

export function toCII(m, guideline = m.profile) {
  const cur = m.currency || 'EUR';
  const lines = m.lines.map((l) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${x(l.id)}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${x(l.name)}</ram:Name>${l.desc ? `
        <ram:Description>${x(l.desc)}</ram:Description>` : ''}
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${l.price}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${x(l.unit)}">${l.qty}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${x(l.taxCat)}</ram:CategoryCode>
          <ram:RateApplicablePercent>${l.taxRate}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(l.net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join('');

  const taxes = m.taxes.map((t) => `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${amt(t.amount)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>${t.reason ? `
        <ram:ExemptionReason>${x(t.reason)}</ram:ExemptionReason>` : ''}
        <ram:BasisAmount>${amt(t.basis)}</ram:BasisAmount>
        <ram:CategoryCode>${x(t.cat)}</ram:CategoryCode>${t.reasonCode ? `
        <ram:ExemptionReasonCode>${x(t.reasonCode)}</ram:ExemptionReasonCode>` : ''}
        <ram:RateApplicablePercent>${t.rate}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`).join('');

  const p = m.payment, t = m.totals;
  const delivery = m.deliveryDate ? `
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${d8(m.deliveryDate)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>` : '';
  const period = m.period && m.period.start && m.period.end ? `
      <ram:BillingSpecifiedPeriod>
        <ram:StartDateTime><udt:DateTimeString format="102">${d8(m.period.start)}</udt:DateTimeString></ram:StartDateTime>
        <ram:EndDateTime><udt:DateTimeString format="102">${d8(m.period.end)}</udt:DateTimeString></ram:EndDateTime>
      </ram:BillingSpecifiedPeriod>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${x(m.businessProcess)}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${x(guideline)}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${x(m.number)}</ram:ID>
    <ram:TypeCode>${x(m.typeCode)}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${d8(m.issueDate)}</udt:DateTimeString></ram:IssueDateTime>${m.notes.map((n) => `
    <ram:IncludedNote><ram:Content>${x(n)}</ram:Content></ram:IncludedNote>`).join('')}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${x(m.buyerReference)}</ram:BuyerReference>${ciiParty('SellerTradeParty', m.seller)}${ciiParty('BuyerTradeParty', m.buyer, { contact: false })}${m.orderRef ? `
      <ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${x(m.orderRef)}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>` : ''}
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>${delivery}
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>${p.reference ? `
      <ram:PaymentReference>${x(p.reference)}</ram:PaymentReference>` : ''}
      <ram:InvoiceCurrencyCode>${x(cur)}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>${x(p.meansCode || '1')}</ram:TypeCode>${p.iban ? `
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${x(p.iban)}</ram:IBANID>${p.accountName ? `
          <ram:AccountName>${x(p.accountName)}</ram:AccountName>` : ''}
        </ram:PayeePartyCreditorFinancialAccount>` : ''}${p.bic ? `
        <ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${x(p.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>${taxes}${period}${p.terms || p.dueDate ? `
      <ram:SpecifiedTradePaymentTerms>${p.terms ? `
        <ram:Description>${x(p.terms)}</ram:Description>` : ''}${p.dueDate ? `
        <ram:DueDateDateTime><udt:DateTimeString format="102">${d8(p.dueDate)}</udt:DateTimeString></ram:DueDateDateTime>` : ''}
      </ram:SpecifiedTradePaymentTerms>` : ''}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amt(t.lines)}</ram:LineTotalAmount>
        <ram:ChargeTotalAmount>0.00</ram:ChargeTotalAmount>
        <ram:AllowanceTotalAmount>0.00</ram:AllowanceTotalAmount>
        <ram:TaxBasisTotalAmount>${amt(t.taxBasis)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${x(cur)}">${amt(t.tax)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amt(t.grand)}</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>0.00</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>${amt(t.due)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

/* ————————————————— Beispiel ————————————————— */
export const SAMPLE_FORM = {
  profile: 'xrechnung',
  sName: 'Studio Nordlicht GmbH', sStreet: 'Hafenstraße 12', sZip: '20457', sCity: 'Hamburg', sCountry: 'DE',
  sVatId: 'DE123456788', sTaxNo: '', sContact: 'Mira Albers', sPhone: '+49 40 1234567', sEmail: 'rechnung@nordlicht.example',
  bName: 'Bäckerei Kranz OHG', bStreet: 'Marktplatz 3', bZip: '24103', bCity: 'Kiel', bCountry: 'DE', bEmail: 'buchhaltung@kranz.example', bVatId: '',
  buyerReference: 'KRANZ-2026-17', orderRef: '',
  number: 'RE-2026-0142', issueDate: '2026-09-18', periodMode: 'date', deliveryDate: '2026-09-15', periodStart: '', periodEnd: '',
  dueDays: '14', dueDate: '2026-10-02',
  iban: 'DE02120300000000202051', bic: 'BYLADEM1001', accountName: 'Studio Nordlicht GmbH',
  note: 'Vielen Dank für den Auftrag.',
  kleinunternehmer: false,
  lines: [
    { name: 'Gestaltung Verpackungsserie', desc: 'Drei Motive inkl. Reinzeichnung', qty: 1, unit: 'LS', price: 2400, rate: 19 },
    { name: 'Fotoproduktion', desc: 'Studio, halber Tag', qty: 4, unit: 'HUR', price: 95, rate: 19 },
    { name: 'Fachbuch „Brot & Form“', desc: '', qty: 2, unit: 'C62', price: 34.58, rate: 7 },
  ],
};
