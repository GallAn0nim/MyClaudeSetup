import type { EngineInterface, Register } from 'claude-code'

import type { Totals } from '../types'

// Downsize Browser Screenshot: while Claude drives a browser it takes a screenshot after almost
// every click, each about width x height / 750 tokens. This mod shrinks each screenshot with
// macOS `sips` before Claude reads it. Only browser tools by default; other tools' images
// (Read on a picture, other MCPs) only after `/downsize all on`. Any failure: the original stands.

const NAME = 'downsize-browser-screenshot'
const LABEL = 'Downsize'
const TOTALS = { plugin: 'downsize-browser-screenshot', key: 'totals' } as const
// The Mods pane's switch: this mod steps aside while its name is in the list.
const MODS_OFF = { plugin: 'mods-panel', key: 'disabled' } as const

async function switchedOff($: EngineInterface) {
  const { value } = await $.state.get(MODS_OFF)
  return Array.isArray(value) && value.includes('downsize-browser-screenshot')
}

type Scope = 'browser' | 'all'
type Settings = { scale: number; min: number; scope: Scope }

// Half of each side is about a quarter of the tokens. Never below 512 px on the long side.
const DEFAULTS: Settings = { scale: 0.5, min: 512, scope: 'browser' }
// The API scales a picture down to 1568 px on its long side before the model sees it.
const API_LONG = 1568
// Temp pictures older than this are leftovers of a killed run; removed at session start.
const STALE_MIN = 10

// Browser tools: the desktop app's built-in browser, Claude in Chrome, and browser MCPs.
const BROWSER_TOOL = /^mcp__.*(browser|chrome|playwright|puppeteer)/i

// Module variables reset on a reload; settings live in $.store, totals in $.state.
let home = ''
let settings: Settings = { ...DEFAULTS }
let fullPasses = 0
let seq = 0

const tmpDir = () => `${home}/.claude/mods-tmp/${NAME}`

export function imageTokens(w: number, h: number): number {
  const long = Math.max(w, h)
  const f = long > API_LONG ? API_LONG / long : 1
  return Math.ceil((Math.round(w * f) * Math.round(h * f)) / 750)
}

const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

// Adds to the totals with a version check, so parallel calls never overwrite each other.
async function addTotals($: EngineInterface, seen: number, shrunk: number, before: number, after: number) {
  for (let i = 0; i < 5; i++) {
    const read = await $.state.get(TOTALS)
    const v = read.value ?? { seen: 0, shrunk: 0, before: 0, after: 0 }
    const r = await $.state.set(TOTALS, { seen: v.seen + seen, shrunk: v.shrunk + shrunk, before: v.before + before, after: v.after + after }, { ifVersion: read.version })
    if (r.isSet) return
  }
}

async function getTotals($: EngineInterface): Promise<Totals> {
  const v = (await $.state.get(TOTALS).catch(() => ({ value: undefined }))).value
  return v ?? { seen: 0, shrunk: 0, before: 0, after: 0 }
}

export function isWatched(tool: string, scope: Scope): boolean {
  return scope === 'all' || BROWSER_TOOL.test(tool)
}

// ---- finding pictures in a result ----

type Obj = Record<string, unknown>
type Hit = { block: Obj; label?: Obj }

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function isImage(v: unknown): v is Obj {
  if (!isObj(v) || v.type !== 'image') return false
  // MCP block { data, mimeType }, API block { source: { data } }, Read's { file: { base64 } }.
  return typeof v.data === 'string' || (isObj(v.source) && typeof v.source.data === 'string') || (isObj(v.file) && typeof v.file.base64 === 'string')
}

const isText = (v: unknown): v is Obj => isObj(v) && v.type === 'text' && typeof v.text === 'string'

export function findImages(node: unknown, hits: Hit[] = []): Hit[] {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      if (isImage(item)) {
        const prev = node[i - 1]
        hits.push({ block: item, label: isText(prev) ? prev : undefined })
      } else findImages(item, hits)
    })
  } else if (isObj(node)) {
    if (isImage(node)) hits.push({ block: node })
    else for (const v of Object.values(node)) findImages(v, hits)
  }
  return hits
}

function bytesOf(b: Obj): { base64: string; mime: string } {
  if (typeof b.data === 'string') return { base64: b.data, mime: String(b.mimeType ?? '') }
  if (isObj(b.source)) return { base64: String(b.source.data), mime: String(b.source.media_type ?? '') }
  const file = b.file as Obj
  return { base64: String(file.base64), mime: String(file.type ?? '') }
}

function sniff(base64: string, mime: string): string {
  if (base64.startsWith('iVBOR')) return 'image/png'
  if (base64.startsWith('/9j/')) return 'image/jpeg'
  if (base64.startsWith('R0lGOD')) return 'image/gif'
  if (base64.startsWith('UklGR')) return 'image/webp'
  return mime || 'image/png'
}

function setBytes(b: Obj, base64: string, mime: string, w: number, h: number, nw: number, nh: number) {
  if (typeof b.data === 'string') {
    b.data = base64
    b.mimeType = mime
  } else if (isObj(b.source)) {
    b.source = { ...b.source, data: base64, media_type: mime }
  } else {
    const file = b.file as Obj
    const dims = isObj(file.dimensions) ? file.dimensions : {}
    // The original size stays the real one, so a point mapped from the picture lands right.
    b.file = {
      ...file,
      base64,
      type: mime,
      dimensions: { ...dims, originalWidth: dims.originalWidth ?? w, originalHeight: dims.originalHeight ?? h, displayWidth: nw, displayHeight: nh },
    }
  }
}

// The browser pane's own size line. Its coordinate frame must never change: clicks use it.
const SIZE = /Screenshot size: (\d+)x(\d+)(?: [\d.]+-scale view)?(?:; coordinate frame: (\d+)x(\d+))?/g

export function findTexts(node: unknown, out: Obj[] = []): Obj[] {
  if (Array.isArray(node)) for (const v of node) findTexts(v, out)
  else if (isText(node)) out.push(node)
  else if (isObj(node)) for (const v of Object.values(node)) findTexts(v, out)
  return out
}

// Rewrites the first line naming this picture's size into the tool's own scaled form.
export function relabel(texts: Obj[], w: number, h: number, nw: number, nh: number): boolean {
  for (const t of texts) {
    const text = String(t.text)
    for (const m of text.matchAll(SIZE)) {
      if (Number(m[1]) !== w || Number(m[2]) !== h || m.index === undefined) continue
      const fw = m[3] ? Number(m[3]) : w
      const fh = m[4] ? Number(m[4]) : h
      const scale = Number((nw / fw).toFixed(2))
      t.text = `${text.slice(0, m.index)}Screenshot size: ${nw}x${nh} ${scale}-scale view; coordinate frame: ${fw}x${fh}${text.slice(m.index + m[0].length)}`
      return true
    }
  }
  return false
}

// ---- pictures Claude sized itself ----

function sizedBy(a: Obj): string | null {
  if (a.action === 'zoom') return 'zoom'
  if (typeof a.scale === 'number') return 'own scale'
  return null
}

/** For each picture: why it stays as it is (a zoom, or a screenshot with Claude's own scale), or null to shrink it. */
export function ownSizes(input: Obj, labels: string[]): Array<string | null> {
  if (!Array.isArray(input.actions)) return labels.map(() => sizedBy(input))
  const shots = input.actions.map(a => (isObj(a) && isObj(a.input) ? a.input : {})).filter(a => a.action === 'screenshot' || a.action === 'zoom')
  if (shots.length === labels.length) return shots.map(sizedBy)
  return labels.map(l => (/:zoom\]/.test(l) ? 'zoom' : /[\d.]+-scale view/.test(l) ? 'own scale' : null))
}

// ---- shrinking (macOS sips) ----

// Decodes stdin, reads the size, shrinks to scale (never under min), prints the new size and
// bytes. The trap removes both temp files however the script ends.
const SHRINK = `set -e
in="$1"; out="$2"; scale="$3"; min="$4"; fmt="$5"
trap 'rm -f "$in" "$out"' EXIT
mkdir -p "$(dirname "$in")"
base64 -D > "$in"
dims() { sips -g pixelWidth -g pixelHeight "$1" | awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print w, h}'; }
set -- $(dims "$in")
w=$1; h=$2; long=$w
if [ "$h" -gt "$w" ]; then long=$h; fi
target=$(awk -v l="$long" -v s="$scale" -v m="$min" 'BEGIN{t=int(l*s+0.5); if (t<m) t=m; print t}')
echo "IN $w $h"
if [ "$target" -ge "$long" ]; then echo SKIP; exit 0; fi
if [ -n "$fmt" ]; then sips -Z "$target" -s format "$fmt" "$in" --out "$out" >/dev/null
else sips -Z "$target" "$in" --out "$out" >/dev/null; fi
set -- $(dims "$out")
echo "OUT $1 $2"
base64 -i "$out"`

type Shrunk = { w: number; h: number; nw?: number; nh?: number; base64?: string; mime: string }

async function shrink($: EngineInterface, base64: string, mime: string): Promise<Shrunk> {
  seq += 1
  const kind = sniff(base64, mime)
  // sips writes PNG and JPEG back as they came; GIF and WebP become PNG.
  const ext = kind === 'image/jpeg' ? 'jpg' : 'png'
  const conv = kind === 'image/jpeg' || kind === 'image/png' ? '' : 'png'
  const stem = `${tmpDir()}/${Date.now()}-${seq}`
  const r = await $.process.run(['/bin/sh', '-c', SHRINK, 'sh', `${stem}-in.${kind.split('/')[1] ?? 'png'}`, `${stem}-out.${ext}`, String(settings.scale), String(settings.min), conv], {
    stdin: base64,
    timeoutMs: 20_000,
  })
  if (r.exitCode !== 0) throw new Error(`sips exit ${r.exitCode}`)
  // Output over the engine's 4 MiB cap is cut off: a cut picture must never replace the original.
  if ((r as { isStdoutTruncated?: boolean }).isStdoutTruncated) throw new Error('sips output truncated')
  const lines = r.stdout.split(/\r?\n/)
  const head = /^IN (\d+) (\d+)$/.exec(lines[0] ?? '')
  if (!head) throw new Error('no size from sips')
  const w = Number(head[1])
  const h = Number(head[2])
  if (lines[1] === 'SKIP') return { w, h, mime: kind }
  const out = /^OUT (\d+) (\d+)$/.exec(lines[1] ?? '')
  if (!out) throw new Error('no new size from sips')
  const data = lines.slice(2).join('').replace(/\s+/g, '')
  if (!data || data.length % 4 !== 0) throw new Error('sips output is not whole base64')
  return { w, h, nw: Number(out[1]), nh: Number(out[2]), base64: data, mime: conv ? 'image/png' : kind }
}

async function cleanTmp($: EngineInterface) {
  if (!home) return
  await $.process.run(['/usr/bin/find', tmpDir(), '-type', 'f', '-mmin', `+${STALE_MIN}`, '-delete'], { timeoutMs: 10_000 }).catch(() => undefined)
}

// ---- the hooks ----

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
    fullPasses = 0
    const stored = await $.store.get('settings').catch(() => undefined)
    if (isObj(stored)) {
      settings = {
        scale: typeof stored.scale === 'number' ? stored.scale : DEFAULTS.scale,
        min: typeof stored.min === 'number' ? stored.min : DEFAULTS.min,
        scope: stored.scope === 'all' ? 'all' : 'browser',
      }
    }
    await $.command.register({
      name: 'downsize',
      description: 'Downsize Browser Screenshot: status. full: next screenshot at full size. all on|off: also shrink other tools\' images. scale 0.5, min 512',
      argumentHint: '[full|all on|all off|scale <0.2-0.9>|min <px>]',
      immediate: true,
    })
    void cleanTmp($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (!home || r.deny !== undefined || r.isError || !isWatched(e.tool, settings.scope)) return r
    if (await switchedOff($)) return r
    const hits = findImages(r.result)
    if (hits.length === 0) return r

    const input = e as unknown as Obj
    const own = ownSizes(input, hits.map(h => (h.label ? String(h.label.text) : '')))
    // /downsize full: spent on this call only when one of its pictures would really be shrunk.
    const full = fullPasses > 0
    let fullUsed = false

    // A fresh copy without `ref`: returning core's own object would make it send its own messages.
    const result = JSON.parse(JSON.stringify(r.result)) as unknown
    const mine = findImages(result)
    const texts = findTexts(result)
    const notes: string[] = []
    const base = await getTotals($)
    const t = { ...base, seen: base.seen + mine.length }

    for (let i = 0; i < mine.length; i += 1) {
      const hit = mine[i]
      if (!hit || own[i]) continue
      const { base64, mime } = bytesOf(hit.block)
      let s: Shrunk
      try {
        s = await shrink($, base64, mime)
      } catch {
        continue // The original picture stays.
      }
      if (s.nw === undefined || s.nh === undefined || !s.base64) continue
      if (full) {
        fullUsed = true
        continue
      }
      setBytes(hit.block, s.base64, s.mime, s.w, s.h, s.nw, s.nh)
      const before = imageTokens(s.w, s.h)
      const after = imageTokens(s.nw, s.nh)
      const framed = relabel(texts, s.w, s.h, s.nw, s.nh)
      // Read keeps the file's real size in dimensions.originalWidth: map points to that.
      const dims = isObj(hit.block.file) && isObj((hit.block.file as Obj).dimensions) ? ((hit.block.file as Obj).dimensions as Obj) : null
      const realW = dims && typeof dims.originalWidth === 'number' ? dims.originalWidth : s.w
      const f = Number((realW / s.nw).toFixed(3))
      notes.push(
        framed
          ? `${LABEL} shrank this screenshot from ${s.w}x${s.h} to ${s.nw}x${s.nh}. Its coordinate frame is unchanged, as the screenshot line says.`
          : `${LABEL} shrank this picture from ${s.w}x${s.h} to ${s.nw}x${s.nh}. A point (x, y) on it is (x*${f}, y*${f}) on the original.`,
      )
      t.shrunk += 1
      t.before += before
      t.after += after
    }

    if (fullUsed) {
      fullPasses -= 1
      $.ui.toast(`${LABEL}: full-size screenshot let through`)
    }
    await addTotals($, t.seen - base.seen, t.shrunk - base.shrunk, t.before - base.before, t.after - base.after)
    if (notes.length === 0) return r
    notes.push('For small text, zoom or read the page as text. The user can type /downsize full to let one full-size screenshot through.')
    // Keep any context a hook beneath already added.
    const had = (r as { context?: readonly string[] }).context ?? []
    return { result: result as never, context: [...had, notes.join('\n')] }
    // If anything above throws, the catch below lets the tool's own result stand; next(e) replays it, nothing runs twice.
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'downsize' }, async ($, e) => {
    if (await switchedOff($)) return { text: 'Downsize is off. Turn it on in the Mods pane (/mods).' }
    const [word = '', value = ''] = (e.args ?? '').trim().toLowerCase().split(/\s+/)
    const save = () => $.store.set('settings', settings)
    if (word === 'full') {
      fullPasses = 1
      return { text: `${LABEL}: the next screenshot comes through at full size, then shrinking resumes.` }
    }
    if (word === 'all') {
      if (value !== 'on' && value !== 'off') return { text: 'Usage: /downsize all on|off' }
      settings = { ...settings, scope: value === 'on' ? 'all' : 'browser' }
      await save()
      return { text: value === 'on' ? `${LABEL}: shrinking images from every tool (Read, other MCPs) too.` : `${LABEL}: browser screenshots only.` }
    }
    if (word === 'scale' || word === 'min') {
      const n = Number(value)
      const ok = word === 'scale' ? n >= 0.2 && n <= 0.9 : Number.isInteger(n) && n >= 256 && n <= 1568
      if (!ok) return { text: word === 'scale' ? 'Give a scale from 0.2 to 0.9, e.g. /downsize scale 0.5' : 'Give a size from 256 to 1568 px, e.g. /downsize min 512' }
      settings = { ...settings, [word]: n }
      await save()
      return { text: `${LABEL}: ${word} is now ${n}.` }
    }
    if (word !== '') return { text: 'Usage: /downsize [full|all on|all off|scale <0.2-0.9>|min <px>]' }
    const t = await getTotals($)
    return {
      text: [
        `${LABEL}: ${settings.scope === 'all' ? 'all tools' : 'browser screenshots only'}, scale ${settings.scale}, never under ${settings.min} px.`,
        `This chat: ${t.seen} picture${t.seen === 1 ? '' : 's'} seen, ${t.shrunk} shrunk, ~${fmt(t.before)} → ~${fmt(t.after)} tokens.`,
      ].join('\n'),
    }
  })
}
