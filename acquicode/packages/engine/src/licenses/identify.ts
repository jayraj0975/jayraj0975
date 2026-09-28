/**
 * License text identification by distinctive phrases. Deterministic and
 * conservative: every required phrase present gives KNOWN, a majority gives
 * LIKELY, and license-like text that matches nothing is flagged as custom.
 */

interface Fingerprint {
  id: string;
  all: string[];
  none?: string[];
}

const FINGERPRINTS: Fingerprint[] = [
  { id: 'AGPL-3.0', all: ['gnu affero general public license', 'version 3, 19 november 2007'] },
  { id: 'LGPL-3.0', all: ['gnu lesser general public license', 'version 3, 29 june 2007'] },
  { id: 'LGPL-2.1', all: ['gnu lesser general public license', 'version 2.1, february 1999'] },
  { id: 'GPL-3.0', all: ['gnu general public license', 'version 3, 29 june 2007'], none: ['gnu lesser general public license'] },
  { id: 'GPL-2.0', all: ['gnu general public license', 'version 2, june 1991'], none: ['gnu lesser general public license'] },
  { id: 'Apache-2.0', all: ['apache license', 'version 2.0, january 2004'] },
  { id: 'MPL-2.0', all: ['mozilla public license', 'version 2.0'] },
  { id: 'EPL-2.0', all: ['eclipse public license - v 2.0'] },
  { id: 'EPL-1.0', all: ['eclipse public license - v 1.0'] },
  { id: 'CDDL-1.0', all: ['common development and distribution license', 'version 1.0'] },
  { id: 'EUPL-1.2', all: ['european union public licence', 'v. 1.2'] },
  { id: 'SSPL-1.0', all: ['server side public license', 'version 1'] },
  { id: 'BUSL-1.1', all: ['business source license', '1.1'] },
  { id: 'Elastic-2.0', all: ['elastic license 2.0'] },
  { id: 'PolyForm-Noncommercial-1.0.0', all: ['polyform noncommercial license 1.0.0'] },
  { id: 'PolyForm-Small-Business-1.0.0', all: ['polyform small business license 1.0.0'] },
  { id: 'PolyForm-Shield-1.0.0', all: ['polyform shield license 1.0.0'] },
  { id: 'Commons-Clause', all: ['commons clause'] },
  { id: 'BSL-1.0', all: ['boost software license - version 1.0'] },
  { id: 'Unlicense', all: ['this is free and unencumbered software released into the public domain'] },
  { id: 'CC0-1.0', all: ['cc0 1.0 universal'] },
  { id: 'CC-BY-SA-4.0', all: ['attribution-sharealike 4.0 international'] },
  { id: 'CC-BY-SA-3.0', all: ['attribution-sharealike 3.0'] },
  { id: 'CC-BY-NC-4.0', all: ['attribution-noncommercial 4.0 international'] },
  { id: 'CC-BY-4.0', all: ['creative commons attribution 4.0 international'], none: ['sharealike', 'noncommercial', 'noderivatives'] },
  { id: 'OFL-1.1', all: ['sil open font license', 'version 1.1'] },
  { id: 'Artistic-2.0', all: ['the artistic license 2.0'] },
  { id: 'PSF-2.0', all: ['python software foundation license'] },
  { id: 'WTFPL', all: ['do what the fuck you want to public license'] },
  { id: 'JSON', all: ['the software shall be used for good, not evil'] },
  { id: 'Zlib', all: ["this software is provided 'as-is', without any express or implied warranty", 'altered source versions must be plainly marked'] },
  { id: 'UPL-1.0', all: ['universal permissive license'] },
  { id: 'BSD-4-Clause', all: ['redistribution and use in source and binary forms, with or without modification, are permitted', 'all advertising materials mentioning features'] },
  { id: 'BSD-3-Clause', all: ['redistribution and use in source and binary forms, with or without modification, are permitted', 'neither the name'], none: ['all advertising materials'] },
  { id: 'BSD-2-Clause', all: ['redistribution and use in source and binary forms, with or without modification, are permitted', 'redistributions in binary form must reproduce'], none: ['neither the name', 'all advertising materials'] },
  { id: 'ISC', all: ['permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted', 'provided that the above copyright notice and this permission notice appear in all copies'] },
  { id: '0BSD', all: ['permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted'], none: ['provided that the above copyright notice'] },
  { id: 'MIT', all: ['permission is hereby granted, free of charge, to any person obtaining a copy', 'the above copyright notice and this permission notice shall be included'] },
  { id: 'MIT-0', all: ['permission is hereby granted, free of charge, to any person obtaining a copy'], none: ['the above copyright notice and this permission notice shall be included'] },
];

/** Phrases that suggest a standard license was modified to add restrictions. */
const MODIFICATION_SIGNALS = [
  'non-commercial', 'noncommercial', 'may not be used for', 'shall not be used', 'not be used to', 'provided further that',
  'with the following additional', 'except that', 'additional restriction', 'you may not', 'competing product', 'commons clause',
];

const PROPRIETARY_SIGNALS = [
  'all rights reserved', 'proprietary and confidential', 'unauthorized copying of this file', 'strictly prohibited', 'confidential and proprietary',
];

export function normalizeLicenseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/^[\s#*/;-]+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TextIdentification {
  id: string | null;
  certainty: 'KNOWN' | 'LIKELY' | 'UNKNOWN';
  /** License-like text that matched nothing, or a match with added restrictions. */
  custom: boolean;
  proprietary: boolean;
  matched: string[];
}

export function identifyLicenseText(text: string): TextIdentification {
  const t = normalizeLicenseText(text.slice(0, 200_000));
  const candidates: Array<{ id: string; score: number; matched: string[] }> = [];
  for (const fp of FINGERPRINTS) {
    if (fp.none?.some((p) => t.includes(p))) continue;
    const matched = fp.all.filter((p) => t.includes(p));
    if (matched.length) candidates.push({ id: fp.id, score: matched.length / fp.all.length, matched });
  }
  candidates.sort((a, b) => b.score - a.score || b.matched.join('').length - a.matched.join('').length);
  const best = candidates[0];
  const modified = MODIFICATION_SIGNALS.some((p) => t.includes(p));
  const proprietary = PROPRIETARY_SIGNALS.some((p) => t.includes(p)) && !best;
  if (best && best.score === 1) {
    // Several full matches (e.g. a file concatenating licenses) is a compound license: report the first
    // but downgrade certainty so a person reads it.
    const multiple = candidates.filter((c) => c.score === 1).length > 1;
    return { id: best.id, certainty: modified || multiple ? 'LIKELY' : 'KNOWN', custom: modified, proprietary: false, matched: best.matched };
  }
  if (best && best.score >= 0.5) return { id: best.id, certainty: 'LIKELY', custom: true, proprietary: false, matched: best.matched };
  const licenseLike = /\b(licen[cs]e|permission|copyright|warranty|redistribut)/.test(t);
  return { id: null, certainty: 'UNKNOWN', custom: licenseLike && !proprietary, proprietary, matched: [] };
}

export function isLicenseFileName(name: string): boolean {
  return /^(licen[cs]e|copying|unlicense|copyright|notice)([-._][a-z0-9.-]*)?(\.(md|txt|rst|html))?$/i.test(name);
}

const COPYRIGHT = /copyright\s*(?:\(c\)|©|&copy;)?\s*((?:19|20)\d{2}(?:\s*[-,–]\s*(?:(?:19|20)\d{2}|present))*)?\s*,?\s*(?:by\s+)?([^\n\r*]{2,120})/gi;

export interface CopyrightNotice {
  holder: string;
  years: string | null;
  line: number;
}

/** Copyright notices in the first part of a file (headers), with the stated holder. */
export function copyrightNotices(text: string, maxLines = 60): CopyrightNotice[] {
  const lines = text.split('\n').slice(0, maxLines);
  const out: CopyrightNotice[] = [];
  lines.forEach((line, idx) => {
    COPYRIGHT.lastIndex = 0;
    const m = COPYRIGHT.exec(line);
    if (!m) return;
    const holder = m[2]!
      .replace(/all rights reserved\.?/i, '')
      .replace(/\s*(\*\/|-->|"""|''').*$/, '')
      .replace(/[.,;:\s]+$/, '')
      .trim();
    if (!holder || /^(notice|holder|holders|owner|the above|and license|law|\{|\$|<|year|\[yyyy\]|yyyy)/i.test(holder)) return;
    if (/permission notice|this notice|the copyright/i.test(holder)) return;
    out.push({ holder, years: m[1] ?? null, line: idx + 1 });
  });
  return out;
}
