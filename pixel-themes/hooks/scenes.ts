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
  { id: 'tet', name: 'Tết Việt Nam', desc: 'nồi bánh chưng, bếp lửa hồng, pháo hoa giao thừa', dark: true, alias: ['tet', 'xuan', 'tet ta', 'banh chung', 'phao hoa', 'giao thua', 'mai dao', 'lunar new year', 'new year'], accent: '#dc2626', bubble: '#dc262622' },
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

function tet(sc: Scene) {
  const c = sc.cell
  // Spring midnight sky fading to warm earth at hearth base
  sc.vgrad(['#020617', '#081226', '#111e38', '#1a1816'])

  // Distant subtle stars in the clear spring night
  const starCount = Math.max(16, Math.min(45, Math.round((sc.cols * sc.rows) / 110)))
  for (let k = 0; k < starCount; k++) {
    const sx = r1(sc.rnd(0, sc.W))
    const sy = r1(sc.rnd(0, sc.H * 0.55))
    const dur = r1(sc.rnd(2.0, 4.5))
    const begin = r1(sc.rnd(0, 4.5))
    const ch = sc.pick(['.', '+', '*', '·'])
    sc.add(
      `<g opacity="0.75"><animate attributeName="opacity" values="0.2;1.0;0.2" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>` +
        `<text fill="#fef08a" x="${sx}" y="${sy}">${ch}</text>` +
      `</g>`
    )
  }

  // Grand Fireworks in the Sky (3 distinct bursts)
  const fwData = [
    { x: sc.W * 0.68, y: sc.H * 0.22, r: Math.min(sc.W, sc.H) * 0.18, col1: '#ef4444', col2: '#fde047', col3: '#fbbf24', dur: 3.2, begin: 0 },
    { x: sc.W * 0.38, y: sc.H * 0.16, r: Math.min(sc.W, sc.H) * 0.15, col1: '#10b981', col2: '#38bdf8', col3: '#6ee7b7', dur: 3.6, begin: 1.2 },
    { x: sc.W * 0.84, y: sc.H * 0.32, r: Math.min(sc.W, sc.H) * 0.14, col1: '#ec4899', col2: '#fef08a', col3: '#f472b6', dur: 3.4, begin: 2.3 },
  ]

  for (const fw of fwData) {
    const fx = r1(fw.x)
    const fy = r1(fw.y)
    const fr = r1(Math.max(c * 2.5, fw.r))
    const dur = r1(fw.dur)
    const begin = r1(fw.begin)

    // Flash glow on explosion
    sc.add(sc.glow(fx, fy, fr * 1.5, fw.col1, 0.35, `<animate attributeName="opacity" values="0;0.85;0.2;0" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>`))

    // Radiating firework sparks (12 rays)
    let sparksMarkup = `<g opacity="0.9">` +
      `<animate attributeName="opacity" values="0;0.1;1.0;0.8;0.2;0" keyTimes="0;0.1;0.25;0.6;0.85;1" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>` +
      `<animateTransform attributeName="transform" type="translate" values="${fx} ${fy}; ${fx} ${r1(fy + fr * 0.3)}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>`

    const rays = 12
    for (let i = 0; i < rays; i++) {
      const ang = (i / rays) * Math.PI * 2
      const cosA = Math.cos(ang)
      const sinA = Math.sin(ang)
      const dist1 = r1(fr * 0.65)
      const dist2 = r1(fr * 1.05)
      const x1 = r1(cosA * dist1)
      const y1 = r1(sinA * dist1)
      const x2 = r1(cosA * dist2)
      const y2 = r1(sinA * dist2)
      const col = i % 2 === 0 ? fw.col1 : fw.col2
      sparksMarkup += `<circle cx="${x1}" cy="${y1}" r="${r1(c * 0.28)}" fill="${col}"/>`
      sparksMarkup += `<circle cx="${x2}" cy="${y2}" r="${r1(c * 0.22)}" fill="${fw.col3}"/>`
      sparksMarkup += `<text fill="${fw.col2}" x="${r1(x2 * 0.8)}" y="${r1(y2 * 0.8)}">*</text>`
    }
    sparksMarkup += `</g>`
    sc.add(sparksMarkup)
  }

  // Spring Branch (Mai & Đào) + Red Lantern at top right
  const bx = r1(Math.max(sc.W * 0.55, sc.W - Math.min(sc.W * 0.4, 320)))
  const branchW = r1(sc.W - bx)

  // Branch stem
  sc.add(
    `<path d="M ${r1(bx)} 0 Q ${r1(bx + branchW * 0.4)} ${r1(c * 2)} ${r1(sc.W)} ${r1(c * 0.8)}" fill="none" stroke="#451a03" stroke-width="${r1(c * 0.7)}" stroke-linecap="round"/>` +
    `<path d="M ${r1(bx + branchW * 0.3)} ${r1(c * 1.6)} Q ${r1(bx + branchW * 0.2)} ${r1(c * 3.5)} ${r1(bx + branchW * 0.15)} ${r1(c * 4.5)}" fill="none" stroke="#451a03" stroke-width="${r1(c * 0.45)}" stroke-linecap="round"/>`
  )

  // Red Lantern hanging from branch
  const lx = r1(bx + branchW * 0.15)
  const ly = r1(c * 4.5)
  const lSize = r1(Math.max(c * 1.2, 16))
  sc.add(sc.glow(lx, ly + lSize, lSize * 2.2, '#ef4444', 0.4, `<animate attributeName="opacity" values="0.7;1.0;0.7" dur="2s" repeatCount="indefinite"/>`))
  sc.add(
    `<g>` +
      `<animateTransform attributeName="transform" type="rotate" values="-3 ${lx} ${ly}; 3 ${lx} ${ly}; -3 ${lx} ${ly}" dur="3.5s" repeatCount="indefinite"/>` +
      `<line x1="${lx}" y1="${ly}" x2="${lx}" y2="${r1(ly + lSize * 0.4)}" stroke="#7f1d1d" stroke-width="${r1(c * 0.2)}"/>` +
      `<rect x="${r1(lx - lSize * 0.5)}" y="${r1(ly + lSize * 0.4)}" width="${lSize}" height="${r1(lSize * 1.2)}" rx="${r1(lSize * 0.3)}" fill="#dc2626" stroke="#ef4444" stroke-width="${r1(c * 0.2)}"/>` +
      `<ellipse cx="${lx}" cy="${r1(ly + lSize)}" rx="${r1(lSize * 0.28)}" ry="${r1(lSize * 0.55)}" fill="none" stroke="#fbbf24" stroke-width="${r1(c * 0.18)}"/>` +
      `<line x1="${lx}" y1="${r1(ly + lSize * 1.6)}" x2="${lx}" y2="${r1(ly + lSize * 2.2)}" stroke="#f59e0b" stroke-width="${r1(c * 0.25)}"/>` +
    `</g>`
  )

  // Apricot & Peach flowers along branch
  const flowers = [
    { x: bx + branchW * 0.1, y: c * 1.8, col: '#fde047', ch: '°' },
    { x: bx + branchW * 0.25, y: c * 2.4, col: '#fbbf24', ch: '*' },
    { x: bx + branchW * 0.4, y: c * 1.9, col: '#f472b6', ch: '+' },
    { x: bx + branchW * 0.55, y: c * 2.6, col: '#fde047', ch: '*' },
    { x: bx + branchW * 0.7, y: c * 1.4, col: '#fb7185', ch: '°' },
    { x: bx + branchW * 0.85, y: c * 1.2, col: '#fde047', ch: '*' },
  ]
  for (const f of flowers) {
    sc.add(`<circle cx="${r1(f.x)}" cy="${r1(f.y)}" r="${r1(c * 0.5)}" fill="${f.col}"/>`)
    sc.add(`<text fill="#ffffff" x="${r1(f.x)}" y="${r1(f.y + c * 0.3)}" text-anchor="middle" font-size="${r1(c * 0.8)}">${f.ch}</text>`)
  }

  // Falling blossom petals
  for (let m = 0; m < 5; m++) {
    const px0 = r1(sc.rnd(sc.W * 0.4, sc.W * 0.95))
    const py0 = r1(sc.rnd(c * 2, sc.H * 0.3))
    const dur = r1(sc.rnd(5.0, 9.0))
    const begin = r1(sc.rnd(0, 9.0))
    const col = m % 2 === 0 ? '#fde047' : '#f472b6'
    sc.add(
      `<g opacity="0.8">` +
        `<animateTransform attributeName="transform" type="translate" from="${px0} ${py0}" to="${r1(px0 - sc.W * 0.35)} ${r1(py0 + sc.H * 0.65)}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>` +
        `<text fill="${col}" x="0" y="0">°</text>` +
      `</g>`
    )
  }

  // Hearth & Bánh Chưng Pot (Bottom)
  const potX = r1(sc.W * (sc.cols < 45 ? 0.5 : 0.32))
  const potY = r1(sc.H * 0.76)
  const potW = r1(Math.max(c * 4, Math.min(sc.W, sc.H) * 0.16))
  const potH = r1(potW * 0.85)

  // Warm hearth glow
  sc.add(sc.glow(potX, potY + potH * 0.4, potW * 2.8, '#f97316', 0.46, `<animate attributeName="opacity" values="0.75;1.0;0.8;0.95;0.75" dur="0.8s" repeatCount="indefinite"/>`))
  sc.add(sc.glow(potX, potY + potH * 0.4, potW * 1.5, '#ef4444', 0.52))

  // Firewood logs
  sc.add(
    `<rect x="${r1(potX - potW * 0.75)}" y="${r1(potY + potH * 0.42)}" width="${r1(potW * 1.5)}" height="${r1(c * 0.8)}" rx="${r1(c * 0.3)}" fill="#78350f"/>` +
    `<rect x="${r1(potX - potW * 0.6)}" y="${r1(potY + potH * 0.65)}" width="${r1(potW * 1.2)}" height="${r1(c * 0.75)}" rx="${r1(c * 0.25)}" fill="#451a03"/>`
  )

  // Flickering Flames under the Pot
  sc.add(
    `<g>` +
      `<animate attributeName="opacity" values="0.75;1;0.82;0.95;0.75" dur="0.45s" repeatCount="indefinite"/>` +
      `<path d="M ${r1(potX - potW * 0.55)} ${r1(potY + potH * 0.45)} Q ${r1(potX - potW * 0.25)} ${r1(potY + potH * 0.05)} ${potX} ${r1(potY + potH * 0.45)} Q ${r1(potX + potW * 0.3)} ${r1(potY + potH * 0.1)} ${r1(potX + potW * 0.55)} ${r1(potY + potH * 0.45)} Z" fill="#ef4444"/>` +
      `<path d="M ${r1(potX - potW * 0.38)} ${r1(potY + potH * 0.45)} Q ${r1(potX - potW * 0.12)} ${r1(potY + potH * 0.18)} ${potX} ${r1(potY + potH * 0.45)} Q ${r1(potX + potW * 0.18)} ${r1(potY + potH * 0.2)} ${r1(potX + potW * 0.38)} ${r1(potY + potH * 0.45)} Z" fill="#f97316"/>` +
      `<path d="M ${r1(potX - potW * 0.22)} ${r1(potY + potH * 0.45)} Q ${potX} ${r1(potY + potH * 0.26)} ${r1(potX + potW * 0.22)} ${r1(potY + potH * 0.45)} Z" fill="#fef08a"/>` +
    `</g>`
  )

  // Bánh Chưng Pot (Metallic container with lid & handles)
  sc.add(
    `<g>` +
      `<rect x="${r1(potX - potW * 0.5)}" y="${r1(potY - potH * 0.5)}" width="${potW}" height="${potH}" rx="${r1(c * 0.4)}" fill="#334155" stroke="#64748b" stroke-width="${r1(c * 0.35)}"/>` +
      `<line x1="${r1(potX - potW * 0.48)}" y1="${potY}" x2="${r1(potX + potW * 0.48)}" y2="${potY}" stroke="#475569" stroke-width="${r1(c * 0.25)}"/>` +
      `<ellipse cx="${potX}" cy="${r1(potY - potH * 0.5)}" rx="${r1(potW * 0.52)}" ry="${r1(potH * 0.16)}" fill="#475569" stroke="#94a3b8" stroke-width="${r1(c * 0.3)}"/>` +
      `<path d="M ${r1(potX - potW * 0.5)} ${r1(potY - potH * 0.52)} L ${r1(potX + potW * 0.5)} ${r1(potY - potH * 0.57)}" stroke="#cbd5e1" stroke-width="${r1(c * 0.4)}" stroke-linecap="round"/>` +
      `<path d="M ${r1(potX - potW * 0.52)} ${r1(potY - potH * 0.12)} Q ${r1(potX - potW * 0.72)} ${potY} ${r1(potX - potW * 0.52)} ${r1(potY + potH * 0.12)}" fill="none" stroke="#94a3b8" stroke-width="${r1(c * 0.3)}"/>` +
      `<path d="M ${r1(potX + potW * 0.52)} ${r1(potY - potH * 0.12)} Q ${r1(potX + potW * 0.72)} ${potY} ${r1(potX + potW * 0.52)} ${r1(potY + potH * 0.12)}" fill="none" stroke="#94a3b8" stroke-width="${r1(c * 0.3)}"/>` +
    `</g>`
  )

  // Rising Steam from the Pot
  for (let s = 0; s < 3; s++) {
    const sx0 = r1(potX + (s - 1) * c * 1.5)
    const sy0 = r1(potY - potH * 0.55)
    const dur = r1(2.2 + s * 0.5)
    const begin = r1(s * 0.8)
    sc.add(
      `<g opacity="0.7">` +
        `<animateTransform attributeName="transform" type="translate" from="0 0" to="${r1((s - 1) * c * 2)} -${r1(potH * 0.8)}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>` +
        `<animate attributeName="opacity" values="0.7;0.8;0.3;0" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>` +
        `<text fill="#e2e8f0" x="${sx0}" y="${sy0}">~</text>` +
      `</g>`
    )
  }

  // Rising Embers popping from the fire
  for (let e = 0; e < 6; e++) {
    const ex0 = r1(potX + sc.rnd(-potW * 0.4, potW * 0.4))
    const ey0 = r1(potY + potH * 0.4)
    const driftX = r1(sc.rnd(-c * 3, c * 3))
    const driftY = r1(sc.rnd(c * 4, c * 9))
    const dur = r1(sc.rnd(1.5, 3.0))
    const begin = r1(sc.rnd(0, 3.0))
    const col = e % 2 === 0 ? '#fbbf24' : '#f97316'
    sc.add(
      `<g opacity="0.85">` +
        `<animateTransform attributeName="transform" type="translate" from="0 0" to="${driftX} -${driftY}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>` +
        `<animate attributeName="opacity" values="1.0;0.8;0" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>` +
        `<text fill="${col}" x="${ex0}" y="${ey0}">·</text>` +
      `</g>`
    )
  }
}

/* ----------------------------------------------------------------- entry */

const BUILDERS: Record<string, [glyphs: string, draw: (sc: Scene) => void]> = {
  vn: [':.;', vn],
  sakura: ['*+:.o~°', sakura],
  galaxy: ['·*+°~%#@', galaxy],
  hoian: ['*+:.', hoian],
  tet: ['*+~o:.•#°', tet],
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
