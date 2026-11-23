// Pure helpers: prices, formatting, finding pictures in a tool result.

type Price = { input: number; output: number; read: number }

// US dollars per million tokens (Anthropic first-party rates, cached 2026-11-03).
// Cache writes (5 min) are 1.25x input. Matched by model id or display name.
const PRICES: [RegExp, Price][] = [
  [/fable.?5.?2|mythos.?5.?2/i, { input: 8, output: 40, read: 0.2 }],
  [/fable|mythos/i, { input: 10, output: 50, read: 1 }],
  [/opus.?5.?5/i, { input: 4, output: 20, read: 0.2 }],
  [/opus/i, { input: 5, output: 25, read: 0.5 }],
  [/sonnet.?5.?5/i, { input: 2, output: 10, read: 0.1 }],
  [/sonnet.?5/i, { input: 2, output: 10, read: 0.2 }],
  [/sonnet/i, { input: 3, output: 15, read: 0.3 }],
  [/haiku.?5.?5/i, { input: 0.1, output: 0.5, read: 0.01 }],
  [/haiku/i, { input: 1, output: 5, read: 0.1 }],
]
const DEFAULT_PRICE: Price = { input: 4, output: 20, read: 0.2 }

export const priceOf = (model: string): Price => PRICES.find(([re]) => re.test(model))?.[1] ?? DEFAULT_PRICE

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

export const usageTotal = (u: Usage) => u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

export function usageUsd(u: Usage, model: string): number {
  const p = priceOf(model)
  return (u.input_tokens * p.input + u.output_tokens * p.output + u.cache_read_input_tokens * p.read + u.cache_creation_input_tokens * p.input * 1.25) / 1e6
}

export function shortModel(model: string): string {
  const m = /(fable|mythos|opus|sonnet|haiku)[-\s]?(\d+)(?:[-.](\d+))?/i.exec(model)
  if (!m) return model
  const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()
  return m[3] && m[3].length < 3 ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`
}

export const tok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))

export const usd = (n: number) => (n >= 100 ? `$${n.toFixed(0)}` : n >= 0.995 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : n > 0 ? '<$0.01' : '$0')

export const cut = (t: string, n: number) => (n <= 0 ? '' : t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t)

/** "2h 05m", "3d 4h", "12m". */
export function span(ms: number): string {
  if (ms <= 0) return 'now'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** Local clock time of an ISO stamp: "18:40", or "Fri 09:00" when not today. */
export function at(iso: string, now: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const n = new Date(now)
  if (d.toDateString() === n.toDateString()) return hm
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${hm}`
}

/** A text bar: "████████░░░░" of width w. */
export function bar(frac: number, w: number): [string, string] {
  const f = Math.max(0, Math.min(1, frac))
  const full = Math.round(f * w)
  return ['█'.repeat(full), '░'.repeat(Math.max(0, w - full))]
}

// The API scales a picture down to 1568 px on its long side before the model sees it.
const API_LONG = 1568
export function imageTokens(w: number, h: number): number {
  const long = Math.max(w, h)
  const f = long > API_LONG ? API_LONG / long : 1
  return Math.ceil((Math.round(w * f) * Math.round(h * f)) / 750)
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Base64 of each picture in a tool result, in order. */
export function findImages(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const v of node) findImages(v, out)
  else if (isObj(node)) {
    if (node.type === 'image') {
      if (typeof node.data === 'string') out.push(node.data)
      else if (isObj(node.source) && typeof node.source.data === 'string') out.push(node.source.data)
      else if (isObj(node.file) && typeof node.file.base64 === 'string') out.push(node.file.base64)
      return out
    }
    for (const v of Object.values(node)) findImages(v, out)
  }
  return out
}

/** The downsize mod's notes: "shrank this screenshot from 2560x1600 to 1280x800". */
export function shrinkNotes(context: readonly string[] | undefined): { w: number; h: number; nw: number; nh: number }[] {
  const out: { w: number; h: number; nw: number; nh: number }[] = []
  for (const c of context ?? []) {
    for (const m of c.matchAll(/shrank this (?:screenshot|picture) from (\d+)x(\d+) to (\d+)x(\d+)/g)) {
      out.push({ w: Number(m[1]), h: Number(m[2]), nw: Number(m[3]), nh: Number(m[4]) })
    }
  }
  return out
}

/** A thumbnail tile as SVG with the JPEG inside, for surfaces that draw Svg. */
export function thumbSvg(b64: string, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="6" fill="#00000010"/><image href="data:image/jpeg;base64,${b64}" xlink:href="data:image/jpeg;base64,${b64}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/></svg>`
}

/** A rounded progress bar as SVG, with a tick at `mark` (0..1) when given. */
export function barSvg(frac: number, W: number, color: string, mark?: number, markColor = '#e0645c'): string {
  const H = 4
  const P = 3 // room above and below the bar for the mark
  const f = Math.max(0, Math.min(1, frac))
  const fill = f > 0 ? `<rect width="${Math.max(H, f * W).toFixed(1)}" height="${H}" rx="${H / 2}" fill="${color}"/>` : ''
  const tick = mark !== undefined && mark > 0 && mark < 1 ? `<rect x="${(mark * W - 1).toFixed(1)}" y="${-P}" width="2" height="${H + 2 * P}" rx="1" fill="${markColor}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 2 * P}" viewBox="0 ${-P} ${W} ${H + 2 * P}"><rect width="${W}" height="${H}" rx="${H / 2}" fill="#8a8a8a" opacity=".22"/>${fill}${tick}</svg>`
}
