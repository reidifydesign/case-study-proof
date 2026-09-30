// The checker: runs every rule over a parsed case study and its evidence file.
import { parseDocument, toPlain } from './parse.js';
import {
  extractClaims, hasWindow, hasBaseline, isRelative, makeLexicon, namesMetric,
  causalMatches, hedged, vagueWords, placeholderIn
} from './claims.js';
import { candidates, validateEvidence, isoDate, CAUSAL_DESIGNS } from './evidence.js';

export const RULES = {
  'unsourced-number': {
    severity: 'error',
    title: 'Number with no evidence reference',
    why: 'A reader cannot check a figure that points nowhere, and an invented figure looks the same as a measured one.',
    fix: 'Add an evidence reference such as [E1] after the sentence, and add that entry to the evidence file.'
  },
  'number-mismatch': {
    severity: 'error',
    title: 'Number does not match its evidence',
    why: 'The text and the evidence file disagree, so one of them is wrong or the figure was rounded up.',
    fix: 'Change the text to the evidenced figure (rounded honestly), or correct the evidence entry.'
  },
  'dangling-ref': {
    severity: 'error',
    title: 'Reference to evidence that does not exist',
    why: 'The claim points at an entry the evidence file does not have, so it is unsourced in practice.',
    fix: 'Add the entry to the evidence file, or fix the id.'
  },
  'causal-no-evidence': {
    severity: 'error',
    title: 'Causal wording with no evidence',
    why: 'Words like "led to", "drove" and "thanks to" say our work caused the result. Nothing cited here can show that.',
    fix: 'Say what was measured and when ("conversions were 4.1% in March, after launch"), or cite a controlled test as evidence.'
  },
  'causal-weak-evidence': {
    severity: 'warn',
    title: 'Causal wording backed only by observational evidence',
    why: 'The cited evidence records a figure before and after. It does not rule out other causes such as season, ads or pricing.',
    fix: 'Use neutral wording ("followed", "coincided with"), or set "design" to a controlled method in the evidence entry if one was really run.'
  },
  'missing-date': {
    severity: 'error',
    title: 'Figure with no date or period',
    why: 'A number without a measurement window cannot be compared or re-checked, and it ages silently.',
    fix: 'Say the month, quarter or number of days in the sentence, or add a period {from, to} to the evidence entry.'
  },
  'unnamed-metric': {
    severity: 'error',
    title: 'Figure that does not say what was measured',
    why: '"Up 40%" could be sessions, revenue or the number of pages. The reader cannot tell what improved.',
    fix: 'Name the metric in the sentence ("organic sessions rose 40%").'
  },
  'no-baseline': {
    severity: 'warn',
    title: 'Relative change with no baseline',
    why: '"Doubled" or "up 40%" means nothing without the starting point and its period.',
    fix: 'Give the before figure or period ("from 1,200 to 1,680 sessions a month"), or add before, after and baseline_period to the evidence.'
  },
  'direction-mismatch': {
    severity: 'warn',
    title: 'Direction of change disagrees with the evidence',
    why: 'The text says the figure went one way and the evidence before and after says the other.',
    fix: 'Check the before and after values, and the wording.'
  },
  'vague-claim': {
    severity: 'warn',
    title: 'Intensifier in place of a figure',
    why: 'Words like "significant" or "massive" sound like proof and contain none.',
    fix: 'Replace the word with the measured figure and its date, or cut the sentence.'
  },
  'placeholder-left': {
    severity: 'error',
    title: 'Placeholder still in the text',
    why: 'A [[CONFIRM: ...]], TODO or TBD means a fact was never filled in.',
    fix: 'Fill it in from a real source, or delete the sentence.'
  },
  'undated-document': {
    severity: 'warn',
    title: 'Case study has no date',
    why: 'Readers need to know how fresh the figures are.',
    fix: 'Add date: YYYY-MM-DD (and updated: when you change it) to the front matter.'
  },
  'evidence-incomplete': {
    severity: 'error',
    title: 'Evidence entry is missing a field',
    why: 'An evidence entry without a metric, source or date cannot back up a claim.',
    fix: 'Fill the field named in the message.'
  },
  'vague-source': {
    severity: 'warn',
    title: 'Source does not say where to look',
    why: '"Internal data" cannot be re-checked by anyone, including you in a year.',
    fix: 'Name the tool, export or document, and where it is kept.'
  },
  'future-date': {
    severity: 'error',
    title: 'Date is in the future',
    why: 'Evidence cannot have been read, or a period completed, after today.',
    fix: 'Use the real date.'
  },
  'unused-evidence': {
    severity: 'warn',
    title: 'Evidence entry that nothing cites',
    why: 'Either a claim lost its reference, or the entry is leftover.',
    fix: 'Cite it from the text, or remove it.'
  },
  'ignore-without-reason': {
    severity: 'error',
    title: 'proof-ignore comment with no reason',
    why: 'A silent suppression hides a finding from the next reader.',
    fix: 'Write the reason after the rule id: <!-- proof-ignore: rule-id -- why -->'
  },
  'no-evidence-file': {
    severity: 'warn',
    title: 'No evidence file found',
    why: 'Without one, every reference is unchecked and every number is unsourced.',
    fix: 'Run "case-study-proof init" for a template, or pass --evidence file.json.'
  }
};

const STRICT_UP = /\b(?:up|increase[ds]?|increasing|grew|grow|rose|rise|gain(?:ed)?|climb(?:ed)?|higher|more|doubled|tripled)\b/i;
const STRICT_DOWN = /\b(?:down|decrease[ds]?|decreasing|dropped|fell|fall|cut|reduc(?:e|ed|es)|lower(?:ed)?|fewer|less|declined|halved|shr[au]nk)\b/i;

function strictDirection(plain) {
  const s = plain.replace(/\b(?:more|less|fewer|higher|lower) than\b/gi, '');
  const up = STRICT_UP.test(s);
  const down = STRICT_DOWN.test(s);
  return up && !down ? 1 : down && !up ? -1 : 0;
}

const REF_GROUP = /\[([A-Za-z][\w-]*(?:\s*,\s*[A-Za-z][\w-]*)*)\](?!\()/g;

export function extractRefs(text, known) {
  const refs = [];
  const stripped = text.replace(REF_GROUP, (whole, inner) => {
    const ids = inner.split(',').map((s) => s.trim());
    if (!ids.every((id) => known.has(id) || /^E\d+$/i.test(id))) return whole;
    refs.push(...ids);
    return '';
  });
  return { refs, stripped };
}

function near(a, b, tol, relative) {
  return relative ? Math.abs(a - b) <= Math.abs(b) * tol + 1e-9 : Math.abs(a - b) <= tol + 1e-9;
}

const TIME = { ms: 1, millisecond: 1, milliseconds: 1, s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000 };

// Does the claim appear in the evidence entry? Returns the evidence numbers it tried, for the message.
export function matchClaim(claim, evs) {
  const tried = [];
  for (const e of evs) {
    const c = candidates(e);
    const fmt = (n) => String(Number(n.toFixed(2)));
    for (const x of c.list) tried.push(`${e.id} ${x.label} ${fmt(x.n)}`);
    let ok = false;
    const dec = (d) => 0.5 * Math.pow(10, -d);
    if (claim.kind === 'percent') {
      const pool = c.list.filter((x) => ['change', 'value', 'before', 'after'].includes(x.label));
      if (/point|pp/i.test(claim.raw)) pool.push(...c.list.filter((x) => x.label === 'difference'));
      const vals = [[claim.value, claim.decimals]];
      if (claim.low != null) vals.push([claim.low, claim.lowDecimals]);
      ok = vals.every(([v, d]) => pool.some((x) => near(v, x.n, dec(d), false)));
    } else if (claim.kind === 'multiplier') {
      const r = [c.ratio, 1 / c.ratio, c.value].filter(Number.isFinite);
      ok = r.some((x) => near(claim.value, x, 0.05, true));
    } else if (claim.kind === 'change-word') {
      const r = c.ratio;
      const windows = { 2: [1.95, 2.1], 3: [2.9, 3.15], 4: [3.85, 4.2], 5: [4.8, 5.2], 0.5: [0.45, 0.55] };
      const [lo, hi] = windows[claim.ratio];
      ok = Number.isFinite(r) && r >= lo && r <= hi;
      if (!ok && /as (?:many|much|fast|slow|long)/i.test(claim.raw) && Number.isFinite(r) && r > 0) {
        const inv = 1 / r;
        ok = inv >= lo && inv <= hi;
      }
    } else if (claim.kind === 'pair') {
      // "from A to B": A and B must be the evidence's before and after, in that order
      const hit = (v, x, d) => (claim.scaled ? near(v, x, 0.05, true) : near(v, x, dec(d), false));
      if (Number.isFinite(c.before) && Number.isFinite(c.after)) {
        ok = hit(claim.from, c.before, claim.fromDecimals) && hit(claim.to, c.after, claim.toDecimals);
      } else {
        const pool = c.list.filter((x) => ['value', 'before', 'after'].includes(x.label));
        ok = pool.some((x) => hit(claim.from, x.n, claim.fromDecimals)) && pool.some((x) => hit(claim.to, x.n, claim.toDecimals));
      }
    } else if (claim.kind === 'count' && claim.plus) {
      // "128+": the evidence must be at least N, and under twice N, so "100+" does not stand for 900
      const pool = c.list.filter((x) => ['value', 'before', 'after'].includes(x.label));
      ok = pool.some((x) => x.n >= claim.value - 1e-9 && x.n < claim.value * 2);
    } else if (['currency', 'count', 'measure', 'score', 'rank'].includes(claim.kind)) {
      let v = claim.value;
      if (claim.kind === 'measure' && TIME[claim.unit] && TIME[String(e.unit || '').toLowerCase()]) {
        v = (v * TIME[claim.unit]) / TIME[String(e.unit).toLowerCase()];
      }
      const pool = c.list.filter((x) => ['value', 'before', 'after', 'difference'].includes(x.label));
      ok = pool.some((x) => (claim.scaled ? near(v, x.n, 0.05, true) : near(v, x.n, dec(claim.decimals || 0), false)));
    } else {
      ok = true;
    }
    if (ok) return { ok: true, tried: [] };
  }
  return { ok: false, tried };
}

// Percent changes that can be worked out from the figures of the sentences just before.
function derivablePercents(prev) {
  const change = (a, b) => (a ? Math.abs(((b - a) / a) * 100) : NaN);
  const out = [];
  const nums = [];
  for (const h of prev) {
    for (const c of h.claims) {
      if (c.kind === 'pair') {
        out.push(change(c.from, c.to));
        nums.push(c.from, c.to);
      } else if (['count', 'currency', 'measure', 'score'].includes(c.kind) && Number.isFinite(c.value)) nums.push(c.value);
    }
  }
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) out.push(change(nums[i], nums[j]), change(nums[j], nums[i]));
  }
  return out.filter(Number.isFinite);
}

function derivedClaims(claims, prev) {
  if (!prev.length || !claims.some((c) => c.kind === 'percent')) return [];
  const pcts = derivablePercents(prev);
  return claims.filter((c) => c.kind === 'percent' && c.low == null && pcts.some((p) => Math.abs(p - c.value) <= 0.5 * Math.pow(10, -c.decimals) + 1e-9));
}

function excerpt(t) {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > 150 ? s.slice(0, 147) + '...' : s;
}

export function checkDocument(text, { evidence = null, evidenceFile = null, today = new Date(), config = {}, sentencesOnly = false } = {}) {
  const doc = parseDocument(text);
  const findings = [];
  const claimRows = [];
  const lex = makeLexicon(config.metrics || []);
  const causalDesigns = new Set([...CAUSAL_DESIGNS, ...(config.causalDesigns || [])].map((s) => s.toLowerCase()));
  const byId = new Map();
  const list = evidence || [];
  for (const e of list) if (e && e.id && !byId.has(e.id)) byId.set(e.id, e);
  const cited = new Set();
  const history = []; // figures in earlier sentences, for derived percentages

  const docDate = isoDate(doc.front.updated) || isoDate(doc.front.date) || null;
  const push = (rule, extra) => findings.push({ rule, severity: RULES[rule].severity, ...extra });

  if (!sentencesOnly) {
    if (!doc.front.date && !doc.front.updated) {
      push('undated-document', { file: 'text', line: 1, excerpt: '', message: RULES['undated-document'].title, fix: RULES['undated-document'].fix });
    } else if (!docDate) {
      push('undated-document', { file: 'text', line: 1, excerpt: '', message: `front matter date "${doc.front.date || doc.front.updated}" is not YYYY-MM-DD`, fix: RULES['undated-document'].fix });
    }
  }
  if (!evidence) {
    if (!sentencesOnly) push('no-evidence-file', { file: 'evidence', line: null, excerpt: '', message: RULES['no-evidence-file'].title, fix: RULES['no-evidence-file'].fix });
  } else {
    for (const p of validateEvidence(list, { today, docDate })) {
      findings.push({ rule: p.rule, severity: p.severity, file: 'evidence', line: null, excerpt: p.where, message: `${p.where}: ${p.message}`, fix: p.fix || RULES[p.rule].fix });
    }
  }

  for (const s of doc.sentences) {
    const base = { file: 'text', line: s.line, endLine: s.endLine, unitStart: s.unitStart, excerpt: excerpt(s.text) };
    const add = (rule, message, fix) => push(rule, { ...base, message, fix: fix || RULES[rule].fix });

    const ph = placeholderIn(s.text);
    if (ph) add('placeholder-left', `placeholder "${ph}" is still in the text`);

    const { refs, stripped } = extractRefs(s.text, byId);
    const inlineSource = /\]\(https?:\/\//i.test(s.text);
    const plain = toPlain(stripped);
    const found = extractClaims(plain);
    const evs = [];
    for (const id of new Set(refs)) {
      cited.add(id);
      if (byId.has(id)) evs.push(byId.get(id));
      else add('dangling-ref', evidence ? `[${id}] is not in the evidence file` : `[${id}] cannot be checked because no evidence file was found`);
    }
    const hasRef = evs.length > 0;

    // A percentage worked out from figures in the sentence or two just before it is derived, not new.
    const prev = history.slice(-2).filter((h) => h.unit === s.unitStart || h.sourced);
    const derived = !hasRef && !inlineSource ? derivedClaims(found, prev) : [];
    const claims = found.filter((c) => !derived.includes(c));
    for (const c of derived) claimRows.push({ line: s.line, claim: c.raw, kind: c.kind, refs: [], status: 'derived' });
    history.push({ unit: s.unitStart, sourced: hasRef || inlineSource, claims });

    if (claims.length) {
      const raws = claims.map((c) => c.raw).join(', ');
      if (!hasRef && !inlineSource) {
        add('unsourced-number', `${raws}: no evidence reference in this sentence`);
      }
      const verdicts = claims.map((c) => {
        if (hasRef) {
          const r = matchClaim(c, evs);
          return r.ok ? { c, status: 'verified' } : { c, status: 'mismatch', tried: r.tried };
        }
        return { c, status: inlineSource ? 'inline-source' : refs.length ? 'unknown-ref' : 'unsourced' };
      });
      for (const v of verdicts) claimRows.push({ line: s.line, claim: v.c.raw, kind: v.c.kind, refs: [...new Set(refs)], status: v.status });
      const bad = verdicts.filter((v) => v.status === 'mismatch');
      if (bad.length) {
        const said = bad.map((v) => v.c.raw).join(', ');
        add('number-mismatch', `the text says ${said}, which ${evs.map((e) => e.id).join(', ')} does not support (it holds: ${[...new Set(bad[0].tried)].join('; ')})`);
      }

      const evPeriod = evs.some((e) => e.period && e.period.from && e.period.to);
      if (!hasWindow(plain) && !evPeriod) {
        const seen = evs.some((e) => e.observed_on);
        add('missing-date', seen
          ? `${raws}: the evidence is dated, but the sentence does not say which period the figure covers`
          : `${raws}: no date or period in the sentence or its evidence`);
      }

      const rel = claims.filter((c) => isRelative(plain, c));
      if (rel.length && !hasBaseline(plain)) {
        const evBase = evs.some((e) => e.before != null && e.after != null && (e.baseline_period || (e.before && e.before.period)));
        if (!evBase) add('no-baseline', `${rel.map((c) => c.raw).join(', ')}: no starting figure or period is given`);
      }

      const needsName = claims.filter((c) => ['percent', 'multiplier', 'change-word', 'currency', 'pair'].includes(c.kind));
      if (needsName.length && !namesMetric(plain, lex)) {
        const evNamed = evs.some((e) => e.metric);
        push('unnamed-metric', {
          ...base,
          severity: evNamed ? 'warn' : 'error',
          message: `${needsName.map((c) => c.raw).join(', ')}: the sentence does not say what was measured` + (evNamed ? ` (the evidence names it: ${evs.filter((e) => e.metric).map((e) => e.metric).join(', ')})` : ''),
          fix: RULES['unnamed-metric'].fix
        });
      }

      const dir = strictDirection(plain);
      if (dir !== 0 && rel.length) {
        const pcts = evs.map((e) => candidates(e).pct).filter(Number.isFinite);
        if (pcts.length && pcts.every((p) => p !== 0 && Math.sign(p) !== dir)) {
          add('direction-mismatch', `the wording says ${dir > 0 ? 'up' : 'down'}, but ${evs.map((e) => e.id).join(', ')} shows ${pcts[0] > 0 ? 'an increase' : 'a decrease'} (${pcts[0].toFixed(1)}%)`);
        }
      }
    }

    const hits = hedged(plain) ? [] : causalMatches(plain, lex);
    if (hits.length) {
      const strong = evs.some((e) => causalDesigns.has(String(e.design || '').toLowerCase()));
      if (!strong) {
        if (hasRef) add('causal-weak-evidence', `"${hits[0]}" claims a cause, but ${evs.map((e) => `${e.id} is ${e.design || 'observational'}`).join(', ')}`);
        else add('causal-no-evidence', `"${hits[0]}" claims a cause, and no evidence is cited for it`);
      }
    }

    if (!claims.length) {
      const v = vagueWords(plain);
      if (v) add('vague-claim', `"${v}" has no figure behind it`);
    }
  }

  for (const id of byId.keys()) {
    if (!cited.has(id)) push('unused-evidence', { file: 'evidence', line: null, excerpt: `evidence ${id}`, message: `${id} is never cited in the text`, fix: RULES['unused-evidence'].fix });
  }

  // proof-ignore directives
  let suppressed = 0;
  const kept = [];
  for (const d of doc.directives) {
    if (!d.reason) {
      kept.push({ rule: 'ignore-without-reason', severity: 'error', file: 'text', line: d.line, excerpt: `proof-ignore: ${d.rules.join(', ')}`, message: 'this suppression has no reason', fix: RULES['ignore-without-reason'].fix });
    }
  }
  for (const f of findings) {
    const hit = f.file === 'text' && f.unitStart != null && doc.directives.some((d) => d.reason && d.rules.includes(f.rule) &&
      ((!d.standalone && d.line >= f.line && d.line <= f.endLine) || (d.standalone && d.target === f.unitStart)));
    if (hit) suppressed++;
    else kept.push(f);
  }
  const ignored = new Set(config.ignoreRules || []);
  const final = kept.filter((f) => !ignored.has(f.rule));
  const order = Object.keys(RULES);
  const sev = (f) => (f.severity === 'error' ? 0 : 1);
  final.sort((a, b) => (a.line ?? 1e9) - (b.line ?? 1e9) || sev(a) - sev(b) || order.indexOf(a.rule) - order.indexOf(b.rule));
  return {
    findings: final,
    suppressed,
    claims: claimRows,
    evidenceIds: [...byId.keys()],
    citedIds: [...cited],
    stats: {
      sentences: doc.sentences.length,
      claims: claimRows.length,
      verified: claimRows.filter((c) => c.status === 'verified').length,
      errors: final.filter((f) => f.severity === 'error').length,
      warnings: final.filter((f) => f.severity === 'warn').length
    }
  };
}
