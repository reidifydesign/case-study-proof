// Loads an evidence file and checks that each entry is complete enough to stand behind a claim.
import fs from 'node:fs';
import { parseNumber } from './claims.js';

export const CAUSAL_DESIGNS = ['ab-test', 'a/b-test', 'controlled-experiment', 'holdout', 'randomised', 'randomized', 'rct', 'controlled-trial'];
const VAGUE_SOURCES = new Set(['internal', 'internal data', 'our data', 'client', 'client data', 'client report', 'company', 'company data', 'team', 'analytics', 'dashboard', 'report', 'n/a', 'na', 'tbd', 'unknown', 'trust me', 'various', 'data']);

export function loadEvidenceFile(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read evidence file ${file}: ${e.message}`);
  }
  const list = Array.isArray(data) ? data : data.evidence;
  if (!Array.isArray(list)) throw new Error(`${file}: expected an array, or an object with an "evidence" array`);
  return list;
}

export function isoDate(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== +m[2] - 1) return null;
  return d;
}

// Numbers an evidence entry can back up: its value, before/after, and what they imply.
export function candidates(e) {
  const c = [];
  const push = (n, label) => {
    if (Number.isFinite(n)) c.push({ n, label });
  };
  const v = parseNumber(e.value);
  const b = parseNumber(typeof e.before === 'object' && e.before ? e.before.value : e.before);
  const a = parseNumber(typeof e.after === 'object' && e.after ? e.after.value : e.after);
  push(v, 'value');
  push(b, 'before');
  push(a, 'after');
  let pct = NaN;
  let ratio = NaN;
  if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) {
    pct = ((a - b) / b) * 100;
    ratio = a / b;
    push(Math.abs(pct), 'change');
    push(Math.abs(a - b), 'difference');
  }
  return { list: c, pct, ratio, value: v, before: b, after: a };
}

export function validateEvidence(list, { today, docDate } = {}) {
  const problems = [];
  const seen = new Map();
  list.forEach((e, i) => {
    const where = e && e.id ? `evidence ${e.id}` : `evidence entry ${i + 1}`;
    const add = (severity, rule, message, fix) => problems.push({ severity, rule, where, id: e && e.id, message, fix });
    if (!e || typeof e !== 'object') return add('error', 'evidence-incomplete', 'entry is not an object');
    if (!e.id) add('error', 'evidence-incomplete', 'has no id', 'Give it an id such as E1 and cite it in the text as [E1].');
    else if (seen.has(e.id)) add('error', 'evidence-incomplete', `id ${e.id} is used twice`, 'Ids must be unique.');
    else seen.set(e.id, e);
    if (!e.metric) add('error', 'evidence-incomplete', 'does not name the metric', 'Add "metric", for example "organic sessions" or "enquiries".');
    if (!e.source) add('error', 'evidence-incomplete', 'has no source', 'Add "source": a URL, or a file path and export name.');
    else if (VAGUE_SOURCES.has(String(e.source).trim().toLowerCase())) add('warn', 'vague-source', `source "${e.source}" does not say where to look`, 'Name the tool, export or document, and where it is kept.');
    const obs = isoDate(e.observed_on);
    if (!e.observed_on) add('error', 'evidence-incomplete', 'has no observed_on date', 'Add the date you read the figure, as YYYY-MM-DD.');
    else if (!obs) add('error', 'evidence-incomplete', `observed_on "${e.observed_on}" is not a YYYY-MM-DD date`);
    else {
      if (today && obs > today) add('error', 'future-date', `observed_on ${e.observed_on} is in the future`, 'Use the date you actually read the figure.');
      else if (docDate && obs > docDate) add('warn', 'future-date', `observed_on ${e.observed_on} is after the case study date`, 'Update the case study date, or fix observed_on.');
    }
    const p = e.period;
    if (!p || !p.from || !p.to) add('warn', 'evidence-incomplete', 'has no period {from, to}', 'Say which dates the figure covers.');
    else if (!isoDate(p.from) || !isoDate(p.to)) add('error', 'evidence-incomplete', 'period dates must be YYYY-MM-DD');
    else if (isoDate(p.from) > isoDate(p.to)) add('error', 'evidence-incomplete', 'period starts after it ends');
    else if (today && isoDate(p.to) > today) add('error', 'future-date', `period ends ${p.to}, in the future`);
    const hasChange = e.before != null || e.after != null;
    if (hasChange && (e.before == null || e.after == null)) add('warn', 'evidence-incomplete', 'has only one of before and after', 'Give both, so the change can be checked.');
    if (e.value == null && !hasChange) add('warn', 'evidence-incomplete', 'has no value, or before and after', 'Add the number the text relies on.');
    for (const [k, v] of Object.entries(e)) {
      if (typeof v === 'string' && /\[\[CONFIRM|\bTODO\b|\bTBD\b/i.test(v)) add('error', 'placeholder-left', `field "${k}" still holds a placeholder`, 'Fill it in, or remove the claim that depends on it.');
    }
  });
  return problems;
}
