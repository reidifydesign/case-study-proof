// Sentence-level detectors: numeric claims, time windows, baselines, named metrics,
// causal wording and vague intensifiers. Everything here is a plain heuristic. It reads one
// sentence at a time and never guesses about the world.

const NUMWORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100
};
const NUMWORD_RE = Object.keys(NUMWORDS).join('|');
const SCALE = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, bn: 1e9, b: 1e9, billion: 1e9, lakh: 1e5, lakhs: 1e5, crore: 1e7, crores: 1e7 };

export const COUNT_NOUNS = [
  'users', 'visitors', 'sessions', 'leads', 'orders', 'customers', 'clients', 'enquiries', 'inquiries',
  'clicks', 'downloads', 'sign-ups', 'signups', 'subscribers', 'bookings', 'sales', 'conversions',
  'transactions', 'followers', 'views', 'pageviews', 'impressions', 'tickets', 'reviews', 'calls',
  'applications', 'registrations', 'purchases', 'citations', 'mentions', 'installs', 'students', 'learners',
  'attendees', 'participants', 'registrants', 'enrolments', 'enrollments'
];

// Words that name a measurable thing. Users can add their own in the config file.
export const METRIC_WORDS = [
  'conversion', 'conversions', 'conversion rate', 'traffic', 'sessions', 'visitors', 'visits', 'users',
  'revenue', 'sales', 'orders', 'leads', 'enquiries', 'inquiries', 'bounce rate', 'bounce', 'load time',
  'page speed', 'lcp', 'cls', 'inp', 'ttfb', 'fcp', 'lighthouse', 'score', 'rankings', 'ranking', 'clicks',
  'impressions', 'ctr', 'click-through', 'retention', 'churn', 'aov', 'average order value', 'cost per lead',
  'cpl', 'cac', 'roas', 'sign-ups', 'signups', 'subscribers', 'downloads', 'bookings', 'reviews', 'rating',
  'response time', 'tickets', 'errors', 'uptime', 'cost', 'costs', 'savings', 'time on page', 'pageviews',
  'page views', 'citations', 'mentions', 'followers', 'open rate', 'reply rate', 'completion rate',
  'drop-off', 'abandonment', 'cart abandonment', 'checkout', 'issues', 'bugs', 'hours', 'headcount',
  'margin', 'profit', 'budget', 'spend', 'engagement rate', 'session duration', 'page weight', 'applications',
  'registrations', 'purchases', 'calls', 'installs', 'throughput', 'latency', 'accessibility violations'
];

const OUTCOME_WORDS = ['growth', 'results', 'performance', 'success', 'demand', 'interest', 'uplift', 'pipeline', 'adoption'];

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const PLUS_DURATION = /^(?:years?|yrs?|months?|weeks?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)$/;
const PLUS_STOP = new Set(['of', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'the', 'a', 'an', 'from', 'with', 'who', 'that', 'which', 'is', 'are', 'were', 'was', 'by', 'per', 'each', 'as', 'so', 'but']);
const PAIR_NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const PAIR_RE = new RegExp(String.raw`\bfrom\s+${PAIR_NUM}(k|m)?(?![A-Za-z0-9])((?:\s+(?!(?:to|from)\b)[A-Za-z][A-Za-z'’-]*){0,6}?)\s+to\s+${PAIR_NUM}(k|m)?(?![A-Za-z0-9])`, 'i');
const UNIT_START = new RegExp(String.raw`^\s*(?:%|percent\b|per cent\b|pp\b|ms\b|s\b|secs?\b|seconds?\b|milliseconds?\b|kb\b|mb\b|gb\b|days?\b|weeks?\b|months?\b|years?\b|hours?\b|hrs?\b|minutes?\b|mins?\b|a\.?m\b|p\.?m\b|st\b|nd\b|rd\b|th\b)|^\s+${MONTH}\b`, 'i');
// "open from 9 to 5", "ranging from 3 to 5", "varies from 10 to 20": ranges, not before and after.
const PAIR_LEAD_BAD = /\b(?:open(?:s|ed|ing)?|ranging|ranges?|anywhere|vary|varies|varying)\s+(?:[A-Za-z]+\s+){0,4}$|\b(?:open(?:s|ed|ing)?|ranging|ranges?|anywhere|vary|varies|varying)\s*$/i;

const WINDOW_RES = [
  new RegExp(`\\b${MONTH}\\.?\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?(?:19|20)\\d{2}\\b`, 'i'),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?(?:\\s+(?:19|20)\\d{2})?\\b`, 'i'),
  new RegExp(`\\b(?:in|since|from|during|by|until|through|between|as of|of)\\s+${MONTH}\\b`, 'i'),
  /\b(?:19|20)\d{2}-\d{2}(?:-\d{2})?\b/,
  /\bQ[1-4]\s?(?:FY)?\s?(?:(?:19|20)?\d{2})?\b/,
  /\bH[12]\s+(?:19|20)\d{2}\b/i,
  /\b(?:19|20)\d{2}\b/,
  /\b(?:the\s+)?(?:last|past|previous|following|first|next)\s+(?:\d+\s+|a\s+|one\s+|two\s+|three\s+|four\s+|six\s+|twelve\s+)?(?:day|week|month|quarter|year)s?\b/i,
  /\b(?:within|over|after|in|for|across|during)\s+(?:the\s+)?(?:next\s+|first\s+|course of\s+)?(?:\d+|a|one|two|three|four|five|six|seven|eight|nine|ten|twelve)[\s-]+(?:day|week|month|quarter|year)s?\b/i,
  /\b\d+[\s-](?:day|week|month|quarter|year)s?\b/i,
  /\b(?:year[- ]on[- ]year|month[- ]on[- ]month|yoy|mom)\b/i
];

const BASELINE_RES = [
  /\bfrom\b[^.;]*\bto\b/i,
  /\bvs\.?\b/i,
  /\bversus\b/i,
  /\bcompared (?:with|to)\b/i,
  /\bbaseline\b/i,
  /\bbefore\b/i,
  /\bprevious(?:ly)?\b/i,
  /\bprior\b/i,
  /\bthe same period\b/i,
  /\byear[- ]on[- ]year|month[- ]on[- ]month|\byoy\b|\bmom\b/i,
  /\bthan (?:the |our |its )?(?:old|previous|prior|original|last|earlier)\b/i,
  /\bover (?:the )?(?:previous|prior|same|last)\b/i
];

const DIRECTION_UP = /\b(?:up|increase[ds]?|increasing|grew|grow|growth|rose|rise|gain(?:ed)?|climb(?:ed)?|lift(?:ed)?|boost(?:ed)?|higher|more|improv(?:e|ed|ement|es)|faster|better|doubled|tripled|quadrupled)\b/i;
const DIRECTION_DOWN = /\b(?:down|decrease[ds]?|decreasing|drop(?:ped)?|fell|fall|cut|reduc(?:e|ed|tion|es)|lower(?:ed)?|fewer|less|declin(?:e|ed)|shr[au]nk|halved|save[ds]?|saving|slower)\b/i;
const RELATIVE_WORDS = new RegExp(`${DIRECTION_UP.source}|${DIRECTION_DOWN.source}`, 'i');

export function parseNumber(str) {
  if (str == null) return NaN;
  if (typeof str === 'number') return str;
  const s = String(str).trim().toLowerCase();
  if (NUMWORDS[s] != null) return NUMWORDS[s];
  const n = Number(s.replace(/,/g, ''));
  return n;
}

export function decimalsOf(str) {
  const m = /[.](\d+)/.exec(String(str).replace(/,/g, ''));
  return m ? m[1].length : 0;
}

const YEAR = /^(?:19|20)\d{2}$/;
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];

// Capitalised words that can sit in front of a figure without being part of a name
// ("Over 300 orders", "Our 12 clients", "Sessions 40 ..."). Any other Capitalised word directly
// in front of a bare number is read as a proper name ("Studio 54", "Route 66").
const NAME_EXEMPT = new Set([
  ...MONTH_NAMES,
  ...[...METRIC_WORDS, ...OUTCOME_WORDS].flatMap((w) => w.toLowerCase().split(/[\s-]+/)),
  ...COUNT_NOUNS.map((w) => w.toLowerCase()),
  'about', 'above', 'across', 'after', 'all', 'almost', 'also', 'among', 'an', 'and', 'another', 'any', 'approx', 'approximately',
  'around', 'as', 'at', 'before', 'below', 'between', 'both', 'but', 'by', 'circa', 'combined', 'during', 'each', 'either', 'else',
  'every', 'extra', 'few', 'fewer', 'first', 'for', 'from', 'here', 'his', 'her', 'if', 'in', 'into', 'it', 'its', 'just', 'last',
  'less', 'many', 'more', 'most', 'my', 'nearly', 'neither', 'new', 'next', 'no', 'nor', 'of', 'on', 'only', 'or', 'other', 'our',
  'over', 'per', 'plus', 'rank', 'rating', 'roughly', 'several', 'since', 'so', 'some', 'still', 'than', 'that', 'the', 'their',
  'then', 'there', 'these', 'they', 'this', 'those', 'to', 'top', 'total', 'under', 'until', 'up', 'we', 'when', 'where', 'while',
  'with', 'within', 'without', 'your'
]);

function afterProperName(plain, index, digits) {
  const m = /(?:^|[\s("'“[])([a-z]?[A-Z][a-z][\w'’&.-]*)\s+$/.exec(plain.slice(0, index));
  if (!m) return false;
  const w = m[1].toLowerCase().replace(/[.'’]+$/, '');
  if (MONTH_NAMES.includes(w)) return Number(String(digits).replace(/,/g, '')) <= 31; // "March 12" is a date
  return !NAME_EXEMPT.has(w);
}

// "up to 30 seconds each", "at most 15 seconds", "9:16 vertical at 1080x1920": limits and formats.
const SPEC_LEAD = /\b(?:up to|at most|at least|no more than|no longer than|no shorter than|a maximum of|maximum of|maximum|max\.?|minimum of|minimum|min\.?|limited to|limit of|capped at|cap of)\s+(?:about\s+|around\s+|roughly\s+)?$/i;
const SPEC_TRAIL = /^\s*(?:each\b|long\b|or (?:less|shorter|fewer|more|longer)\b|max(?:imum)?\b|limit\b|per (?:clip|video|reel|scene|shot|take|generation|render|file|upload|post|story|asset)s?\b)/i;
const SPEC_CONTEXT = /\b(?:vertical|horizontal|square|portrait|landscape|aspect ratio|resolution|codec|fps|frame rate|file size|format(?:s|ted)?|spec(?:s|ification)?s?)\b|\b\d{1,2}:\d{1,2}\b|\b\d{3,5}\s?[x×]\s?\d{3,5}\b/i;
const MEASURED_WORDS = /\b(?:lcp|cls|inp|ttfb|fcp|load(?:ed|s|ing)?|page speed|speed|respon\w+|latency|render(?:ed|s)?|lighthouse|interactive|turnaround|saved?|saving|cut|reduc\w+|faster|slower|improv\w+|dropped|fell|weight|bundle|payload)\b/i;

function isSpecMeasure(plain, m) {
  if (MEASURED_WORDS.test(plain)) return false;
  const before = plain.slice(0, m.index);
  const after = plain.slice(m.index + m[0].length);
  return SPEC_LEAD.test(before) || SPEC_TRAIL.test(after) || SPEC_CONTEXT.test(plain);
}

// "100% owned by the client", "100% client-owned", "100% yours": a yes or no, not a measurement.
const STATUS_TAIL = /^\s*(?:of\s+(?:the\s+|your\s+|their\s+|our\s+)?(?:code|site|website|files|content|assets|ip|work|copy|design|repo|source)\s+)?(?:(?:is|are|was|stays?|remains?)\s+)?(?:\w+-)?(?:owned|ownership|yours|theirs|ours|free|custom|bespoke|handmade|hand-built|hand-coded|in-house|open-source|original|remote)\b/i;

// Is the clause in front of index negated ("no guaranteed results", "never promise rankings")?
export function negatedBefore(plain, index) {
  const clause = plain.slice(0, index).split(/[,;:.!?]|\b(?:but|only|just|instead)\b/i).pop();
  const words = clause.trim().split(/\s+/).slice(-6).join(' ');
  return /\b(?:no|not|never|without|nor|neither|cannot|zero|nothing)\b|n['’]t\b/i.test(words);
}

function overlaps(used, a, b) {
  return used.some(([x, y]) => a < y && b > x);
}

// Returns claims found in one plain-text sentence.
export function extractClaims(plain) {
  const claims = [];
  const used = [];
  const add = (m, claim) => {
    const a = m.index;
    const b = m.index + m[0].length;
    if (overlaps(used, a, b)) return;
    used.push([a, b]);
    claims.push({ raw: m[0].trim(), index: a, ...claim });
  };
  const all = (re, fn) => {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = r.exec(plain))) fn(m);
  };

  // currency first, so the number inside is not counted again
  all(/([$£€₹])\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|bn|b|million|billion|lakhs?|crores?|thousand)?(?![A-Za-z])/i, (m) => {
    const scale = m[3] ? SCALE[m[3].toLowerCase()] : 1;
    add(m, { kind: 'currency', value: parseNumber(m[2]) * scale, decimals: decimalsOf(m[2]), scaled: !!m[3] });
  });
  all(/\b(\d[\d,]*(?:\.\d+)?)\s?(k|m|million|billion|lakhs?|crores?)?\s?(USD|EUR|GBP|INR|AUD|CAD|AED)\b/i, (m) => {
    const scale = m[2] ? SCALE[m[2].toLowerCase()] : 1;
    add(m, { kind: 'currency', value: parseNumber(m[1]) * scale, decimals: decimalsOf(m[1]), scaled: !!m[2] });
  });
  all(/\bRs\.?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|lakhs?|crores?)?/i, (m) => {
    const scale = m[2] ? SCALE[m[2].toLowerCase()] : 1;
    add(m, { kind: 'currency', value: parseNumber(m[1]) * scale, decimals: decimalsOf(m[1]), scaled: !!m[2] });
  });

  // percent, including ranges like 30-40%
  const pct = new RegExp(String.raw`(?:(?<![\d.,])(\d{1,3}(?:\.\d+)?)\s?(?:-|\u2013|to)\s?)?(\d+(?:[.,]\d+)*|${NUMWORD_RE})\s?(?:%|percent\b|per cent\b|percentage points?\b|pp\b)`, 'gi');
  let m;
  while ((m = pct.exec(plain))) {
    const num = (t) => (/^\d{1,3}(,\d{3})+$/.test(t) ? parseNumber(t) : parseNumber(t.replace(',', '.')));
    const hi = num(m[2]);
    let low = m[1] != null ? parseNumber(m[1]) : undefined;
    let at = m;
    if (low !== undefined && !(low < hi)) {
      // not a range ("in 2026 to 52%"): keep only the percentage itself
      const off = m[0].lastIndexOf(m[2]);
      at = { index: m.index + off, 0: m[0].slice(off) };
      low = undefined;
    }
    if (low === undefined && hi === 100 && STATUS_TAIL.test(plain.slice(at.index + at[0].length))) continue;
    add(at, { kind: 'percent', value: hi, decimals: decimalsOf(m[2]), low, lowDecimals: low !== undefined ? decimalsOf(m[1]) : 0 });
  }

  all(/\b(\d+(?:\.\d+)?)\s?(?:x|\u00d7)(?![A-Za-z0-9])/i, (m) => add(m, { kind: 'multiplier', value: parseNumber(m[1]), decimals: decimalsOf(m[1]) }));
  all(/\b(\d+)-fold\b/i, (m) => add(m, { kind: 'multiplier', value: parseNumber(m[1]), decimals: 0 }));
  all(/\b(\d+(?:\.\d+)?)\s+times\s+(?:as\s+|more\b|higher\b|faster\b|the\b)/i, (m) => add(m, { kind: 'multiplier', value: parseNumber(m[1]), decimals: decimalsOf(m[1]) }));

  all(/\b(doubled|tripled|quadrupled|quintupled|halved)\b/i, (m) => {
    const w = m[1].toLowerCase();
    add(m, { kind: 'change-word', word: w, ratio: { doubled: 2, tripled: 3, quadrupled: 4, quintupled: 5, halved: 0.5 }[w] });
  });
  all(/\b(?:in|by) (half)\b/i, (m) => add(m, { kind: 'change-word', word: 'half', ratio: 0.5 }));
  all(/\b(twice|two times|three times|four times|half)\s+as\s+(?:many|much|fast|slow|long)\b/i, (m) => {
    const w = m[1].toLowerCase();
    add(m, { kind: 'change-word', word: w, ratio: { twice: 2, 'two times': 2, 'three times': 3, 'four times': 4, half: 0.5 }[w] });
  });

  // "128+ students", "300+ orders". Durations ("5+ years"), years and names are left alone.
  all(/(?<![\w.,])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\+(?:[ \t]+([A-Za-z][A-Za-z-]*))?/, (m) => {
    const digits = m[1];
    const word = m[2] ? m[2].toLowerCase() : '';
    if (YEAR.test(digits) || PLUS_DURATION.test(word) || afterProperName(plain, m.index, digits)) return;
    const noun = word && !PLUS_STOP.has(word) ? word : '';
    add({ index: m.index, 0: noun ? m[0] : `${digits}+` }, { kind: 'count', plus: true, value: parseNumber(digits), decimals: decimalsOf(digits), noun });
  });

  // "from 17 to 41", "from 18 the week before to 187": a before and after pair. The sentence is cut
  // at ", <noun phrase> from" first, so the second pair of a list is not read into the first.
  const cuts = [0];
  const cutRe = /(?:,\s*(?:and\s+)?|\s+and\s+)(?:[A-Za-z'’-]+\s+){0,4}?from\s/gi;
  let cm;
  while ((cm = cutRe.exec(plain))) cuts.push(cm.index);
  cuts.forEach((from, i) => {
    const seg = plain.slice(from, cuts[i + 1] ?? plain.length);
    const re = new RegExp(PAIR_RE.source, 'gi');
    let pm;
    while ((pm = re.exec(seg))) {
      const at = from + pm.index;
      const between = pm[3] || '';
      const lead = /^\s+(thousand|million|billion|lakhs?|crores?)\b/i.exec(between);
      const tail = plain.slice(at + pm[0].length);
      const tailScale = /^\s+(thousand|million|billion|lakhs?|crores?)\b/i.exec(tail);
      const rest = between.replace(lead ? lead[0] : '', '');
      if (YEAR.test(pm[1]) || YEAR.test(pm[4])) continue;
      if (PAIR_LEAD_BAD.test(plain.slice(0, at))) continue;
      if (/^[:/]/.test(tail) || UNIT_START.test(tail) || (rest && UNIT_START.test(rest))) continue;
      const fs = pm[2] ? SCALE[pm[2].toLowerCase()] : lead ? SCALE[lead[1].toLowerCase()] : 1;
      const ts = pm[5] ? SCALE[pm[5].toLowerCase()] : tailScale ? SCALE[tailScale[1].toLowerCase()] : 1;
      add(
        { index: at, 0: pm[0] + (tailScale ? tailScale[0] : '') },
        { kind: 'pair', from: parseNumber(pm[1]) * fs, to: parseNumber(pm[4]) * ts, fromDecimals: decimalsOf(pm[1]), toDecimals: decimalsOf(pm[4]), scaled: fs !== 1 || ts !== 1 }
      );
    }
  });

  const counts = COUNT_NOUNS.map((n) => n.replace('-', '[- ]?')).join('|');
  all(new RegExp(String.raw`\b(\d[\d,]*(?:\.\d+)?)\s?(k|m)?\s+(?:[A-Za-z-]+\s+){0,2}?(${counts})\b`, 'i'), (m) => {
    if (YEAR.test(m[1])) return; // a year, not a count
    if (afterProperName(plain, m.index, m[1])) return; // "Studio 54 sessions"
    const scale = m[2] ? SCALE[m[2].toLowerCase()] : 1;
    add(m, { kind: 'count', value: parseNumber(m[1]) * scale, decimals: decimalsOf(m[1]), scaled: !!m[2], noun: m[3].toLowerCase() });
  });

  all(/\b(\d+(?:\.\d+)?)\s?(ms|milliseconds?|seconds?|secs?|s|kb|mb|gb)\b(?!\w)/i, (m) => {
    if (YEAR.test(m[1]) || afterProperName(plain, m.index, m[1]) || isSpecMeasure(plain, m)) return;
    add(m, { kind: 'measure', value: parseNumber(m[1]), decimals: decimalsOf(m[1]), unit: m[2].toLowerCase() });
  });
  // 98/100, 105/105, 48/50. Not dates (12/09/2026), fractions (1/2), hours (24/7) or years (2025/26).
  all(/(?<![\w./-])(\d+(?:\.\d+)?)\s?\/\s?(\d+(?:\.\d+)?)(?![\w/]|\.\d)/, (m) => {
    const x = parseNumber(m[1]);
    const y = parseNumber(m[2]);
    if (YEAR.test(m[1]) || YEAR.test(m[2]) || !(x <= y) || y < 5) return;
    add(m, { kind: 'score', value: x, decimals: decimalsOf(m[1]), of: y });
  });
  all(/\b(?:score|rating)s?(?: of| at| to)?\s+(\d+(?:\.\d+)?)\b/i, (m) => {
    if (!YEAR.test(m[1])) add(m, { kind: 'score', value: parseNumber(m[1]), decimals: decimalsOf(m[1]) });
  });

  all(/\btop\s+(\d+)\b/i, (m) => {
    if (!YEAR.test(m[1])) add(m, { kind: 'rank', value: parseNumber(m[1]), decimals: 0 });
  });
  all(/\b(?:ranked|ranks|ranking|position)\s+(?:#|no\.?\s?)?(\d+)\b/i, (m) => {
    if (!YEAR.test(m[1])) add(m, { kind: 'rank', value: parseNumber(m[1]), decimals: 0 });
  });
  all(/#(\d+)\s+(?:ranking|result|position|spot)\b/i, (m) => add(m, { kind: 'rank', value: parseNumber(m[1]), decimals: 0 }));
  all(/\b(?:first page of (?:google|search|results)|page one of (?:google|search))\b/i, (m) => add(m, { kind: 'rank-implied' }));

  return claims.sort((a, b) => a.index - b.index);
}

export function hasWindow(plain) {
  return WINDOW_RES.some((re) => re.test(plain));
}

export function hasBaseline(plain) {
  return BASELINE_RES.some((re) => re.test(plain));
}

export function isRelative(plain, claim) {
  if (claim.kind === 'multiplier' || claim.kind === 'change-word') return true;
  if (claim.kind === 'percent') {
    // "fell to 38%" or "a rate of 3.2%" states a level, not a change
    const before = plain.slice(0, claim.index);
    if (/\b(?:to|at|of|was|is|were|reached|hit|stood at)\s*$/i.test(before)) return false;
    return RELATIVE_WORDS.test(plain);
  }
  return false;
}

export function direction(plain) {
  const up = DIRECTION_UP.test(plain);
  const down = DIRECTION_DOWN.test(plain);
  if (up && !down) return 1;
  if (down && !up) return -1;
  return 0;
}

function wordRe(list) {
  const parts = [...list].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+'));
  return new RegExp(`(?<![\\w-])(?:${parts.join('|')})(?![\\w-])`, 'i');
}

export function makeLexicon(extraMetrics = []) {
  const metrics = [...METRIC_WORDS, ...extraMetrics.map((s) => String(s).toLowerCase())];
  return { metricRe: wordRe(metrics), outcomeRe: wordRe([...metrics, ...OUTCOME_WORDS]), metrics };
}

export function namesMetric(plain, lex) {
  return lex.metricRe.test(plain);
}

// Causal wording. Only counts when the sentence is about an outcome, so "we chose a serif
// because the brand is editorial" is left alone.
const STRONG_CAUSAL = [
  /\b(?:led|leading|leads) to\b/i,
  /\bresult(?:ed|ing|s)? in\b/i,
  /\bas a result\b/i,
  /\b(?:the )?result of\b/i,
  /\bbecause of\b/i,
  /\bthanks to\b/i,
  /\bdue to\b/i,
  /\bowing to\b/i,
  /\bresponsible for\b/i,
  /\bhad an? (?:\w+ )?(?:impact|effect) on\b/i,
  /\bhelped (?:to )?(?:increase|grow|improve|reduce|cut|double|lift|boost|drive)\b/i,
  /\bcontribut(?:ed|es|ing) to\b/i
];

// Verbs that only claim a cause when something did them to an outcome: they need a subject in
// front and an outcome noun or figure after them, and are not adjectives ("AI-generated").
const CAUSAL_VERBS = [
  /(?<![-\w])caus(?:e|ed|es|ing)(?![-\w])/i,
  /(?<![-\w])dr(?:ove|ives|iving)(?![-\w])/i,
  /(?<![-\w])boost(?:ed|s|ing)(?![-\w])/i,
  /(?<![-\w])lift(?:ed|s|ing)(?![-\w])/i,
  /(?<![-\w])generat(?:ed|es|ing)(?![-\w])/i,
  /(?<![-\w])deliver(?:ed|s|ing)(?![-\w])/i,
  /(?<![-\w])unlock(?:ed|s|ing)(?![-\w])/i
];

function causalVerbHit(plain, lex) {
  for (const re of CAUSAL_VERBS) {
    const m = re.exec(plain);
    if (!m) continue;
    if (!/[A-Za-z]/.test(plain.slice(0, m.index))) continue; // no subject
    const after = plain.slice(m.index + m[0].length).split(/[,;:.!?]/)[0].split(/\s+/).slice(0, 9).join(' ');
    if (/\d/.test(after) || lex.outcomeRe.test(after)) return m[0];
  }
  return null;
}

export function causalMatches(plain, lex) {
  const hits = [];
  for (const re of STRONG_CAUSAL) {
    const m = re.exec(plain);
    if (m) hits.push(m[0]);
  }
  const verb = causalVerbHit(plain, lex);
  if (verb) hits.push(verb);
  const verbs = 'increased|improved|raised|grew|reduced|cut|lowered|doubled|tripled|increases|improves|raises|reduces|cuts|lowers|grows';
  const tv = new RegExp(`\\b(?:${verbs})\\s+(?:the\\s+|their\\s+|our\\s+|its\\s+|overall\\s+|average\\s+)*(?:[\\w-]+\\s+){0,2}?${lex.metricRe.source}`, 'i');
  const m = tv.exec(plain);
  if (m) hits.push(m[0]);
  if (!hits.length) return [];
  const aboutOutcome = lex.outcomeRe.test(plain) || extractClaims(plain).length > 0;
  return aboutOutcome ? hits : [];
}

export function hedged(plain) {
  return /\b(?:coincid\w+|correlat\w+|followed|we did not test|not a causal|cannot say|can't say|no causal|not proven)\b/i.test(plain);
}

const VAGUE = /(?<!statistically )\b(?:significant(?:ly)?|dramatic(?:ally)?|massive(?:ly)?|huge(?:ly)?|skyrocket\w*|explod\w*|record[- ]breaking|game[- ]chang\w+|best[- ]in[- ]class|world[- ]class|incredible|tremendous(?:ly)?|transformative|unprecedented|guaranteed (?:results|rankings?|growth|traffic|roi|sales|leads|success))\b/i;
export function vagueWords(plain) {
  const re = new RegExp(VAGUE.source, 'gi');
  let m;
  while ((m = re.exec(plain))) {
    if (!negatedBefore(plain, m.index)) return m[0];
  }
  return null;
}

export function placeholderIn(text) {
  const m = /\[\[CONFIRM[^\]]*\]\]|\bTODO\b|\bTBD\b|\bXX+%|\blorem ipsum\b|\b(?:N|X)\/A%/i.exec(text);
  return m ? m[0] : null;
}

// Outcome promises with no measure: "turns interest into enquiries", "built to convert",
// "makes booking effortless", "builds authority". These say what the work does to a result
// without a figure. Plain cause verbs such as "drives sales" are reported as causal wording.
const OUTCOME_NOUNS = 'enquiries|inquiries|leads|customers|clients|sales|orders|bookings|buyers|subscribers|sign-ups|signups|revenue|members|students|patients|appointments|conversions|users|applications|donations';
const OUTCOME_PHRASES = [
  new RegExp(String.raw`\b(?:turn|turns|turned|turning|convert|converts|converted|converting)\s+(?:[\w'-]+\s+){0,3}?(?:into|to)\s+(?:[\w'-]+\s+){0,2}?(?:${OUTCOME_NOUNS})\b`, 'i'),
  /\b(?:built|designed|engineered|crafted|made|optimi[sz]ed|structured|tuned)\s+(?:to|for)\s+(?:convert|conversions?|sell|selling|generate\s+(?:leads|sales|enquiries|inquiries)|drive\s+(?:sales|leads|enquiries|inquiries|conversions|growth|revenue))\b/i,
  /\bmak(?:e|es|ing)\s+(?:[\w'-]+\s+){1,4}?(?:effortless|frictionless|seamless)\b/i,
  /\b(?:build|builds|building|built|boosts?|earns?|creates?|establishes?|strengthens?)\s+(?:instant\s+|real\s+|lasting\s+|more\s+|brand\s+)?(?:authority|credibility|trust|awareness|loyalty|demand)(?![-\w])/i
];

function firstUnnegated(plain, res) {
  for (const re of res) {
    const r = new RegExp(re.source, 'gi');
    let m;
    while ((m = r.exec(plain))) {
      if (!negatedBefore(plain, m.index)) return m[0];
    }
  }
  return null;
}

export function outcomePhrase(plain) {
  return firstUnnegated(plain, OUTCOME_PHRASES);
}

// Wording that shares the credit: fine to write, worth checking that the evidence says the same.
const ATTRIBUTION = [
  /\bplayed (?:an? |the )?(?:\w+ )?(?:part|role) in\b/i,
  /\bone of (?:several|many|a few|multiple|the) (?:\w+ )?(?:factors|reasons|causes|drivers)\b/i,
  /\brather than (?:anything|something|what) (?:the|our|we|it|that)\b/i,
  /\b(?:a|one) (?:contributing )?factor in\b/i,
  /\bpartly (?:because|due to|thanks to|down to)\b/i,
  /\bpart of the reason\b/i
];

export function attributionWording(plain) {
  for (const re of ATTRIBUTION) {
    const m = re.exec(plain);
    if (m) return m[0];
  }
  return null;
}

// "verified clean", "zero offenses", "passed all checks", "fully tested": a clean bill of health.
const VERIFY = [
  /\bverified (?:clean|as clean|fully)\b/i,
  /\b(?:zero|0) (?:known )?(?:offen[cs]es|violations|vulnerabilities|defects|errors|bugs|issues|failures)\b/i,
  /\bpass(?:ed|es|ing)\s+(?:all|every|each)\s+(?:the\s+)?(?:\w+\s+)?(?:checks?|tests?|audits?|validations?|reviews?)\b/i,
  /\b(?:fully|thoroughly|completely|rigorously)\s+(?:tested|verified|audited|validated|checked|reviewed)\b/i,
  /\ball\s+(?:\d+\s+)?(?:checks|tests|audits)\s+(?:passed|passing|pass|green)\b/i,
  /\bclean bill of health\b/i
];

export function verificationClaim(plain) {
  return firstUnnegated(plain, VERIFY);
}

const TOOL_RE = /\b(?:axe(?:-core)?|lighthouse|pa11y|wave|eslint|stylelint|w3c|nu html checker|html validator|validator|playwright|cypress|selenium|jest|vitest|mocha|pytest|phpunit|snyk|semgrep|sonar(?:qube|cloud)?|dependabot|npm audit|trivy|owasp|zap|burp|screaming frog|pagespeed|webpagetest|gtmetrix|browserstack|lambdatest|wcag|section 508|tenon|siteimprove)\b/i;
const NAMED_BY = /\b(?:using|with|via|through|by|in|on|against|under)\s+(?:the\s+)?([A-Z][\w.+-]+)/g;
const NOT_A_TOOL = new Set([...MONTH_NAMES, 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

// Does the sentence name the tool or check that did the verifying?
export function toolNamed(plain) {
  if (TOOL_RE.test(plain)) return true;
  let m;
  NAMED_BY.lastIndex = 0;
  while ((m = NAMED_BY.exec(plain))) {
    if (!NOT_A_TOOL.has(m[1].toLowerCase().replace(/[.+-]+$/, ''))) return true;
  }
  return false;
}
