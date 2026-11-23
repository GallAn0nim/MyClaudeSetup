// Privatizer masking rules. Pure functions, no engine calls.
// Hidden: emails, phones (PL, EU, international, US, UK, India), money (incl. PLN and EU
// formats), IBAN and Polish account numbers (mod-97 checked), PESEL (checksum), payment
// cards (Luhn), and secrets (API keys, tokens, Bearer, password= values). Names are not hidden.
// Every hidden span becomes the same fixed bar, so its length gives nothing away.

export type Kind = 'email' | 'phone' | 'amount' | 'iban' | 'pesel' | 'card' | 'secret'
type Span = { a: number; b: number; kind: Kind }

/** Every hidden span is drawn as exactly this. */
export const BAR = '▒▒▒▒▒▒'

// ---- secrets (checked first, also inside links) ----

const SECRET_TOKEN_RE =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|pk_live_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g
// Bearer <token>: only the token is hidden.
const BEARER_RE = /\b((?:Bearer|Basic)\s+)([A-Za-z0-9._~+/=-]{12,})/g
// password=..., api_key: "...", token='...', SECRET=...: only the value is hidden.
// The key word must start the key or follow _ or -, so "bypass" or "passive" never count.
const KEYVAL_RE = /(?<![\p{L}\p{N}])((?:[A-Za-z0-9]+[_-])*(?:pass(?:word|wd)?|pwd|has(?:ło|lo)|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)(?:[_-][A-Za-z0-9]+)*["']?\s*[:=]\s*)(?:(["'])([^"'\n]{4,}?)\2|([^\s"';}]{4,}))/giu
// A value that is a reference, not a secret: $VAR, <placeholder>, ${...}, a plain number.
const NOT_A_SECRET_RE = /^(?:\$|<|\{|\/|~\/|\d+$)/

/** Keys in data whose string value is a secret. */
export const SECRET_KEY_RE = /pass(?:word|wd)?$|^pwd$|secret|token$|api[_-]?key|access[_-]?key|private[_-]?key/i

// ---- emails, links ----

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}(?![A-Za-z0-9-])(?!:[\w~/])/g
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi

// ---- account numbers ----

// IBAN: two letters, two check digits, 11 to 30 more, optionally in groups of four.
const IBAN_RE = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?(?![A-Za-z0-9])/g
// Polish account number (NRB) without "PL": 26 digits, often 2 + 6 x 4.
const NRB_RE = /(?<![\w./-])\d{2}(?:[ ]?\d{4}){6}(?![\w/-])/g
// Card: 13 to 19 digits starting 2-6 (card networks; ms timestamps start with 1), in groups of 4 or Amex 4-6-5.
const CARD_RE = /(?<![\w./-])(?:3\d{3}[ -]?\d{6}[ -]?\d{5}|[2-6]\d{3}(?:[ -]?\d{4}){2}[ -]?\d{1,7}|[2-6]\d{12,18})(?![\w/-])/g
// PESEL: 11 digits on their own.
const PESEL_RE = /(?<![\w./-])\d{11}(?![\w/-])/g

function mod97(s: string) {
  let r = 0
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    const part = code >= 65 && code <= 90 ? String(code - 55) : ch
    for (const d of part) r = (r * 10 + Number(d)) % 97
  }
  return r
}

export function isIban(raw: string) {
  const s = raw.replace(/\s/g, '')
  if (s.length < 15 || s.length > 34) return false
  return mod97(s.slice(4) + s.slice(0, 4)) === 1
}

/** A Polish NRB is a PL IBAN without its letters. */
export function isNrb(raw: string) {
  const s = raw.replace(/\s/g, '')
  return s.length === 26 && isIban(`PL${s}`)
}

export function isLuhn(raw: string) {
  const s = raw.replace(/[ -]/g, '')
  if (s.length < 13 || s.length > 19 || /^0+$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

export function isPesel(s: string) {
  if (!/^\d{11}$/.test(s)) return false
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
  let sum = 0
  for (let i = 0; i < 10; i++) sum += Number(s[i]) * (w[i] ?? 0)
  if ((10 - (sum % 10)) % 10 !== Number(s[10])) return false
  const month = Number(s.slice(2, 4)) % 20
  const day = Number(s.slice(4, 6))
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

// ---- money ----

// 4,500 / 4500 / 4,250.00 / 12.5, and EU: 1 500 / 1.500 / 1 500,50 / 12,99
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?:[   .]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?`
// A space between parts of an amount, never a line break: "$" on one line and "25" on the next are two things.
const SP = String.raw`[ \u00a0\u202f]`
const SCALE = String.raw`(?:${SP}?(?:k|K|m|M|mln|mld|bn|mn)\b|${SP}?tys\.?(?![\p{L}\d])|${SP}(?:thousand|million|billion|tysięcy|milion(?:y|ów)?)(?![\p{L}\d]))?`
const CODES = 'USD|GBP|EUR|PLN|CHF|CZK|SEK|NOK|DKK|HUF|RON|INR|AUD|CAD|JPY'
const WORDS = String.raw`zł|zl|złotych|złote|złoty|dollars?|euros?|bucks`
const MONEY_RES: RegExp[] = [
  // $1,234.56  £900  €12k  €1.234,56
  new RegExp(String.raw`(?<![\w$])\\?[$£€¥]${SP}?(?:${NUM})${SCALE}(?![\w%])`, 'gu'),
  // PLN 4 500  EUR 12,99  pln 100 (any case)
  new RegExp(String.raw`(?<![\w])(?:${CODES})${SP}?(?:${NUM})${SCALE}(?![\w%])`, 'giu'),
  // 1 500 zł  4 500,00 PLN  1000pln  12€  2$  2 $  300 USD  5 tys. zł
  new RegExp(String.raw`(?<![\w.,])(?:${NUM})${SCALE}${SP}?(?:${CODES}|[€$£¥]|${WORDS})(?![\p{L}\w])`, 'giu'),
]
const BARE_ARG_RE = /^\\?\$\d{1,2}$/

// ---- phones ----

const LEFT = String.raw`(?<![\w/\\.#@+$£€-])`
const RIGHT = String.raw`(?![\w/\\@%-]|\.\d|,\d)`
const PHONE_RES: RegExp[] = [
  // International, any country: +48 600 123 456, +49 30 1234567, +44 7700 900123
  new RegExp(String.raw`${LEFT}\+\d{1,3}(?:[  .-]?\(?\d{1,5}\)?){1,6}${RIGHT}`, 'g'),
  // 0048 600 123 456
  new RegExp(String.raw`${LEFT}00[1-9]\d?(?:[  .-]?\d{2,4}){2,5}${RIGHT}`, 'g'),
  // PL mobile with separators: 600 123 456, 600-123-456 (prefixes 45, 5x-8x), NBSP too
  new RegExp(String.raw`${LEFT}(?:45|[5-8]\d)\d(?:[  -]\d{3}){2}${RIGHT}`, 'g'),
  // PL mobile 3-2-2-2: 600 12 34 56
  new RegExp(String.raw`${LEFT}(?:45|[5-8]\d)\d(?:[  -]\d{2}){3}${RIGHT}`, 'g'),
  // PL mobile without separators, only after a phone word: tel. 600123456, phone=600123456
  new RegExp(String.raw`(?<=(?:tel|tel\.|telefon|tel\. kom\.|kom|kom\.|komórka|phone|mobile|mob|gsm|sms|nr|numer|numer tel\.|zadzwoń|dzwoń|call)[\s:=.]{0,3})(?:45|[5-8]\d)\d{7}${RIGHT}`, 'giu'),
  // PL landline: 22 123 45 67, (22) 123-45-67
  new RegExp(String.raw`${LEFT}\(?\d{2}\)?[  -]\d{3}[  -]\d{2}[  -]\d{2}${RIGHT}`, 'g'),
  // US: (415) 555-0132, 415-555-0132
  new RegExp(String.raw`${LEFT}(?:1[ .-])?(?:\(\d{3}\)\s?|\d{3}[ .-])\d{3}[ .-]\d{4}${RIGHT}`, 'g'),
  // UK: 07700 900123, 020 7946 0958
  new RegExp(String.raw`${LEFT}(?:\(0[1-9]\d{1,3}\)|0[1-9]\d{1,3})[ -]?\d{3,4}[ -]?\d{3,4}${RIGHT}`, 'g'),
]
// A date or a run of years is never a phone.
const DATE_RES: RegExp[] = [
  /^\(?(?:19|20)\d{2}[ .-](?:0?[1-9]|1[0-2])[ .-](?:0?[1-9]|[12]\d|3[01])\b/,
  /^\(?(?:0?[1-9]|[12]\d|3[01])[ .-](?:0?[1-9]|1[0-2])[ .-](?:19|20)\d{2}\b/,
  /^\(?(?:0?[1-9]|1[0-2])[ .-](?:0?[1-9]|[12]\d|3[01])[ .-](?:19|20)\d{2}\b/,
]
const YEARS_RE = /^(?:(?:19|20)\d{2}[ .-]?){2,}$/
const LAST_GROUP_RE = /[ .-]?\(?\d+\)?$/

const digits = (s: string) => s.replace(/\D/g, '').length

function isPhone(hit: string) {
  const n = digits(hit)
  if (n < 9 || n > 15) return false
  const bare = hit.replace(/^\+/, '')
  return !DATE_RES.some(r => r.test(bare)) && !YEARS_RE.test(bare)
}

function phoneLength(hit: string) {
  let h = hit
  while (h) {
    if (isPhone(h)) return h.length
    const cut = h.replace(LAST_GROUP_RE, '')
    if (cut === h || digits(cut) < 9) return 0
    h = cut
  }
  return 0
}

// ---- finding spans ----

function taken(used: Uint8Array, a: number, b: number) {
  for (let i = a; i < b; i++) if (used[i]) return true
  return false
}

/** Every private span in `text`, sorted, not overlapping. */
export function findSpans(text: string): Span[] {
  const spans: Span[] = []
  if (!text || typeof text !== 'string') return spans
  const used = new Uint8Array(text.length)
  const add = (a: number, b: number, kind: Kind) => {
    if (b <= a || taken(used, a, b)) return false
    spans.push({ a, b, kind })
    used.fill(1, a, b)
    return true
  }

  for (const m of text.matchAll(SECRET_TOKEN_RE)) add(m.index ?? 0, (m.index ?? 0) + m[0].length, 'secret')
  for (const m of text.matchAll(BEARER_RE)) {
    const a = (m.index ?? 0) + (m[1] ?? '').length
    add(a, a + (m[2] ?? '').length, 'secret')
  }
  for (const m of text.matchAll(KEYVAL_RE)) {
    const v = m[3] ?? m[4] ?? ''
    if (!v || NOT_A_SECRET_RE.test(v)) continue
    const a = (m.index ?? 0) + (m[1] ?? '').length + (m[2] ?? '').length
    add(a, a + v.length, 'secret')
  }
  if (text.includes('@')) for (const m of text.matchAll(EMAIL_RE)) add(m.index ?? 0, (m.index ?? 0) + m[0].length, 'email')
  if (!/\d/.test(text)) return sorted(spans)

  const inLink = new Uint8Array(text.length)
  for (const m of text.matchAll(URL_RE)) inLink.fill(1, m.index ?? 0, (m.index ?? 0) + m[0].length)
  const free = (a: number, b: number) => !taken(inLink, a, b)

  for (const m of text.matchAll(IBAN_RE)) {
    const a = m.index ?? 0
    // "PL61 … 2874 BIC": the last group may have swallowed the next word; drop groups until it checks.
    let hit = m[0]
    while (hit.replace(/\s/g, '').length >= 15 && !isIban(hit)) hit = hit.replace(/[ ]?[A-Z0-9]{1,4}$/, '')
    if (hit.replace(/\s/g, '').length >= 15 && isIban(hit) && free(a, a + hit.length)) add(a, a + hit.length, 'iban')
  }
  for (const m of text.matchAll(NRB_RE)) {
    const a = m.index ?? 0
    if (free(a, a + m[0].length) && isNrb(m[0])) add(a, a + m[0].length, 'iban')
  }
  for (const m of text.matchAll(CARD_RE)) {
    const a = m.index ?? 0
    if (free(a, a + m[0].length) && isLuhn(m[0])) add(a, a + m[0].length, 'card')
  }
  for (const m of text.matchAll(PESEL_RE)) {
    const a = m.index ?? 0
    if (free(a, a + 11) && isPesel(m[0])) add(a, a + 11, 'pesel')
  }
  for (const re of MONEY_RES) {
    for (const m of text.matchAll(re)) {
      const a = m.index ?? 0
      const b = a + m[0].length
      if (!BARE_ARG_RE.test(m[0]) && free(a, b)) add(a, b, 'amount')
    }
  }
  for (const re of PHONE_RES) {
    for (const m of text.matchAll(re)) {
      const a = m.index ?? 0
      const n = phoneLength(m[0])
      if (n > 0 && free(a, a + m[0].length)) add(a, a + n, 'phone')
    }
  }
  return sorted(spans)
}

function sorted(spans: Span[]) {
  return spans.sort((x, y) => x.a - y.a)
}

const QUICK_RE = /[@\d]|sk-|_live_|gh[pousr]_|github_pat_|glpat-|xox|AIza|AKIA|eyJ|bearer|pass|pwd|secret|token|key/i

/** Rewrites every private span of `text` with BAR. Returns the same string when nothing is private. */
export function mask(text: string): string {
  if (!text || typeof text !== 'string' || !QUICK_RE.test(text)) return text
  const long = text.length >= 200 && text.length <= 20_000
  if (long) {
    const hit = cache.get(text)
    if (hit !== undefined) return hit
  }
  const spans = findSpans(text)
  let out = text
  if (spans.length > 0) {
    out = ''
    let at = 0
    for (const s of spans) {
      out += text.slice(at, s.a) + BAR
      at = s.b
    }
    out += text.slice(at)
  }
  if (long) {
    if (cache.size >= CACHE_MAX) {
      const first = cache.keys().next().value
      if (first !== undefined) cache.delete(first)
    }
    cache.set(text, out)
  }
  return out
}

// Rows draw again on every scroll and redraw, so a long text is masked once and kept.
const cache = new Map<string, string>()
const CACHE_MAX = 400

/**
 * Masks every string inside plain data (a tool's input or result), keeping its shape and
 * keys. A string under a secret-looking key is hidden whole. Ids pass as they are.
 */
export function maskDeep<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return mask(value) as T
  if (value === null || typeof value !== 'object' || depth > 30) return value
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map(v => {
      const m = maskDeep(v, depth + 1)
      if (m !== v) changed = true
      return m
    })
    return (changed ? out : value) as T
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  let changed = false
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    let m: unknown
    if (k === 'tool_use_id' || k === 'id') m = v
    else if (typeof v === 'string' && v.length >= 4 && SECRET_KEY_RE.test(k) && !NOT_A_SECRET_RE.test(v)) m = BAR
    else m = maskDeep(v, depth + 1)
    if (m !== v) changed = true
    out[k] = m
  }
  return (changed ? out : value) as T
}
