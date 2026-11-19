// Pixel/ASCII scenes as self-animating SVG (SMIL), one per theme.
// Same eight themes as the claude.ai userscript, drawn as a grid of tiles
// that each carry one glyph. Seeded randomness keeps every redraw identical,
// so a re-render never restarts the animation with a new layout.

export type Layout = 'band' | 'side' | 'thumb'

export type Theme = {
  id: string
  name: string
  desc: string
  dark: boolean
  alias: string[]
  /** Border / accent color used to tint chat messages. */
  accent: string
  /** Soft fill behind the person's messages (8-digit hex, low alpha). */
  bubble: string
}

export const THEMES: Theme[] = [
  { id: 'vn', name: 'Việt Nam', desc: 'cờ đỏ sao vàng tung bay', dark: false, alias: ['co', 'co do', 'co viet nam', 'co do sao vang', 'viet nam', 'vietnam', 'quoc ky', 'to quoc', 'flag'], accent: '#da251d', bubble: '#da251d22' },
  { id: 'sakura', name: 'Sakura Breeze', desc: 'núi Phú Sĩ, cổng Torii, hoa anh đào', dark: false, alias: ['sakura', 'hoa', 'anhdao', 'cherry', 'japan', 'fuji', 'phu si', 'torii'], accent: '#f472b6', bubble: '#f472b622' },
  { id: 'galaxy', name: 'Cosmic Galaxy', desc: 'hố đen vô cực, tinh vân, bụi sao', dark: true, alias: ['galaxy', 'vu tru', 'vutru', 'ngan ha', 'nganha', 'blackhole', 'space', 'sao', 'nebula', 'cosmos'], accent: '#c084fc', bubble: '#c084fc22' },
  { id: 'hoian', name: 'Hội An', desc: 'đèn lồng, hoa đăng trên sông', dark: true, alias: ['hoi an', 'pho co', 'den long', 'den', 'hoa dang', 'lantern', 'lanterns'], accent: '#ef7d22', bubble: '#ef7d2222' },
  { id: 'noel', name: 'Giáng sinh', desc: 'làng tuyết, cây thông Noel, đèn lấp lánh', dark: true, alias: ['noel', 'giang sinh', 'christmas', 'xmas', 'cay thong', 'tuyet', 'snow', 'mua dong', 'winter'], accent: '#e0393e', bubble: '#e0393e22' },
]

export const byId = (id: string): Theme | undefined => THEMES.find(t => t.id === id)

const strip = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim()

/** A theme id from what the person typed: id, name or Vietnamese alias. */
export function findTheme(q: string): string | undefined {
  const s = strip(q)
  if (!s) return undefined
  if (/^(off|tat|none|0)$/.test(s)) return 'off'
  const exact = THEMES.find(t => t.id === s || strip(t.name) === s || t.alias.includes(s))
  if (exact) return exact.id
  return THEMES.find(t => t.id.startsWith(s) || strip(t.name).includes(s) || t.alias.some(a => a.startsWith(s)))?.id
}

/* ------------------------------------------------------------- utilities */

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const r1 = (n: number) => Math.round(n * 10) / 10
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type Pal = Record<string, [bg: string | null, fg: string | null, glyph?: string]>
type Tile = [col: number, row: number, bg: string | null, fg: string | null, glyph: string]

class Scene {
  readonly cols: number
  readonly rows: number
  readonly glyphs: boolean
  readonly rand: () => number
  private defs: string[] = []
  private body: string[] = []
  private ids = 0

  constructor(
    readonly W: number,
    readonly H: number,
    readonly cell: number,
    seed: number,
    readonly glyphSet: string,
  ) {
    this.cols = Math.ceil(W / cell)
    this.rows = Math.ceil(H / cell)
    this.glyphs = cell >= 9
    this.rand = rng(seed)
  }

  rnd(a: number, b: number) {
    return a + this.rand() * (b - a)
  }
  int(a: number, b: number) {
    return Math.floor(this.rnd(a, b + 1))
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rand() * list.length)] as T
  }
  glyph(i: number, j: number) {
    return this.glyphSet[Math.abs((i * 73856093) ^ (j * 19349663)) % this.glyphSet.length] ?? '.'
  }
  id(prefix: string) {
    return `${prefix}${this.ids++}`
  }

  def(markup: string) {
    this.defs.push(markup)
  }
  add(markup: string) {
    this.body.push(markup)
  }

  vgrad(stops: string[]) {
    const id = this.id('g')
    const s = stops.map((c, i) => `<stop offset="${r1(i / (stops.length - 1))}" stop-color="${c}"/>`).join('')
    this.def(`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${s}</linearGradient>`)
    this.add(`<rect width="${this.W}" height="${this.H}" fill="url(#${id})"/>`)
  }

  glow(x: number, y: number, r: number, color: string, alpha: number, extra = '') {
    const id = this.id('r')
    this.def(`<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${alpha}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`)
    return `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="url(#${id})">${extra}</circle>`
  }

  /** Tiles at cell coordinates, as one path per color plus one text run per row and color. */
  tiles(list: Tile[], ox = 0, oy = 0) {
    const c = this.cell
    const gap = c > 7 ? 1 : 0.5
    const s = r1(c - gap)
    const paths = new Map<string, string[]>()
    const texts = new Map<string, Map<number, [number[], string]>>()
    for (const [i, j, bg, fg, ch] of list) {
      const x = r1(ox + i * c + gap / 2)
      const y = r1(oy + j * c + gap / 2)
      if (bg) {
        if (!paths.has(bg)) paths.set(bg, [])
        paths.get(bg)!.push(`M${x} ${y}h${s}v${s}h-${s}z`)
      }
      if (fg && ch && (this.glyphs || !bg)) {
        if (!this.glyphs) {
          // Too small for letters: a dot stands in for a glyph without a tile.
          if (!paths.has(fg)) paths.set(fg, [])
          const d = r1(c * 0.4)
          paths.get(fg)!.push(`M${r1(x + (s - d) / 2)} ${r1(y + (s - d) / 2)}h${d}v${d}h-${d}z`)
          continue
        }
        if (!texts.has(fg)) texts.set(fg, new Map())
        const rowMap = texts.get(fg)!
        if (!rowMap.has(j)) rowMap.set(j, [[], ''])
        const row = rowMap.get(j)!
        row[0].push(r1(ox + i * c + c / 2))
        row[1] += ch
      }
    }
    let out = ''
    for (const [color, d] of paths) out += `<path fill="${color}" d="${d.join('')}"/>`
    for (const [color, rowMap] of texts) {
      for (const [j, [xs, chars]] of rowMap) {
        out += `<text fill="${color}" x="${xs.join(' ')}" y="${r1(oy + j * c + c * 0.72)}">${esc(chars)}</text>`
      }
    }
    return out
  }

  /** ASCII art -> tile list. */
  sprite(rows: string[], pal: Pal, flip = false): Tile[] {
    const w = Math.max(...rows.map(r => r.length))
    const out: Tile[] = []
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const p = pal[row[i] ?? ' ']
        if (!p) continue
        out.push([flip ? w - 1 - i : i, j, p[0], p[1], p[2] ?? this.glyph(i, j)])
      }
    })
    return out
  }

  /** A sprite stored once in <defs>, drawn with <use>. */
  defSprite(rows: string[], pal: Pal, flip = false) {
    const id = this.id('s')
    this.def(`<g id="${id}">${this.tiles(this.sprite(rows, pal, flip))}</g>`)
    return id
  }

  /** Moves `inner` from x0 to x1 (px) forever, starting part-way through. */
  drift(inner: string, x0: number, x1: number, y: number, seconds: number, phase: number, opacity = 1) {
    const op = opacity < 1 ? ` opacity="${r1(opacity)}"` : ''
    this.add(
      `<g${op}><animateTransform attributeName="transform" type="translate" from="${r1(x0)} ${r1(y)}" to="${r1(x1)} ${r1(y)}" dur="${r1(seconds)}s" begin="-${r1(phase * seconds)}s" repeatCount="indefinite"/>${inner}</g>`,
    )
  }

  render(alt: string) {
    const fs = r1(this.cell * 0.7)
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${this.W}" height="${this.H}" viewBox="0 0 ${this.W} ${this.H}" preserveAspectRatio="xMidYMid slice" role="img">` +
      `<title>${esc(alt)}</title>` +
      `<defs>${this.defs.join('')}</defs>` +
      `<g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="${fs}" font-weight="600" text-anchor="middle">` +
      this.body.join('') +
      `</g></svg>`
    )
  }
}

const use = (id: string, extra = '') => `<use href="#${id}" xlink:href="#${id}"${extra}/>`


const bob = (inner: string, dy: number, seconds: number) =>
  `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 ${dy};0 0" dur="${seconds}s" repeatCount="indefinite"/>${inner}</g>`

const twinkle = (seconds: number, phase: number, lo = 0.15) =>
  `<animate attributeName="opacity" values="${lo};1;${lo}" dur="${r1(seconds)}s" begin="-${r1(phase)}s" repeatCount="indefinite"/>`

/* ----------------------------------------------------------- shared art */

function cloudRows(sc: Scene, w: number, h: number) {
  const E = [{ x: w / 2, y: h - h * 0.32, rx: w / 2, ry: h * 0.34 }]
  for (let k = sc.int(2, 4); k > 0; k--) {
    const rx = sc.rnd(w * 0.16, w * 0.3)
    E.push({ x: sc.rnd(rx * 0.9, w - rx * 0.9), y: h - h * 0.4 - sc.rnd(0, h * 0.2), rx, ry: Math.min(rx * 0.8, h * 0.6) })
  }
  const inside = (i: number, j: number) => E.some(e => ((i + 0.5 - e.x) / e.rx) ** 2 + ((j + 0.5 - e.y) / e.ry) ** 2 <= 1)
  const rows: string[] = []
  for (let j = 0; j < h; j++) {
    let r = ''
    for (let i = 0; i < w; i++) {
      if (!inside(i, j)) r += ' '
      else r += !inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1) ? 'e' : 'c'
    }
    rows.push(r)
  }
  return rows
}

function clouds(sc: Scene, pal: Pal, count: number, maxY: number, speed: number, alpha: number) {
  const shapes = Array.from({ length: 4 }, () => {
    const w = sc.int(Math.min(8, sc.cols - 2), Math.max(9, Math.min(22, Math.round(sc.cols * 0.3))))
    const h = Math.max(3, Math.round(w * sc.rnd(0.3, 0.42)))
    return { id: sc.defSprite(cloudRows(sc, w, h), pal), w }
  })
  for (let k = 0; k < count; k++) {
    const s = sc.pick(shapes)
    const z = sc.rand()
    const span = sc.W + s.w * sc.cell * 2
    sc.drift(use(s.id), -s.w * sc.cell, sc.W + s.w * sc.cell, sc.rnd(-sc.cell, maxY), span / ((8 + z * 26) * speed), sc.rand(), alpha * (0.55 + z * 0.45))
  }
}

/* ---------------------------------------------------------------- themes */

// Vietnam's flag: 2:3, red field, a yellow five-pointed star whose
// centre-to-tip radius is 1/5 of the flag's length, one point up.
const FLAG_RED = '#da251d'
const FLAG_RED_GLYPH = '#b51f18'
const FLAG_YELLOW = '#ffea00'
const FLAG_YELLOW_GLYPH = '#cfb800'

function inStar(x: number, y: number, cx: number, cy: number, R: number) {
  const r = R * 0.381966
  let inside = false
  for (let k = 0, j = 9; k < 10; j = k++) {
    const ak = -Math.PI / 2 + (k * Math.PI) / 5
    const aj = -Math.PI / 2 + (j * Math.PI) / 5
    const rk = k % 2 ? r : R
    const rj = j % 2 ? r : R
    const xk = cx + Math.cos(ak) * rk
    const yk = cy + Math.sin(ak) * rk
    const xj = cx + Math.cos(aj) * rj
    const yj = cy + Math.sin(aj) * rj
    if (yk > y !== yj > y && x < ((xj - xk) * (y - yk)) / (yj - yk) + xk) inside = !inside
  }
  return inside
}

function karstRow(cols: number, peaks: { x: number; w: number; h: number; lean: number }[]) {
  const hs = new Array<number>(cols).fill(0)
  for (const p of peaks) {
    for (let x = Math.floor(p.x - p.w * 1.3); x <= Math.ceil(p.x + p.w * 1.3); x++) {
      if (x < 0 || x >= cols) continue
      const dx = x + 0.5 - p.x
      const d = Math.abs(dx) / (p.w * (dx < 0 ? 1 + p.lean : 1 - p.lean))
      if (d >= 1) continue
      hs[x] = Math.max(hs[x] ?? 0, Math.round(p.h * Math.pow(1 - Math.pow(d, 2.6), 0.55)))
    }
  }
  return hs
}

function vn(sc: Scene) {
  const c = sc.cell
  const horizon = Math.round(sc.rows * 0.8)
  const top = Math.max(1, Math.round(sc.rows * 0.12))
  const narrow = sc.cols < 60
  const L = Math.round(Math.max(8, Math.min(48, Math.min(sc.cols * (narrow ? 0.55 : 0.34), (horizon - top - 2) * 1.5))))
  const H = Math.round((L * 2) / 3)
  const px = Math.round(Math.max(2, Math.min(narrow ? sc.cols - L - 3 : sc.cols * 0.62, sc.cols - L - 2)))

  // Sky and sea.
  const sky = sc.id('g')
  sc.def(`<linearGradient id="${sky}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f9fe0"/><stop offset=".55" stop-color="#9fd2f2"/><stop offset="1" stop-color="#ffe0b0"/></linearGradient>`)
  sc.add(`<rect width="${sc.W}" height="${horizon * c}" fill="url(#${sky})"/>`)
  const sea = sc.id('g')
  sc.def(`<linearGradient id="${sea}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fb7cc"/><stop offset="1" stop-color="#2c7896"/></linearGradient>`)
  sc.add(`<rect y="${horizon * c}" width="${sc.W}" height="${sc.H - horizon * c}" fill="url(#${sea})"/>`)
  sc.add(sc.glow(sc.W * 0.82, horizon * c, Math.max(sc.W, sc.H) * 0.45, '#ffd27a', 0.55))

  // Rising sun, then hazy far towers and darker near towers with green crowns.
  const land: Tile[] = []
  const sx = Math.round(sc.cols * 0.82)
  const sr = Math.max(2, Math.min(5, Math.round(sc.rows * 0.07)))
  for (let dy = -sr; dy <= 0; dy++) for (let dx = -sr; dx <= sr; dx++) if (Math.hypot(dx, dy) <= sr + 0.3) land.push([sx + dx, horizon - 1 + dy, '#fff0b8', '#f5d27a', sc.glyph(dx, dy)])
  const cluster = (n: number, wMin: number, wMax: number, hMax: number) => {
    const out: { x: number; w: number; h: number; lean: number }[] = []
    for (let k = 0; k < n; k++) {
      const x = sc.rnd(0, sc.cols)
      const h = sc.rnd(hMax * 0.55, hMax)
      const w = sc.rnd(wMin, wMax)
      out.push({ x, w, h, lean: sc.rnd(-0.25, 0.25) })
      if (sc.rand() < 0.7) out.push({ x: x + w * sc.rnd(0.8, 1.3) * (sc.rand() < 0.5 ? -1 : 1), w: w * 0.7, h: h * sc.rnd(0.45, 0.7), lean: sc.rnd(-0.25, 0.25) })
    }
    return out
  }
  const far = karstRow(sc.cols, cluster(Math.round(Math.max(2, Math.min(8, sc.cols / 14))), 3, 6, Math.max(4, sc.rows * 0.16)))
  const near = karstRow(sc.cols, cluster(Math.round(Math.max(1, Math.min(5, sc.cols / 22))), 3.5, 7, Math.max(5, sc.rows * 0.24)))
  sc.add(sc.tiles(land))
  const farTiles: Tile[] = []
  const nearTiles: Tile[] = []
  const reflect: Tile[] = []
  for (let x = 0; x < sc.cols; x++) {
    for (let k = 0; k < (far[x] ?? 0); k++) farTiles.push([x, horizon - 1 - k, '#a9c4cf', '#97b5c2', sc.glyph(x, k)])
    const hgt = near[x] ?? 0
    for (let k = 0; k < hgt; k++) {
      const crown = k >= hgt - 2 && hgt > 2
      nearTiles.push([x, horizon - 1 - k, crown ? '#6f9e7c' : '#5b8b92', crown ? '#557f62' : '#46737a', sc.glyph(x, k)])
    }
    for (let k = 0; k < Math.min(hgt, sc.rows - horizon) * 0.5; k++) reflect.push([x, horizon + k, '#3f7f8f', null, ''])
  }
  sc.add(`<g opacity=".8">${sc.tiles(farTiles)}</g>`)
  sc.add(sc.tiles(nearTiles))
  sc.add(`<g opacity=".3">${sc.tiles(reflect)}</g>`)

  clouds(sc, { c: ['#ffffff', '#a9c1d6'], e: ['#eef6fd', '#c3d5e5'] }, Math.max(2, Math.min(5, Math.round(sc.cols / 30))), horizon * c * 0.45, 0.5, 0.9)

  // Birds glide right to left, flapping.
  for (let k = Math.round(Math.max(2, Math.min(8, sc.cols / 14))); k > 0; k--) {
    const y = sc.rnd(2, horizon * 0.5) * c
    const bird = sc.glyphs
      ? `<text fill="#33475b" x="0" y="0">v<animate attributeName="opacity" values="1;0" calcMode="discrete" dur=".5s" repeatCount="indefinite"/></text><text fill="#33475b" x="0" y="0" opacity="0">-<animate attributeName="opacity" values="0;1" calcMode="discrete" dur=".5s" repeatCount="indefinite"/></text>`
      : `<rect x="0" y="-1" width="${r1(c * 0.8)}" height="1" fill="#33475b"/>`
    sc.drift(bird, sc.W + 20, -20, y, (sc.W + 40) / (c * sc.rnd(0.8, 1.8)), sc.rand(), 0.85)
  }

  // Water ripples and the sun's glittering path.
  const ripples: Tile[] = []
  const glints: Tile[] = []
  for (let y = horizon; y < sc.rows; y++) {
    const d = y - horizon
    for (let x = 0; x < sc.cols; x++) if ((x * 13 + y * 7) % 17 === 0) ripples.push([x, y, null, '#e6f6fb', '~'])
    const spread = Math.round(1 + d * 0.8)
    for (let x = sx - spread; x <= sx + spread; x++) if (sc.rand() < 0.3) glints.push([x, y, '#fff0b8', '#f0d27a', '~'])
  }
  sc.add(`<g opacity=".55"><animateTransform attributeName="transform" type="translate" values="0 0;${c * 2} 0;0 0" dur="8s" repeatCount="indefinite"/>${sc.tiles(ripples)}</g>`)
  sc.add(`<g opacity=".6"><animate attributeName="opacity" values=".4;.7;.45;.65;.4" dur="2.4s" repeatCount="indefinite"/>${sc.tiles(glints)}</g>`)

  // Pole with a gold finial and a stone base.
  const pole: Tile[] = []
  for (let y = top - 1; y <= horizon + 1; y++) pole.push([px, y, '#ece6d8', '#bdb5a3', '|'])
  pole.push([px, top - 2, '#ffd34d', '#c99a1c', 'o'])
  for (let dx = -1; dx <= 1; dx++) pole.push([px + dx, horizon + 2, '#8d99a6', '#6d7884', '='])
  sc.add(sc.tiles(pole))

  // The flag: every column bobs on the same sine wave, offset by its distance
  // from the pole; amplitude grows toward the free end. A dark/light overlay
  // per column follows the slope of the cloth.
  const A = Math.max(1, H * 0.14)
  const k = (Math.PI * 2.2) / L
  const N = 16
  const dur = 1.85
  for (let i = 0; i < L; i++) {
    const f = Math.pow((i + 1) / L, 0.8)
    const col: Tile[] = []
    for (let j = 0; j < H; j++) {
      let n = 0
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) if (inStar(i + (a + 0.5) / 6, j + (b + 0.5) / 6, L / 2, H / 2, L / 5)) n++
      const star = n / 36 >= 0.22
      col.push([px + 1 + i, top + j, star ? FLAG_YELLOW : FLAG_RED, star ? FLAG_YELLOW_GLYPH : FLAG_RED_GLYPH, star ? '*' : sc.glyph(i, j)])
    }
    const ys: number[] = []
    const dark: number[] = []
    const light: number[] = []
    for (let s2 = 0; s2 <= N; s2++) {
      const ph = i * k - (Math.PI * 2 * s2) / N
      ys.push(Math.round((Math.sin(ph) + 0.18 * Math.sin(ph * 2 + 1)) * A * f) * c)
      const slope = Math.cos(ph) * (0.6 + f) * 0.5
      dark.push(r1(Math.max(0, -slope) * 0.32))
      light.push(r1(Math.max(0, slope) * 0.22))
    }
    const x = (px + 1 + i) * c
    sc.add(
      `<g><animateTransform attributeName="transform" type="translate" values="${ys.map(v => `0 ${v}`).join(';')}" dur="${dur}s" repeatCount="indefinite"/>` +
        sc.tiles(col) +
        `<rect x="${x}" y="${top * c}" width="${c}" height="${H * c}" fill="#000" opacity="0"><animate attributeName="opacity" values="${dark.join(';')}" dur="${dur}s" repeatCount="indefinite"/></rect>` +
        `<rect x="${x}" y="${top * c}" width="${c}" height="${H * c}" fill="#fff" opacity="0"><animate attributeName="opacity" values="${light.join(';')}" dur="${dur}s" repeatCount="indefinite"/></rect></g>`,
    )
  }
}

const TORII_GATE_ROWS = [
  '  mmmmmmmmmmmmmm  ',
  ' mMMMMMMMMMMMMMMm ',
  '   r   r    r   r ',
  '   rrrrrrrrrrrrrr ',
  '   R            R ',
  '   R            R ',
  '   R            R ',
  '   R            R ',
  '  bbb          bbb',
]

const TORII_PAL: Pal = {
  m: ['#7f1d1d', '#450a0a', '='],
  M: ['#dc2626', '#991b1b', '#'],
  r: ['#ef4444', '#b91c1c', '-'],
  R: ['#dc2626', '#991b1b', '|'],
  b: ['#475569', '#334155', 'b'],
}

const SAKURA_BRANCH_ROWS = [
  '                                              bbbbbbbbbbbbbb',
  '                                      bbbbbbbbb       bbbbbb',
  '                              kkkkkkbbb                 bbbb',
  '                     FffF       bbkkk   FffF                ',
  '             FffF   fpccpf   kkk    k  fpccpf    FffF       ',
  '            fpccpf   FffF   k      k    FffF    fpccpf      ',
  '        l    FffF         kk      k              FffF       ',
  '      FffF         FffF  k       k     FffF                 ',
  '     fpccpf   l   fpccpf        k     fpccpf    l    d      ',
  '      FffF         FffF                FffF          d      ',
  '                                                     L      ',
  '                                                    lGl     ',
  '                                                     L      ',
]

const SAKURA_BRANCH_PAL: Pal = {
  b: ['#3e2723', '#241411', '#'],
  k: ['#5d4037', '#3e2723', '='],
  f: ['#ffb7c5', '#ffffff', '*'],
  F: ['#f472b6', '#fff1f2', '+'],
  p: ['#fce7f3', '#f472b6', '°'],
  c: ['#e11d48', '#ffffff', 'o'],
  l: ['#86efac', '#15803d', ':'],
  d: ['#1e293b', null, '|'],
  L: ['#b91c1c', '#7f1d1d', '='],
  G: ['#fef08a', '#f59e0b', '*'],
}

function sakura(sc: Scene) {
  const hy = r1(sc.H * 0.76)
  const c = sc.cell

  // Sky gradient
  const skyId = sc.id('sky')
  sc.def(`<linearGradient id="${skyId}" x1="0" y1="0" x2="0" y2="${hy}"><stop offset="0" stop-color="#fce7f3"/><stop offset="0.4" stop-color="#fed7aa"/><stop offset="0.75" stop-color="#fef3c7"/><stop offset="1" stop-color="#ffedd5"/></linearGradient>`)
  sc.add(`<rect width="${sc.W}" height="${hy}" fill="url(#${skyId})"/>`)

  // Lake gradient
  const lakeId = sc.id('lake')
  sc.def(`<linearGradient id="${lakeId}" x1="0" y1="${hy}" x2="0" y2="${sc.H}"><stop offset="0" stop-color="#fbcfe8"/><stop offset="0.25" stop-color="#93c5fd"/><stop offset="1" stop-color="#2563eb"/></linearGradient>`)
  sc.add(`<rect y="${hy}" width="${sc.W}" height="${sc.H - hy}" fill="url(#${lakeId})"/>`)

  // Sunrise glow
  sc.add(sc.glow(sc.W * 0.32, hy * 0.9, Math.max(sc.W, sc.H) * 0.45, '#fb7185', 0.45))
  sc.add(sc.glow(sc.W * 0.85, hy * 0.25, Math.max(sc.W, sc.H) * 0.5, '#f472b6', 0.3))

  // Draw Mt. Fuji tiles
  const fx = Math.round(sc.cols * (sc.cols < 60 ? 0.42 : 0.28))
  const fw = Math.round(Math.min(50, Math.max(20, sc.cols * 0.5)))
  const fh = Math.round(Math.min(22, Math.max(9, sc.rows * 0.36)))
  const halfW = fw / 2
  const fujiTiles: Tile[] = []
  const horizRow = Math.round(sc.rows * 0.76)

  for (let x = Math.floor(fx - halfW); x <= Math.ceil(fx + halfW); x++) {
    if (x < 0 || x >= sc.cols) continue
    const u = Math.abs(x + 0.5 - fx) / halfW
    if (u >= 1) continue
    let h = fh * Math.pow(1 - Math.pow(u, 1.35), 1.75)
    if (u < 0.1) h *= 0.96
    const fH = Math.round(h)
    for (let y = horizRow - fH; y < horizRow; y++) {
      const elev = horizRow - y
      const isSnow = elev > fH * 0.62 || (elev > fH * 0.46 && sc.rand() < 0.35)
      if (isSnow) {
        fujiTiles.push([x, y, '#ffffff', '#e2e8f0', '*'])
      } else {
        const dx = x - fx
        if (dx < 0) fujiTiles.push([x, y, '#818cf8', '#c7d2fe', '/'])
        else fujiTiles.push([x, y, '#4338ca', '#312e81', '\\'])
      }
    }
  }
  sc.add(sc.tiles(fujiTiles))

  // Torii Gate sprite on water edge
  const toriiId = sc.defSprite(TORII_GATE_ROWS, TORII_PAL)
  const tx = Math.round(Math.max(1, Math.min(sc.cols - 20, sc.cols * (sc.cols < 60 ? 0.05 : 0.12))))
  sc.add(use(toriiId, ` x="${tx * c}" y="${(horizRow - 7) * c}"`))

  // Sakura Branch at top right
  const branchId = sc.defSprite(SAKURA_BRANCH_ROWS, SAKURA_BRANCH_PAL)
  const branchW = 60 * c
  const bx = Math.max(0, sc.W - branchW)
  sc.add(use(branchId, ` x="${r1(bx)}" y="0"`))

  // Hanging lantern glow
  const lx = bx + 52 * c
  const ly = 12 * c
  sc.add(sc.glow(lx, ly, c * 6, '#fef08a', 0.55))

  // Animated Birds flying over Mt. Fuji
  for (let b = 0; b < 3; b++) {
    const by = sc.rnd(10, hy * 0.5)
    const dur = r1(sc.rnd(8, 14))
    const begin = r1(sc.rnd(0, 14))
    sc.add(
      `<g opacity=".85"><animateTransform attributeName="transform" type="translate" from="${sc.W + 20} ${r1(by)}" to="-20 ${r1(by + sc.rnd(-15, 15))}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/><text fill="#334155" x="0" y="0">v</text></g>`
    )
  }

  // Falling animated sakura petals
  const n = Math.max(18, Math.min(48, Math.round((sc.cols * sc.rows) / 100)))
  const petalCols = ['#ffb7c5', '#fbcfe8', '#fda4af', '#f472b6', '#ffffff']
  for (let k = 0; k < n; k++) {
    const x0 = sc.rnd(0, sc.W + 60)
    const y0 = sc.rnd(-30, sc.H * 0.6)
    const dur = r1(sc.rnd(6, 13))
    const begin = r1(sc.rnd(0, 13))
    const col = sc.pick(petalCols)
    const ch = sc.pick(['*', '+', '°', '.'])
    const glyph = sc.glyphs
      ? `<text fill="${col}" x="0" y="0">${ch}</text>`
      : `<circle cx="0" cy="0" r="${r1(sc.cell * 0.35)}" fill="${col}"/>`

    const dx = -r1(sc.rnd(sc.W * 0.45, sc.W * 0.9))
    const dy = r1(sc.rnd(sc.H * 0.75, sc.H * 1.3))
    sc.add(
      `<g opacity="${r1(sc.rnd(0.65, 0.95))}">` +
        `<animateTransform attributeName="transform" type="translate" from="${r1(x0)} ${r1(y0)}" to="${r1(x0 + dx)} ${r1(y0 + dy)}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>` +
        `<g><animateTransform attributeName="transform" type="rotate" values="0;180;360" dur="${r1(sc.rnd(2.5, 5))}s" repeatCount="indefinite"/>${glyph}</g>` +
      `</g>`
    )
  }
}


function galaxy(sc: Scene) {
  const c = sc.cell
  const skyId = sc.id('space')
  sc.def(`<linearGradient id="${skyId}" x1="0" y1="0" x2="${sc.W}" y2="${sc.H}"><stop offset="0" stop-color="#04020a"/><stop offset="0.45" stop-color="#0b061d"/><stop offset="0.8" stop-color="#06091f"/><stop offset="1" stop-color="#02040d"/></linearGradient>`)
  sc.add(`<rect width="${sc.W}" height="${sc.H}" fill="url(#${skyId})"/>`)

  // Multi-colored Nebula clouds
  sc.add(sc.glow(sc.W * 0.2, sc.H * 0.35, Math.max(sc.W, sc.H) * 0.42, '#7c3aed', 0.28))
  sc.add(sc.glow(sc.W * 0.8, sc.H * 0.72, Math.max(sc.W, sc.H) * 0.4, '#0891b2', 0.24))
  sc.add(sc.glow(sc.W * 0.48, sc.H * 0.2, Math.max(sc.W, sc.H) * 0.32, '#db2777', 0.2))

  // Nebula tile clusters
  const nebTiles: Tile[] = []
  for (let y = 0; y < sc.rows; y++) {
    for (let x = 0; x < sc.cols; x++) {
      const n1 = Math.sin(x * 0.14 + y * 0.18) * Math.cos(x * 0.09 - y * 0.12)
      if (n1 > 0.48 && sc.rand() < 0.45) {
        const col = (x + y) % 3 === 0 ? '#a78bfa' : (x + y) % 3 === 1 ? '#f472b6' : '#67e8f9'
        nebTiles.push([x, y, null, col, sc.pick(['.', '·', ':']), 0.35])
      }
    }
  }
  sc.add(sc.tiles(nebTiles))

  // Distant Spiral Galaxy (top-left)
  const gx = r1(sc.W * 0.22)
  const gy = r1(sc.H * 0.24)
  const gs = r1(Math.max(c * 2, Math.min(sc.W, sc.H) * 0.07))
  sc.add(sc.glow(gx, gy, gs * 2.2, '#c4b5fd', 0.32))
  sc.add(
    `<g opacity="0.85">` +
      `<ellipse cx="${gx}" cy="${gy}" rx="${r1(gs * 1.8)}" ry="${r1(gs * 0.65)}" fill="none" stroke="#c4b5fd" stroke-width="${r1(c * 0.5)}" stroke-dasharray="6,4" transform="rotate(-18 ${gx} ${gy})"/>` +
      `<circle cx="${gx}" cy="${gy}" r="${r1(c * 0.6)}" fill="#fef3c7"/>` +
    `</g>`
  )

  // Ringed Ice Giant Planet (bottom-left)
  const px = r1(sc.W * 0.14)
  const py = r1(sc.H * 0.78)
  const pr = r1(Math.max(c * 2.2, Math.min(sc.W, sc.H) * 0.09))
  sc.add(sc.glow(px, py, pr * 2.2, '#6366f1', 0.3))
  sc.add(
    `<g transform="rotate(-14 ${px} ${py})">` +
      `<ellipse cx="${px}" cy="${py}" rx="${r1(pr * 2.2)}" ry="${r1(pr * 0.55)}" fill="none" stroke="#a5b4fc" stroke-width="${r1(c * 0.7)}" opacity="0.65"/>` +
      `<circle cx="${px}" cy="${py}" r="${pr}" fill="#4338ca"/>` +
      `<path d="M ${r1(px - pr * 2.2)} ${py} A ${r1(pr * 2.2)} ${r1(pr * 0.55)} 0 0 0 ${r1(px + pr * 2.2)} ${py}" fill="none" stroke="#e0e7ff" stroke-width="${r1(c * 0.85)}" opacity="0.9"/>` +
    `</g>`
  )

  // Black Hole center (3D layered Gargantua)
  const bx = r1(sc.W * (sc.cols < 60 ? 0.52 : 0.64))
  const by = r1(sc.H * 0.44)
  const br = r1(Math.max(c * 2.5, Math.min(sc.W, sc.H) * 0.105))
  const diskRx = r1(br * 3.0)
  const diskRy = r1(br * 0.65)

  // Central amber & rose aura around black hole
  sc.add(sc.glow(bx, by, br * 4.2, '#f59e0b', 0.38))
  sc.add(sc.glow(bx, by, br * 2.4, '#ec4899', 0.42))

  // 1. Back half of accretion disk + Gravitational Lensing Upper/Lower Arcs
  sc.add(
    `<path d="M ${r1(bx - diskRx)} ${by} A ${diskRx} ${diskRy} 0 0 1 ${r1(bx + diskRx)} ${by}" fill="none" stroke="#f97316" stroke-width="${r1(c * 1.4)}" opacity="0.8"/>` +
    `<path d="M ${r1(bx - br * 1.85)} ${by} A ${r1(br * 1.85)} ${r1(br * 1.55)} 0 0 1 ${r1(bx + br * 1.85)} ${by}" fill="none" stroke="#fbbf24" stroke-width="${r1(c * 1.15)}" opacity="0.9"/>` +
    `<path d="M ${r1(bx - br * 1.7)} ${by} A ${r1(br * 1.7)} ${r1(br * 1.25)} 0 0 0 ${r1(bx + br * 1.7)} ${by}" fill="none" stroke="#ea580c" stroke-width="${r1(c * 0.9)}" opacity="0.78"/>`
  )

  // 2. Central Event Horizon & Photon Sphere
  sc.add(`<circle cx="${bx}" cy="${by}" r="${r1(br)}" fill="#000000"/>`)
  sc.add(`<circle cx="${bx}" cy="${by}" r="${r1(br * 1.06)}" stroke="#fef08a" stroke-width="${r1(c * 0.55)}" fill="none" opacity="0.95"/>`)

  // 3. Front half of accretion disk (passes IN FRONT of the Event Horizon!)
  sc.add(
    `<path d="M ${r1(bx - diskRx * 1.15)} ${by} A ${r1(diskRx * 1.15)} ${r1(diskRy * 1.15)} 0 0 0 ${r1(bx + diskRx * 1.15)} ${by}" fill="none" stroke="#db2777" stroke-width="${r1(c * 1.1)}" stroke-dasharray="16,8" opacity="0.8"/>` +
    `<path d="M ${r1(bx - diskRx)} ${by} A ${diskRx} ${diskRy} 0 0 0 ${r1(bx + diskRx)} ${by}" fill="none" stroke="#fde68a" stroke-width="${r1(c * 1.3)}" opacity="0.95"/>`
  )

  // Twinkling stars & Cross-flare Hero Stars
  const starCount = Math.max(28, Math.min(65, Math.round((sc.cols * sc.rows) / 75)))
  const starCols = ['#ffffff', '#fef08a', '#a5f3fc', '#fbcfe8', '#c7d2fe']
  for (let k = 0; k < starCount; k++) {
    const sx = r1(sc.rnd(0, sc.W))
    const sy = r1(sc.rnd(0, sc.H))
    const dur = r1(sc.rnd(1.8, 4.5))
    const begin = r1(sc.rnd(0, 4.5))
    const col = sc.pick(starCols)
    const ch = sc.pick(['.', '+', '*', '·'])
    sc.add(
      `<g opacity="0.85"><animate attributeName="opacity" values="0.2;1.0;0.2" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>` +
        `<text fill="${col}" x="${sx}" y="${sy}">${ch}</text>` +
      `</g>`
    )
  }

  // Shooting stars
  for (let m = 0; m < 2; m++) {
    const mx0 = r1(sc.rnd(sc.W * 0.1, sc.W * 0.7))
    const my0 = r1(sc.rnd(0, sc.H * 0.3))
    const dur = r1(sc.rnd(5.0, 9.0))
    const begin = r1(sc.rnd(0, 9.0))
    sc.add(
      `<g opacity="0.9">` +
        `<animateTransform attributeName="transform" type="translate" from="${mx0} ${my0}" to="${r1(mx0 + sc.W * 0.45)} ${r1(my0 + sc.H * 0.4)}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>` +
        `<text fill="#ffffff" x="0" y="0">*</text>` +
        `<text fill="#38bdf8" x="-6" y="-3">~</text>` +
        `<text fill="#818cf8" x="-12" y="-6">-</text>` +
      `</g>`
    )
  }
}

// Hoi An by night: strings of silk lanterns over the old town, paper flower
// lanterns (hoa dang) and a sampan drifting down the Hoai river.
const LANTERN_COLS = [
  ['#d8342a', '#9f1f18', '#ff6a4d'],
  ['#ef7d22', '#b9560f', '#ffa95c'],
  ['#f5bd2e', '#c08d12', '#ffe07a'],
  ['#e8487f', '#aa2a58', '#ff8db0'],
  ['#1f9d94', '#13706a', '#56d6c8'],
] as const

function hoian(sc: Scene) {
  const c = sc.cell
  const river = Math.round(sc.rows * 0.74)
  const houseMax = Math.max(2, Math.min(10, Math.round(sc.rows * 0.16)))
  const small = sc.rows < 28
  const lh = small ? 4 : 7
  const lw = small ? 3 : 5
  const n = Math.max(1, Math.min(3, Math.round(sc.rows / 22)))
  const step = Math.max(1, (river - houseMax - 2 - lh - 3) / n)

  // Night sky, river, and the warm haze of the town on the horizon.
  const sky = sc.id('g')
  sc.def(`<linearGradient id="${sky}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0a26"/><stop offset=".5" stop-color="#1f1438"/><stop offset="1" stop-color="#4a2340"/></linearGradient>`)
  sc.add(`<rect width="${sc.W}" height="${river * c}" fill="url(#${sky})"/>`)
  const water = sc.id('g')
  sc.def(`<linearGradient id="${water}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c1a33"/><stop offset="1" stop-color="#0a0a20"/></linearGradient>`)
  sc.add(`<rect y="${river * c}" width="${sc.W}" height="${sc.H - river * c}" fill="url(#${water})"/>`)
  sc.add(sc.glow(sc.W * 0.5, river * c, Math.max(sc.W, sc.H) * 0.55, '#ff9a4d', 0.2))

  // Stars twinkle in two groups.
  const stars: Tile[][] = [[], []]
  for (let k = Math.max(4, Math.min(50, Math.round((sc.cols * sc.rows) / 160))); k > 0; k--) {
    sc.pick(stars).push([sc.int(0, sc.cols - 1), sc.int(0, Math.max(0, river - houseMax - 3)), null, '#f4e8d0', sc.pick(['.', '+'])])
  }
  stars.forEach((g, i) => sc.add(`<g>${twinkle(3 + i * 1.3, i, 0.2)}${sc.tiles(g)}</g>`))

  // The old town: ochre walls, tiled roofs, lit windows, a stone embankment.
  const WALLS = [['#3b2a20', '#4a3527'], ['#46321f', '#574027'], ['#33261f', '#433228']] as const
  const town: Tile[] = []
  const roofs: Tile[] = []
  const lit: Tile[][] = [[], [], []]
  for (let x = sc.int(-4, 0); x < sc.cols; ) {
    const wd = sc.int(6, 12)
    const hh = sc.int(Math.ceil(houseMax * 0.5), houseMax)
    const wall = sc.pick(WALLS)
    for (let i = x; i < x + wd; i++) for (let y = river - hh; y < river; y++) town.push([i, y, wall[0], wall[1], sc.glyph(i, y)])
    for (let k = 0; k < 2; k++) for (let i = x - 1 + k * 2; i <= x + wd - k * 2; i++) roofs.push([i, river - hh - 1 - k, k ? '#6d3324' : '#7f3d2a', '#55261a', '='])
    for (let wx = x + 2; wx < x + wd - 1; wx += 3) {
      for (let wy = river - hh + 1; wy < river - 1; wy += 3) if (sc.rand() < 0.65) sc.pick(lit).push([wx, wy, '#ffc65c', '#d99a2f', '#'])
    }
    x += wd
  }
  for (let x = 0; x < sc.cols; x++) town.push([x, river, '#40362f', '#2f2722', '_'])
  sc.add(sc.tiles(town) + sc.tiles(roofs))
  lit.forEach((g, i) => sc.add(`<g>${twinkle(4 + i * 1.7, i * 1.3, 0.45)}${sc.tiles(g)}</g>`))

  // Ripples drift one way and back.
  const ripples: Tile[] = []
  for (let y = river + 1; y < sc.rows; y++) for (let x = 0; x < sc.cols; x++) if ((x * 11 + y * 5) % 19 === 0) ripples.push([x, y, null, '#6d5a86', '~'])
  sc.add(`<g opacity=".6"><animateTransform attributeName="transform" type="translate" values="0 0;${c * 2} 0;0 0" dur="9s" repeatCount="indefinite"/>${sc.tiles(ripples)}</g>`)

  // Each color's lantern art lives in <defs>, reused along the strings.
  const art = LANTERN_COLS.map(col => {
    const pal: Pal = { L: [col[0], col[1]], B: [col[2], col[0]], c: ['#c9a14a', '#8a6c2a', '='], t: [null, '#e6c36a', '|'] }
    return sc.defSprite(small ? [' c ', 'LBL', 'LBL', ' t '] : [' ccc ', 'LLLLL', 'LBBBL', 'LBBBL', 'LLLLL', ' ccc ', '  t  '], pal)
  })
  const wires: string[] = []
  const lanterns: string[] = []
  const shimmer: Tile[][] = [[], [], []]
  for (let k = 0; k < n; k++) {
    const y0 = Math.round(k * step)
    const sag = small ? 1 : sc.rnd(2, 3.2)
    const alpha = 0.7 + (0.3 * (k + 1)) / n
    const wire: Tile[] = []
    const yAt = (x: number) => {
      const u = (x / Math.max(1, sc.cols)) * 2 - 1
      return y0 + sag * (1 - u * u)
    }
    for (let x = 0; x < sc.cols; x++) wire.push([x, Math.round(yAt(x)), null, '#8d7a68', '-'])
    wires.push(`<g opacity="${r1(alpha * 0.6)}">${sc.tiles(wire)}</g>`)
    for (let x = sc.rnd(0, 5); x < sc.cols; x += sc.rnd(9, 14)) {
      const X = Math.round(x)
      const Y = Math.round(yAt(x))
      const i = sc.int(0, LANTERN_COLS.length - 1)
      const col = LANTERN_COLS[i] ?? LANTERN_COLS[0]
      const id = art[i] ?? art[0] ?? ''
      const glow = sc.glow((lw / 2) * c, (lh / 2) * c, c * (small ? 3.5 : 6), col[2], r1(0.34 * alpha), twinkle(sc.rnd(1.8, 3.4), sc.rnd(0, 3), 0.65))
      lanterns.push(
        `<g transform="translate(${X * c} ${Y * c})" opacity="${r1(alpha)}"><g><animateTransform attributeName="transform" type="translate" values="${r1(-c * 0.5)} 0;${r1(c * 0.5)} 0;${r1(-c * 0.5)} 0" dur="${r1(sc.rnd(5, 9))}s" begin="-${r1(sc.rnd(0, 9))}s" repeatCount="indefinite"/>${glow}${use(id)}</g></g>`,
      )
      // The lantern's light breaks up on the water below it.
      for (let y = river + 1; y < sc.rows; y++) if (sc.rand() < 0.34) sc.pick(shimmer).push([X + Math.floor(lw / 2) + sc.int(-1, 1), y, col[0], col[1], '~'])
    }
  }
  shimmer.forEach((g, i) => sc.add(`<g opacity=".32"><g>${twinkle(1.6 + i * 0.5, i * 0.4, 0.3)}${sc.tiles(g)}</g></g>`))

  // A sampan, when there is enough river to float it.
  if (sc.rows - river >= 8) {
    const pal: Pal = { L: ['#ff6a4d', '#d8342a'], '|': [null, '#a8896a', '|'], r: ['#3a2c22', '#2a1f18'], h: ['#1c1512', '#2c211b'] }
    const id = sc.defSprite(['          L   ', '    rrrr  |   ', '  rrrrrrrr|   ', 'hhhhhhhhhhhhhh', ' hhhhhhhhhhhh '], pal)
    const inner = sc.glow(10.5 * c, 0.5 * c, 3.5 * c, '#ff8a4d', 0.42) + use(id)
    sc.drift(bob(inner, c * 0.5, 3.4), -15 * c, sc.W + c, (river + 1) * c, (sc.W + 16 * c) / (c * 0.5), sc.rand())
  }

  // Hoa dang: a candle in a paper flower, bobbing downstream.
  const flowerPals: [string, string][] = [['#ff9fcb', '#d9628f'], ['#fff4ea', '#d8c6b4'], ['#ff8a6b', '#cf5a3e']]
  const flowers = flowerPals.map(([petal, edge]) =>
    sc.defSprite([' f ', 'PpP'], { f: ['#fff1a8', '#f2b431', '*'], P: [petal, edge], p: ['#ffd66b', '#d9a22e'] }),
  )
  const rows = Array.from({ length: Math.max(3, Math.min(14, Math.round(sc.cols / 9))) }, () => sc.int(river + 1, Math.max(river + 1, sc.rows - 2))).sort((a, b) => a - b)
  for (const row of rows) {
    const glow = sc.glow(1.5 * c, c, 3 * c, '#ffbf66', 0.42, twinkle(sc.rnd(0.9, 1.8), sc.rnd(0, 2), 0.6))
    sc.drift(bob(glow + use(sc.pick(flowers)), c * 0.5, r1(sc.rnd(2.5, 4))), -4 * c, sc.W + c, (row - 1) * c, (sc.W + 5 * c) / (c * sc.rnd(0.3, 0.8)), sc.rand())
  }

  // Wires and lanterns hang in front of everything else.
  sc.add(wires.join('') + lanterns.join(''))
}

/* ----------------------------------------------------------------- entry */

type NxRGB = [number, number, number]
const nxHex = (h: string): NxRGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const nxMix = (a: NxRGB, b: NxRGB, t: number): NxRGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const NX_BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const nxB = (x: number, y: number) => (NX_BAYER[(y & 3) * 4 + (x & 3)] ?? 0) / 16;
const nxClamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
function nxHash(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
type NxLight = { x: number; y: number; c: string; ph: number; big?: boolean; fairy?: boolean };
type NxGlow = { x: number; y: number; r: number; c: string; a: number; star?: boolean; lamp?: boolean };
const NX = {
  skyTop: nxHex('#142347'),
  skyMid: nxHex('#29457c'),
  skyLow: nxHex('#6f8fc4'),
  star: nxHex('#e8eeff'),
  hillFar: nxHex('#4d6aa3'),
  hillNear: nxHex('#3a5590'),
  pineFar: nxHex('#2c4677'),
  snow: nxHex('#eef3fb'),
  snowShade: nxHex('#b7c6e4'),
  snowDeep: nxHex('#93a8d4'),
  wall: nxHex('#7a4b31'),
  wallDark: nxHex('#5a3423'),
  beam: nxHex('#3e241a'),
  window: nxHex('#ffcc66'),
  windowHot: nxHex('#fff0b8'),
  door: nxHex('#3a2116'),
  roofUnder: nxHex('#6c7fae'),
  tree: nxHex('#1d4733'),
  treeDark: nxHex('#143424'),
  treeLit: nxHex('#2c5f44'),
  trunk: nxHex('#3b2619'),
  post: nxHex('#1e2236'),
  lamp: nxHex('#ffd27a'),
  branch: nxHex('#2a2129'),
  gold: nxHex('#ffd34d'),
};
const NX_BULBS = ['#fff1c4', '#ffe9a8', '#ffe9a8', '#ffd34d', '#ffd34d', '#ff6a4f', '#7fd0ff'];

// Paints the still scene into a PW x PH pixel buffer and records where the
// lights are, so the frame can make them twinkle.
function nxPaint(PW: number, PH: number, seed: number, wide: boolean) {
  let pc = 0;
  const pick = <T,>(a: T[]): T => a[Math.floor(nxHash(pc++, 5, seed) * a.length)] as T;
  const img = new Float32Array(PW * PH * 4);
  const put = (x: number, y: number, col: NxRGB, a = 1) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= PW || y >= PH) return;
    const i = (y * PW + x) * 4;
    if (a >= 1) {
      img[i] = col[0];
      img[i + 1] = col[1];
      img[i + 2] = col[2];
    } else {
      img[i] = img[i]! + (col[0] - img[i]!) * a;
      img[i + 1] = img[i + 1]! + (col[1] - img[i + 1]!) * a;
      img[i + 2] = img[i + 2]! + (col[2] - img[i + 2]!) * a;
    }
    img[i + 3] = 255;
  };
  const H = (a: number, b: number) => nxHash(a, b, seed);
  const lights: NxLight[] = [];
  const glows: NxGlow[] = [];

  // Blue-hour sky in dithered bands, a few stars up high.
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const t = y / (PH * 0.7);
      const q = Math.round(nxClamp(t, 0, 1) * 10 + nxB(x, y) - 0.5) / 10;
      put(x, y, q < 0.55 ? nxMix(NX.skyTop, NX.skyMid, q / 0.55) : nxMix(NX.skyMid, NX.skyLow, (q - 0.55) / 0.45));
    }
  }
  for (let i = 0; i < PW * PH * 0.0012; i++) {
    const x = H(i, 1) * PW;
    const y = H(i, 2) * PH * 0.35;
    put(x, y, NX.star, 0.4 + H(i, 3) * 0.6);
  }

  const ground = (x: number) => PH * (0.8 - 0.02 * Math.sin((x / PW) * 3.4 + H(9, 9) * 6));
  // Far snowy hills with rows of snow-capped pines.
  ;([
    [0.6, 0.05, NX.hillFar, 0.05],
    [0.68, 0.045, NX.hillNear, 0.075],
  ] as [number, number, NxRGB, number][]).forEach(([base, amp, col, ph], k) => {
    const p = [H(k, 20) * 6, H(k, 21) * 6] as const;
    const ridge = (x: number) => PH * (base - amp * (0.5 + 0.35 * Math.sin((x / PW) * 6 + p[0]) + 0.15 * Math.sin((x / PW) * 17 + p[1])));
    const top = new Float32Array(PW);
    for (let x = 0; x < PW; x++) top[x] = ridge(x);
    const pineH = Math.max(3, PH * ph);
    const snowTips: [number, number][] = [];
    for (let cx = H(k, 30) * pineH; cx < PW; cx += pineH * (0.35 + 0.4 * H(Math.round(cx), k + 40))) {
      if (H(Math.round(cx), k + 50) < 0.3) continue;
      const c = Math.round(cx);
      const h = pineH * (0.6 + 0.5 * H(c, k + 60));
      const tip = ridge(c) - h;
      for (let d = 0; d <= h; d++) {
        const half = Math.floor(d * 0.36) - ((d % 4) === 0 && d > 0 ? 1 : 0);
        for (let dx = -half; dx <= half; dx++) {
          const x = c + dx;
          if (x < 0 || x >= PW) continue;
          if (tip + d < top[x]!) {
            top[x] = tip + d;
            if ((d % 4) === 1 || d === 0) snowTips.push([x, tip + d]);
          }
        }
      }
    }
    for (let x = 0; x < PW; x++) {
      for (let y = Math.max(0, Math.round(top[x]!)); y < PH; y++) put(x, y, col);
      // Snow lies on the open ground between the pines.
      if (Math.abs(top[x]! - ridge(x)) < 0.5) put(x, Math.round(top[x]!), nxMix(col, NX.snow, 0.3 - k * 0.08));
    }
    for (const [x, y] of snowTips) put(x, y, nxMix(col, NX.snow, 0.6));
    // Distant village glow at the foot of the hills.
    for (let y = Math.round(PH * (base + 0.02)); y < PH * (base + 0.08); y++) {
      for (let x = 0; x < PW; x++) if (nxB(x, y) < 0.25 * (1 - k * 0.4)) put(x, y, nxMix(col, NX.skyLow, 0.5), 0.6);
    }
  });

  // Snowy ground with soft blue shadows and sparkles.
  for (let x = 0; x < PW; x++) {
    const g = Math.round(ground(x));
    for (let y = g; y < PH; y++) {
      const t = (y - g) / (PH - g + 1);
      let col = NX.snow;
      // Soft drifts: broad shadowed hollows, dithered only along their edges.
      const sh = 0.5 + 0.5 * Math.sin(x * 0.035 + Math.sin(y * 0.09) * 2 + H(1, 1) * 6) * Math.cos(y * 0.07 + x * 0.01);
      if (sh > 0.78 || (sh > 0.68 && nxB(x, y) < (sh - 0.68) * 10)) col = NX.snowShade;
      if (y === g) col = nxMix(NX.snow, NX.skyLow, 0.25);
      put(x, y, col);
      if (H(x, y + 999) < 0.004) put(x, y, [255, 255, 255]);
    }
  }

  // Wooden houses with thick snow on their roofs and lit windows.
  const s = Math.max(1, Math.round(PH / 130));
  const house = (x0: number, w: number, wallH: number) => {
    const g = Math.round(Math.min(ground(x0), ground(x0 + w)));
    const roofH = Math.round(w * 0.42);
    const top = g - wallH;
    for (let y = top; y < g; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const beam = (x - x0) % (6 * s) === 0 || y === top || x === x0 + w - 1;
        put(x, y, beam ? NX.beam : x > x0 + w * 0.6 ? NX.wallDark : NX.wall);
      }
    }
    // Windows two per floor, a door in the middle.
    const ww = 3 * s;
    const wh = 4 * s;
    const rows = Math.max(1, Math.floor((wallH - 2 * s) / (wh + 3 * s)));
    for (let r = 0; r < rows; r++) {
      const wy = top + 2 * s + r * (wh + 3 * s);
      for (const fx of [0.18, 0.66]) {
        const wx = Math.round(x0 + w * fx);
        for (let y = wy; y < wy + wh; y++) for (let x = wx; x < wx + ww; x++) put(x, y, (x - wx) === Math.floor(ww / 2) || (y - wy) === Math.floor(wh / 2) ? NX.beam : y > wy + wh / 2 ? NX.windowHot : NX.window);
        glows.push({ x: wx + ww / 2, y: wy + wh / 2, r: 6 * s, c: '#ffbf5a', a: 0.45 });
      }
    }
    const dx = Math.round(x0 + w / 2 - 2 * s);
    for (let y = g - 6 * s; y < g; y++) for (let x = dx; x < dx + 4 * s; x++) put(x, y, NX.door);
    // Gable roof: dark underside, then a deep layer of snow with a soft edge.
    for (let d = 0; d <= roofH; d++) {
      const half = (d / roofH) * (w / 2 + 2 * s);
      const y = top - roofH + d;
      for (let x = Math.round(x0 + w / 2 - half); x <= x0 + w / 2 + half; x++) put(x, y, d > roofH - 2 * s ? NX.roofUnder : y < top - roofH + d + 1 && H(x, y) < 0.2 ? NX.snowShade : NX.snow);
    }
    // Icicle drips and a string of lights along the eaves.
    for (let x = x0 - 2 * s; x <= x0 + w + 2 * s; x++) if (H(x, top) < 0.25) for (let k = 0; k < 1 + H(x, 3) * 2 * s; k++) put(x, top + 1 + k, NX.snowShade);
    for (let d = 2; d <= roofH; d += 2 * s) {
      const half = (d / roofH) * (w / 2 + 2 * s);
      const y = top - roofH + d + 1;
      lights.push({ x: x0 + w / 2 - half, y, c: pick(NX_BULBS), ph: H(d, x0) * 6 });
      lights.push({ x: x0 + w / 2 + half, y, c: pick(NX_BULBS), ph: H(d, x0 + 1) * 6 });
    }
    // Chimney with a cap of snow.
    const cx = Math.round(x0 + w * 0.72);
    const cTop = top - Math.round(roofH * 0.75);
    for (let y = cTop; y < cTop + 4 * s; y++) for (let x = cx; x < cx + 3 * s; x++) put(x, y, y < cTop + s ? NX.snow : NX.beam);
  };

  // The tree: tiers of dark needles, snow on each tier, lights in a spiral.
  const tree = (cx: number, base: number, h: number) => {
    const tipY = base - h;
    for (let y = Math.round(base - h * 0.08); y < base; y++) for (let x = Math.round(cx - h * 0.03); x <= cx + h * 0.03; x++) put(x, y, NX.trunk);
    const half = (d: number) => {
      const tier = h / 6;
      const k = d % tier;
      return (d / h) * h * 0.36 * (0.75 + 0.25 * (k / tier)) + 1;
    };
    for (let d = 0; d < h * 0.92; d++) {
      const y = tipY + d;
      const hw = half(d);
      for (let x = Math.round(cx - hw); x <= cx + hw; x++) {
        const u = (x - cx) / hw;
        const tierTop = (d % (h / 6)) < 1.5;
        let col = u < -0.2 ? NX.treeLit : u > 0.45 ? NX.treeDark : NX.tree;
        if (tierTop && H(x, y) < 0.7) col = NX.snow;
        else if (H(x, y + 3) < 0.05) col = NX.snowShade;
        put(x, y, col);
      }
    }
    // Lights wind around the tree; only the front of the spiral shows.
    const nb = Math.round(nxClamp(h * 9, 120, 520));
    for (let i = 0; i < nb; i++) {
      const t = i / nb;
      const d = t * h * 0.9;
      const ang = t * Math.PI * 2 * 7.5;
      if (Math.cos(ang) < -0.2) continue;
      lights.push({ x: cx + Math.sin(ang) * half(d) * 0.92, y: tipY + d, c: pick(NX_BULBS), ph: H(i, 77) * 6, big: true });
    }
    // Baubles.
    for (let i = 0; i < h * 0.25; i++) {
      const d = h * (0.15 + 0.75 * H(i, 88));
      const x = cx + (H(i, 89) * 2 - 1) * half(d) * 0.8;
      put(x, tipY + d, nxHex(pick(['#e0393e', '#ffd34d', '#e0393e', '#c8d4ff'])));
    }
    // The star.
    const r = Math.max(2, h * 0.05);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const a = Math.atan2(y, x);
      const rr = r * (0.5 + 0.5 * Math.abs(Math.cos(a * 2.5)));
      if (Math.hypot(x, y) <= rr) put(cx + x, tipY - r * 0.6 + y, NX.gold);
    }
    glows.push({ x: cx, y: tipY - r * 0.6, r: r * 4, c: '#ffd34d', a: 0.55, star: true });
    glows.push({ x: cx, y: base - h * 0.45, r: h * 0.7, c: '#ffb347', a: 0.28 });
    return { tipY, r };
  };

  // Street lanterns.
  const lantern = (x: number, g: number, h: number) => {
    for (let y = g - h; y < g; y++) put(x, y, NX.post);
    put(x - 1, g - 1, NX.post);
    put(x + 1, g - 1, NX.post);
    const w = Math.max(2, Math.round(h * 0.08));
    for (let y = g - h - w * 2; y < g - h; y++) for (let k = -w; k <= w; k++) put(x + k, y, Math.abs(k) === w ? NX.post : NX.lamp);
    for (let k = -w - 1; k <= w + 1; k++) put(x + k, g - h - w * 2 - 1, NX.snow);
    glows.push({ x, y: g - h - w, r: h * 0.45, c: '#ffc861', a: 0.5, lamp: true });
  };

  // Snowy branches reaching in from the top corners, strung with fairy lights.
  const branch = (x: number, y: number, ang: number, len: number, th: number, depth: number): void => {
    let px = x;
    let py = y;
    for (let i = 0; i < len; i++) {
      ang += (H(Math.round(px), Math.round(py)) - 0.5) * 0.25;
      px += Math.cos(ang);
      py += Math.sin(ang) * 0.9 + 0.12;
      // Branches stay in the top corners, clear of the tree's star.
      if (py > PH * 0.26) break;
      const t = Math.max(1, th * (1 - i / len));
      for (let k = -t / 2; k <= t / 2; k++) put(px, py + k, NX.branch);
      put(px, py - t / 2 - 1, NX.snow);
      if (H(i, depth + Math.round(x)) < 0.3) put(px, py - t / 2 - 2, NX.snowShade);
      if (i % 3 === 0) lights.push({ x: px, y: py + t / 2 + 1, c: '#ffe9a8', ph: H(i, Math.round(px)) * 6, fairy: true });
      if (depth < 2 && i > len * 0.25 && H(i, depth * 31 + Math.round(x)) < 0.05) branch(px, py, ang + (H(i, 5) < 0.5 ? -0.6 : 0.6), len * 0.45, t * 0.7, depth + 1);
    }
  };

  // Warm light spilling onto the snow, dithered so it reads as pixel art.
  const pool = (cx: number, cy: number, rx: number, ry: number, a: number) => {
    const warm = nxHex('#ffc77a');
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        if (y < ground(x)) continue;
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (d >= 1) continue;
        const v = Math.round(Math.pow(1 - d, 0.8) * a * 8 + nxB(x, y) - 0.5) / 8;
        if (v > 0) put(x, y, warm, v);
      }
    }
  };
  const gl = (x: number) => Math.round(ground(x));
  if (wide) {
    pool(PW * 0.28, gl(PW * 0.28) + PH * 0.04, PW * 0.08, PH * 0.06, 0.8);
    pool(PW * 0.56, gl(PW * 0.56) + PH * 0.035, PW * 0.07, PH * 0.05, 0.75);
    pool(PW * 0.85, gl(PW * 0.85) + PH * 0.04, PW * 0.14, PH * 0.08, 0.7);
    pool(PW * 0.09, gl(PW * 0.09) + PH * 0.04, PW * 0.09, PH * 0.05, 0.45);
    pool(PW * 0.68, gl(PW * 0.68) + PH * 0.04, PW * 0.08, PH * 0.05, 0.45);
    house(Math.round(PW * 0.03), Math.round(Math.min(PW * 0.11, PH * 0.55)), Math.round(PH * 0.16));
    house(Math.round(PW * 0.16), Math.round(Math.min(PW * 0.09, PH * 0.55)), Math.round(PH * 0.12));
    house(Math.round(PW * 0.62), Math.round(Math.min(PW * 0.11, PH * 0.55)), Math.round(PH * 0.15));
    lantern(Math.round(PW * 0.28), gl(PW * 0.28), Math.round(PH * 0.2));
    lantern(Math.round(PW * 0.56), gl(PW * 0.56), Math.round(PH * 0.17));
    const tr = tree(PW * 0.85, gl(PW * 0.85) + 2, PH * 0.5);
    branch(-2, PH * 0.02, 0.35, PW * 0.32, Math.max(3, PH * 0.025), 0);
    branch(-2, PH * 0.12, 0.15, PW * 0.22, Math.max(2, PH * 0.018), 1);
    branch(PW + 2, PH * 0.02, Math.PI - 0.25, PW * 0.2, Math.max(3, PH * 0.022), 0);
    return { img, lights, glows, star: tr };
  }
  pool(PW * 0.72, gl(PW * 0.72) + PH * 0.03, PW * 0.3, PH * 0.05, 0.7);
  pool(PW * 0.42, gl(PW * 0.42) + PH * 0.03, PW * 0.18, PH * 0.04, 0.7);
  house(Math.round(PW * 0.04), Math.round(Math.min(PW * 0.3, PH * 0.55)), Math.round(PH * 0.11));
  lantern(Math.round(PW * 0.42), gl(PW * 0.42), Math.round(PH * 0.14));
  const tr = tree(PW * 0.72, gl(PW * 0.72) + 2, PH * 0.38);
  branch(-2, PH * 0.02, 0.45, PW * 0.5, Math.max(2, PH * 0.015), 1);
  return { img, lights, glows, star: tr };
}

/** A pixel buffer (RGBA) as one SVG path per color, merging horizontal runs. */
function nxPaths(img: Float32Array, PW: number, PH: number, P: number) {
  const byColor = new Map<string, string[]>()
  const q = (v: number) => Math.min(255, Math.round(v / 3) * 3)
  const hex = (i: number) => '#' + [img[i]!, img[i + 1]!, img[i + 2]!].map(v => q(v).toString(16).padStart(2, '0')).join('')
  for (let y = 0; y < PH; y++) {
    let x = 0
    while (x < PW) {
      const c = hex((y * PW + x) * 4)
      let e = x + 1
      while (e < PW && hex((y * PW + e) * 4) === c) e++
      if (!byColor.has(c)) byColor.set(c, [])
      byColor.get(c)!.push(`M${x * P} ${y * P}h${(e - x) * P}v${P}h-${(e - x) * P}z`)
      x = e
    }
  }
  let out = ''
  for (const [c, d] of byColor) out += `<path fill="${c}" d="${d.join('')}"/>`
  return out
}

function noel(sc: Scene) {
  const P = sc.H < 200 ? 4 : sc.W < 200 ? 2 : 5
  const PW = Math.ceil(sc.W / P)
  const PH = Math.ceil(sc.H / P)
  const art = nxPaint(PW, PH, sc.int(1, 9999), PW >= 180 || sc.H < 200)
  sc.add(`<g shape-rendering="crispEdges">${nxPaths(art.img, PW, PH, P)}</g>`)

  // Warm light from windows, lanterns, the star and around the tree.
  for (const g of art.glows) {
    const tw = g.lamp ? twinkle(3.1, g.x % 3, 0.8) : g.star ? twinkle(2.4, 0, 0.65) : twinkle(4.2, g.y % 4, 0.85)
    sc.add(sc.glow((g.x + 0.5) * P, (g.y + 0.5) * P, g.r * P, g.c, g.a, tw))
  }

  // Bulbs twinkle in three groups, each on its own beat.
  const groups: string[][] = [[], [], []]
  art.lights.forEach((l, i) => {
    const d = `M${Math.round(l.x) * P} ${Math.round(l.y) * P}h${P}v${P}h-${P}z`
    groups[i % 3]!.push(`<path fill="${l.c}" d="${d}"/>`)
  })
  groups.forEach((g, i) => sc.add(`<g shape-rendering="crispEdges">${twinkle(1.6 + i * 0.7, i * 0.5, 0.25)}${g.join('')}</g>`))

  // Snow falling in two layers: a tile of flakes repeated twice, sliding down forever.
  for (const [count, size, secs, op] of [
    [Math.round((PW * PH) / 260), 1, 14, 0.6],
    [Math.round((PW * PH) / 700), 2, 8, 0.95],
  ] as [number, number, number, number][]) {
    let d = ''
    for (let i = 0; i < count; i++) {
      const x = Math.floor(sc.rand() * PW) * P
      const y = Math.floor(sc.rand() * PH) * P
      d += `M${x} ${y}h${size * P}v${size * P}h-${size * P}zM${x} ${y - sc.H}h${size * P}v${size * P}h-${size * P}z`
    }
    sc.add(
      `<g opacity="${op}" shape-rendering="crispEdges"><animateTransform attributeName="transform" type="translate" values="0 0;${r1(P * 6)} ${sc.H}" dur="${secs}s" repeatCount="indefinite"/><path fill="#ffffff" d="${d}"/></g>`,
    )
  }
}

const BUILDERS: Record<string, [glyphs: string, draw: (sc: Scene) => void]> = {
  vn: [':.;', vn],
  sakura: ['*+:.o~°', sakura],
  galaxy: ['·*+°~%#@', galaxy],
  hoian: ['*+:.', hoian],
  noel: ['*+.', noel],
}

const SIZES: Record<Layout, [w: number, h: number, cell: number]> = {
  band: [1200, 132, 12],
  side: [420, 900, 12],
  thumb: [168, 96, 6],
}

const cache = new Map<string, string>()

/** The SVG document for a theme in one of the three layouts; memoized. */
export function scene(themeId: string, layout: Layout): string {
  const key = `${themeId}:${layout}`
  const hit = cache.get(key)
  if (hit) return hit
  const b = BUILDERS[themeId]
  const t = byId(themeId)
  if (!b || !t) return ''
  const [w, h, cell] = SIZES[layout]
  let seed = 7
  for (const ch of key) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619)
  const sc = new Scene(w, h, cell, seed, b[0])
  b[1](sc)
  const svg = sc.render(`${t.name}: ${t.desc}`)
  cache.set(key, svg)
  return svg
}
