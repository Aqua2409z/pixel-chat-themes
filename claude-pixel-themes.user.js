// ==UserScript==
// @name         Pixel Chat Themes
// @name:vi      Pixel Chat Themes – hình nền pixel cho claude.ai
// @namespace    https://github.com/aqua2409z/pixel-chat-themes
// @version      2.1.0
// @description  Animated pixel/ASCII wallpapers behind the claude.ai chat. Type /theme to pick one.
// @description:vi Hình nền pixel/ASCII chuyển động phía sau khung chat claude.ai. Gõ /theme để chọn.
// @author       aqua2409z
// @license      MIT
// @homepageURL  https://github.com/aqua2409z/pixel-chat-themes
// @supportURL   https://github.com/aqua2409z/pixel-chat-themes/issues
// @match        https://claude.ai/*
// @grant        none
// @run-at       document-idle
// @inject-into  content
// @noframes
// @updateURL    https://raw.githubusercontent.com/aqua2409z/pixel-chat-themes/main/claude-pixel-themes.user.js
// @downloadURL  https://raw.githubusercontent.com/aqua2409z/pixel-chat-themes/main/claude-pixel-themes.user.js
// ==/UserScript==

/*
 * How it works
 *  1. A full-screen <canvas> sits behind the page (z-index -1) and draws a scene
 *     as a grid of small tiles, each holding one ASCII glyph – the "pixel" look.
 *  2. A scanner finds the page's opaque backgrounds: large ones become
 *     transparent, smaller panels (sidebar, composer, bubbles, menus) become
 *     frosted glass. It only looks at computed styles, not class names, so it
 *     keeps working when claude.ai changes its markup.
 *  3. Typing /theme in the chat box (or the floating button, or Alt+T) opens a
 *     picker. Settings are kept in localStorage.
 *
 * No innerHTML and no inline <style> (CSSOM only), so it also works on pages
 * with a strict Content-Security-Policy / Trusted Types.
 */
(function () {
  'use strict';
  // A clear line in the console, so a run from DevTools shows it worked.
  const say = (text) => console.info('%c' + text, 'color:#2f8a58;font-weight:bold');
  if (window.__pixelThemes) {
    say('Pixel Themes đang chạy rồi. Bấm Alt+T (hoặc nút ô vuông màu ở cạnh phải) để chọn theme.');
    return;
  }

  /* ------------------------------------------------------------------ utils */

  const rnd = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  // Stable pseudo-random number in [0, 1) for integer coordinates.
  function hash(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function vgrad(c, w, h, stops) {
    const g = c.createLinearGradient(0, 0, 0, h);
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }

  function rglow(c, x, y, r, hex, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(hex, a));
    g.addColorStop(1, rgba(hex, 0));
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // A sprite is ASCII art: every non-space char is a key into a palette of
  // [tileColor, glyphColor, fixedGlyph?, alpha?].
  function sprite(rows, pal) {
    const w = Math.max(...rows.map((r) => r.length));
    return { rows: rows.map((r) => r.padEnd(w)), w, h: rows.length, pal };
  }

  const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();

  /* ------------------------------------------------------------------ world */

  const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

  class World {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.tiles = new Map();
      this.glows = new Map();
      this.s = {};
      this.t = 0;
      this.veil = 0;
      this.veilColor = '#ffffff';
    }

    resize(w, h, cell, dpr) {
      this.w = w;
      this.h = h;
      this.cell = cell;
      this.dpr = dpr;
      this.cv.width = Math.max(1, Math.round(w * dpr));
      this.cv.height = Math.max(1, Math.round(h * dpr));
      this.cols = Math.ceil(w / cell);
      this.rows = Math.ceil(h / cell);
      this.glyphsOn = cell >= 8;
      this.tiles.clear();
      this.under = this.over = null;
    }

    setTheme(th) {
      this.th = th;
      this.s = {};
      this.t = 0;
      this.tiles.clear();
      this.under = this.over = null;
      th.init(this);
    }

    // Static parts of a scene are drawn once into an offscreen layer.
    layer(fn) {
      const c = document.createElement('canvas');
      c.width = this.cv.width;
      c.height = this.cv.height;
      const x = c.getContext('2d');
      x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const prev = this.ctx;
      this.ctx = x;
      try {
        fn(x);
      } finally {
        this.ctx = prev;
      }
      return c;
    }

    draw(dt) {
      const th = this.th;
      const ctx = this.ctx;
      if (!th) return;
      this.t += dt;
      if (!this.under) {
        this.under = this.layer((c) => {
          th.bg(c, this.w, this.h, this);
          if (th.under) th.under(this);
        });
      }
      if (th.over && !this.over) this.over = this.layer(() => th.over(this));

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.under, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      th.frame(this, dt);
      if (this.over) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.over, 0, 0);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
      if (this.veil > 0) {
        ctx.globalAlpha = this.veil;
        ctx.fillStyle = this.veilColor;
        ctx.fillRect(0, 0, this.w, this.h);
        ctx.globalAlpha = 1;
      }
    }

    // One tile = rounded square + glyph, rendered once and reused.
    img(bg, fg, ch) {
      const key = bg + '|' + fg + '|' + ch;
      let c = this.tiles.get(key);
      if (c) return c;
      if (this.tiles.size > 900) this.tiles.clear();
      const s = this.cell;
      const px = Math.max(1, Math.ceil(s * this.dpr));
      c = document.createElement('canvas');
      c.width = c.height = px;
      const x = c.getContext('2d');
      x.scale(px / s, px / s);
      if (bg) {
        const gap = s > 6 ? Math.max(1, s * 0.09) : 0.5;
        const r = s > 6 ? s * 0.16 : 0;
        x.fillStyle = bg;
        if (r && x.roundRect) {
          x.beginPath();
          x.roundRect(gap / 2, gap / 2, s - gap, s - gap, r);
          x.fill();
        } else {
          x.fillRect(gap / 2, gap / 2, s - gap, s - gap);
        }
      }
      if (ch && fg && this.glyphsOn) {
        x.fillStyle = fg;
        x.font = `600 ${Math.round(s * 0.7)}px ${FONT}`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText(ch, s / 2, s / 2 + s * 0.05);
      } else if (ch && fg && !bg) {
        const d = Math.max(1, s * 0.4);
        x.fillStyle = fg;
        x.fillRect((s - d) / 2, (s - d) / 2, d, d);
      }
      this.tiles.set(key, c);
      return c;
    }

    tile(x, y, bg, fg, ch, a = 1) {
      x = Math.round(x);
      y = Math.round(y);
      if (a <= 0.01 || x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
      const ctx = this.ctx;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(this.img(bg, fg, ch), x * this.cell, y * this.cell, this.cell, this.cell);
      ctx.globalAlpha = 1;
    }

    glyph(x, y, ch, fg, a) {
      this.tile(x, y, null, fg, ch, a);
    }

    ch(i, j, seed) {
      const g = this.th.glyphs;
      return g[(hash(i, j, seed) * g.length) | 0];
    }

    sprite(sp, x, y, o = {}) {
      const X = Math.round(x);
      const Y = Math.round(y);
      const pal = o.pal || sp.pal;
      const a = o.a == null ? 1 : o.a;
      const seed = o.seed || 0;
      for (let j = 0; j < sp.h; j++) {
        const row = sp.rows[j];
        for (let i = 0; i < sp.w; i++) {
          const p = pal[row[i]];
          if (!p) continue;
          const gx = X + (o.flip ? sp.w - 1 - i : i);
          this.tile(gx, Y + j, p[0], p[1], p[2] != null ? p[2] : this.ch(i, j, seed), a * (p[3] == null ? 1 : p[3]));
        }
      }
    }

    glow(x, y, r, hex, a) {
      if (a <= 0.01) return;
      let g = this.glows.get(hex);
      if (!g) {
        g = document.createElement('canvas');
        g.width = g.height = 64;
        rglow(g.getContext('2d'), 32, 32, 32, hex, 1);
        this.glows.set(hex, g);
      }
      const c = this.cell;
      const R = r * c;
      this.ctx.globalAlpha = clamp(a, 0, 1);
      this.ctx.drawImage(g, (x + 0.5) * c - R, (y + 0.5) * c - R, R * 2, R * 2);
      this.ctx.globalAlpha = 1;
    }

    dot(x, y, color, a, size = 0.3) {
      if (a <= 0.01) return;
      const c = this.cell;
      const d = Math.max(1, c * size);
      this.ctx.globalAlpha = clamp(a, 0, 1);
      this.ctx.fillStyle = color;
      this.ctx.fillRect(Math.round(x) * c + (c - d) / 2, Math.round(y) * c + (c - d) / 2, d, d);
      this.ctx.globalAlpha = 1;
    }
  }

  /* ---------------------------------------------------------------- sprites */

  const CLOUD_DAY = { c: ['#ffffff', '#a9c1d6'], e: ['#eef6fd', '#c3d5e5'] };

  // Flat-bottomed cloud made of a few overlapping ellipses.
  function cloudRows(w, h) {
    const E = [{ x: w / 2, y: h - h * 0.32, rx: w / 2, ry: h * 0.34 }];
    for (let k = rint(2, 4); k > 0; k--) {
      const rx = rnd(w * 0.16, w * 0.3);
      E.push({ x: rnd(rx * 0.9, w - rx * 0.9), y: h - h * 0.4 - rnd(0, h * 0.2), rx, ry: Math.min(rx * 0.8, h * 0.6) });
    }
    const inside = (i, j) => E.some((e) => ((i + 0.5 - e.x) / e.rx) ** 2 + ((j + 0.5 - e.y) / e.ry) ** 2 <= 1);
    const rows = [];
    for (let j = 0; j < h; j++) {
      let r = '';
      for (let i = 0; i < w; i++) {
        if (!inside(i, j)) r += ' ';
        else r += !inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1) ? 'e' : 'c';
      }
      rows.push(r);
    }
    return rows;
  }

  function cloud(w, anywhere, pal) {
    const z = Math.random();
    const cw = Math.round(clamp(w.cols * 0.12, 7, 16) + z * clamp(w.cols * 0.14, 4, 16));
    const ch = Math.max(3, Math.round(cw * rnd(0.3, 0.42)));
    return {
      sp: sprite(cloudRows(cw, ch), pal),
      z,
      x: anywhere ? rnd(-cw, w.cols) : -cw - rnd(0, w.cols * 0.3),
      y: rnd(-1, w.rows * 0.85 - ch),
      v: 0.35 + z * 1.2,
      a: 0.55 + z * 0.45,
      seed: rint(1, 1e6),
    };
  }

  /* ----------------------------------------------------------------- themes */

  const THEMES = [];

  // Vietnam's flag: 2:3, red field, a yellow five-pointed star in the middle
  // whose centre-to-tip radius is 1/5 of the flag's length, one point up.
  const FLAG_RED = [
    ['#9e1712', '#7f120e'],
    ['#b31b15', '#921611'],
    ['#c72019', '#a51a14'],
    ['#da251d', '#b51f18'],
    ['#e8382c', '#c52c22'],
    ['#f2503f', '#d23e31'],
    ['#fa6a55', '#dc5545'],
  ];
  const FLAG_YELLOW = [
    ['#c7b000', '#9c8900'],
    ['#dac400', '#ac9800'],
    ['#ecd800', '#bda800'],
    ['#ffea00', '#cfb800'],
    ['#fff23d', '#dcc81a'],
    ['#fff76b', '#e4d244'],
    ['#fffa99', '#ebdc6e'],
  ];

  function inStar(x, y, cx, cy, R) {
    const r = R * 0.381966;
    let inside = false;
    for (let k = 0, j = 9; k < 10; j = k++) {
      const ak = -Math.PI / 2 + (k * Math.PI) / 5;
      const aj = -Math.PI / 2 + (j * Math.PI) / 5;
      const rk = k % 2 ? r : R;
      const rj = j % 2 ? r : R;
      const xk = cx + Math.cos(ak) * rk;
      const yk = cy + Math.sin(ak) * rk;
      const xj = cx + Math.cos(aj) * rj;
      const yj = cy + Math.sin(aj) * rj;
      if (yk > y !== yj > y && x < ((xj - xk) * (y - yk)) / (yj - yk) + xk) inside = !inside;
    }
    return inside;
  }

  function flagGeo(w) {
    const horizon = Math.round(w.rows * 0.8);
    const top = Math.max(2, Math.round(w.rows * 0.12));
    // Phones get a bigger share of the width so the star stays readable.
    const narrow = w.cols < 60;
    const L = Math.round(clamp(Math.min(w.cols * (narrow ? 0.55 : 0.34), ((horizon - top - 3) * 3) / 2), 9, 48));
    const H = Math.round((L * 2) / 3);
    const px = Math.round(clamp(narrow ? w.cols - L - 3 : w.cols * 0.62, 2, w.cols - L - 2));
    return { horizon, top, L, H, px };
  }

  // Limestone karst towers (Ha Long style): steep sides, rounded tops.
  function karstHeights(cols, peaks) {
    const hs = new Array(cols).fill(0);
    for (const p of peaks) {
      for (let x = Math.floor(p.x - p.w * 1.3); x <= Math.ceil(p.x + p.w * 1.3); x++) {
        if (x < 0 || x >= cols) continue;
        // Lean: the left and right flanks fall at different rates.
        const dx = x + 0.5 - p.x;
        const d = Math.abs(dx) / (p.w * (dx < 0 ? 1 + p.lean : 1 - p.lean));
        if (d >= 1) continue;
        // Steep flanks, a broad rounded crown.
        hs[x] = Math.max(hs[x], Math.round(p.h * Math.pow(1 - Math.pow(d, 2.6), 0.55)));
      }
    }
    return hs;
  }

  THEMES.push({
    id: 'vn',
    name: 'Việt Nam',
    dark: false,
    veilScale: 0.5,
    alias: ['co', 'co do', 'co viet nam', 'co do sao vang', 'viet nam', 'vietnam', 'quoc ky', 'to quoc', 'flag'],
    glyphs: ':.;',
    bg(c, w, h, W) {
      const g = flagGeo(W);
      const hy = g.horizon * W.cell;
      const sky = c.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, '#4f9fe0');
      sky.addColorStop(0.55, '#9fd2f2');
      sky.addColorStop(1, '#ffe0b0');
      c.fillStyle = sky;
      c.fillRect(0, 0, w, hy);
      const sea = c.createLinearGradient(0, hy, 0, h);
      sea.addColorStop(0, '#6fb7cc');
      sea.addColorStop(1, '#2c7896');
      c.fillStyle = sea;
      c.fillRect(0, hy, w, h - hy);
      rglow(c, w * 0.82, hy, Math.max(w, h) * 0.45, '#ffd27a', 0.55);
    },
    init(w) {
      const s = w.s;
      const g = flagGeo(w);
      s.mask = [];
      for (let j = 0; j < g.H; j++) {
        const row = [];
        for (let i = 0; i < g.L; i++) {
          // Area coverage (6x6 samples per cell) keeps the thin star points from breaking up.
          let n = 0;
          for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) if (inStar(i + (a + 0.5) / 6, j + (b + 0.5) / 6, g.L / 2, g.H / 2, g.L / 5)) n++;
          row.push(n / 36 >= 0.22);
        }
        s.mask.push(row);
      }
      const cluster = (n, wMin, wMax, hMax) => {
        const out = [];
        for (let c = 0; c < n; c++) {
          const x = rnd(0, w.cols);
          const h = rnd(hMax * 0.55, hMax);
          const wd = rnd(wMin, wMax);
          out.push({ x, w: wd, h, lean: rnd(-0.25, 0.25) });
          if (Math.random() < 0.7) out.push({ x: x + wd * rnd(0.8, 1.3) * (Math.random() < 0.5 ? -1 : 1), w: wd * 0.7, h: h * rnd(0.45, 0.7), lean: rnd(-0.25, 0.25) });
        }
        return out;
      };
      s.far = cluster(Math.round(clamp(w.cols / 14, 2, 8)), 3, 6, Math.max(4, w.rows * 0.16));
      s.near = cluster(Math.round(clamp(w.cols / 22, 1, 5)), 3.5, 7, Math.max(5, w.rows * 0.24));
      s.clouds = Array.from({ length: Math.round(clamp(w.cols / 30, 2, 5)) }, () => {
        const c = cloud(w, true, CLOUD_DAY);
        c.y = rnd(-1, g.horizon * 0.45);
        c.v *= 0.5;
        return c;
      });
      s.birds = Array.from({ length: Math.round(clamp(w.cols / 14, 3, 9)) }, () => ({ x: rnd(0, w.cols), y: rnd(2, g.horizon * 0.5), v: rnd(0.8, 1.8), ph: rnd(0, 6) }));
      s.dust = Array.from({ length: Math.round(clamp(w.cols / 4, 6, 30)) }, () => ({ x: rnd(w.cols * 0.55, w.cols), y: rnd(0, g.horizon), ph: rnd(0, 6), v: rnd(0.1, 0.4) }));
    },
    under(w) {
      const s = w.s;
      const g = flagGeo(w);
      // Rising sun, half behind the mountains.
      const sx = Math.round(w.cols * 0.82);
      const sr = clamp(Math.round(w.rows * 0.07), 2, 5);
      for (let dy = -sr; dy <= 0; dy++) {
        for (let dx = -sr; dx <= sr; dx++) {
          if (Math.hypot(dx, dy) <= sr + 0.3) w.tile(sx + dx, g.horizon - 1 + dy, '#fff0b8', '#f5d27a', w.ch(dx, dy, 31));
        }
      }
      const far = karstHeights(w.cols, s.far);
      const near = karstHeights(w.cols, s.near);
      // Far towers fade into the morning haze; near ones are darker with green crowns.
      for (let x = 0; x < w.cols; x++) {
        for (let k = 0; k < far[x]; k++) w.tile(x, g.horizon - 1 - k, '#a9c4cf', '#97b5c2', w.ch(x, k, 32), 0.8);
      }
      for (let x = 0; x < w.cols; x++) {
        const hgt = near[x];
        for (let k = 0; k < hgt; k++) {
          const crown = k >= hgt - 2 && hgt > 2;
          w.tile(x, g.horizon - 1 - k, crown ? '#6f9e7c' : '#5b8b92', crown ? '#557f62' : '#46737a', w.ch(x, k, 33));
        }
      }
      // Reflections of the near towers on the water.
      for (let x = 0; x < w.cols; x++) {
        for (let k = 0; k < Math.min(near[x], w.rows - g.horizon) * 0.5; k++) w.tile(x, g.horizon + k, '#3f7f8f', null, '', 0.35 - k * 0.06);
      }
    },
    frame(w, dt) {
      const s = w.s;
      const g = flagGeo(w);
      const t = w.t;

      for (const c of s.clouds) {
        c.x += c.v * dt;
        if (c.x > w.cols + 1) c.x = -c.sp.w - rnd(0, 10);
        w.sprite(c.sp, c.x, c.y, { a: c.a * 0.9, seed: c.seed });
      }
      for (const d of s.dust) w.dot(d.x + Math.sin(t * 0.6 + d.ph), d.y - ((t * d.v) % g.horizon), '#fff4c8', 0.25 + 0.25 * Math.sin(t * 2 + d.ph), 0.22);
      for (const b of s.birds) {
        b.x -= b.v * dt;
        if (b.x < -2) {
          b.x = w.cols + rnd(1, 10);
          b.y = rnd(2, g.horizon * 0.5);
        }
        w.glyph(b.x, b.y + Math.sin(t * 1.3 + b.ph) * 0.6, Math.floor(t * 4 + b.ph) % 2 ? 'v' : '-', '#33475b', 0.85);
      }

      // Water: drifting ripples and the sun's glittering path.
      const tick = Math.floor(t * 4);
      const sx = Math.round(w.cols * 0.82);
      for (let y = g.horizon; y < w.rows; y++) {
        const d = y - g.horizon;
        const dir = y % 2 ? 1 : -1;
        for (let x = 0; x < w.cols; x++) {
          if (hash(Math.floor(x + t * 0.8 * dir), y, 41) < 0.08) w.glyph(x, y, '~', '#e6f6fb', 0.55);
        }
        const spread = 1 + d * 0.8;
        for (let x = Math.floor(sx - spread); x <= sx + spread; x++) {
          if (hash(x, y, tick) < 0.3) w.tile(x, y, '#fff0b8', '#f0d27a', '~', 0.65 - d * 0.03);
        }
      }

      // Flagpole with a gold finial and a stone base.
      for (let y = g.top - 1; y <= g.horizon + 1; y++) w.tile(g.px, y, '#ece6d8', '#bdb5a3', '|');
      w.tile(g.px, g.top - 2, '#ffd34d', '#c99a1c', 'o');
      for (let dx = -1; dx <= 1; dx++) w.tile(g.px + dx, g.horizon + 2, '#8d99a6', '#6d7884', '=');

      // The flag: each column rides a sine wave that grows from the pole to the
      // free end, snapped to whole cells; the slope picks one of seven shades.
      const A = Math.max(1, g.H * 0.14);
      const k = (Math.PI * 2.2) / g.L;
      for (let i = 0; i < g.L; i++) {
        const f = Math.pow((i + 1) / g.L, 0.8);
        const ph = i * k - t * 3.4;
        const dy = Math.round((Math.sin(ph) + 0.18 * Math.sin(ph * 2.1 + 1)) * A * f);
        const shade = clamp(Math.round(Math.cos(ph) * (0.6 + f) * 2), -3, 3) + 3;
        const x = g.px + 1 + i;
        for (let j = 0; j < g.H; j++) {
          const star = s.mask[j] && s.mask[j][i];
          const p = (star ? FLAG_YELLOW : FLAG_RED)[shade];
          w.tile(x, g.top + j + dy, p[0], p[1], star ? '*' : w.ch(i, j, 34));
        }
      }
    },
  });


  /* --- Sakura Breeze (Kyoto Spring, Mt. Fuji & Torii) --- */
  const TORII_GATE = sprite(
    [
      '  mmmmmmmmmmmmmm  ',
      ' mMMMMMMMMMMMMMMm ',
      '   r   r    r   r ',
      '   rrrrrrrrrrrrrr ',
      '   R            R ',
      '   R            R ',
      '   R            R ',
      '   R            R ',
      '  bbb          bbb',
    ],
    {
      m: ['#7f1d1d', '#450a0a', '='],
      M: ['#dc2626', '#991b1b', '#'],
      r: ['#ef4444', '#b91c1c', '-'],
      R: ['#dc2626', '#991b1b', '|'],
      b: ['#475569', '#334155', 'b'],
    },
  );

  const SAKURA_BRANCH_BIG = sprite(
    [
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
    ],
    {
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
    },
  );

  function fujiHeights(cols, fx, fw, fh) {
    const hs = new Array(cols).fill(0);
    const halfW = fw / 2;
    for (let x = Math.floor(fx - halfW); x <= Math.ceil(fx + halfW); x++) {
      if (x < 0 || x >= cols) continue;
      const u = Math.abs(x + 0.5 - fx) / halfW;
      if (u >= 1) continue;
      let h = fh * Math.pow(1 - Math.pow(u, 1.35), 1.75);
      if (u < 0.1) h *= 0.96;
      hs[x] = Math.round(h);
    }
    return hs;
  }

  function spawnSakuraPetal(w, randomY, fromBranch, isFar) {
    const C = w.cols;
    const R = w.rows;
    const bx = Math.max(0, C - SAKURA_BRANCH_BIG.w);
    const startX = fromBranch ? rnd(bx + 10, C) : rnd(-4, C + 4);
    const startY = fromBranch ? rnd(0, SAKURA_BRANCH_BIG.h) : randomY ? rnd(-5, R + 2) : rnd(-8, -1);
    const z = isFar ? rnd(0.4, 0.6) : rnd(0.8, 1.25);
    return {
      x: startX,
      y: startY,
      vx: rnd(0.8, 1.8) * z,
      vy: rnd(0.6, 1.5) * z,
      swayAmp: rnd(0.7, 2.2),
      swayFreq: rnd(1.2, 2.6),
      ph: rnd(0, Math.PI * 2),
      rot: rnd(0, 6.28),
      rotSpeed: rnd(-2.5, 2.5),
      ch: pick(['*', '+', '°', '.', 'o']),
      bg: isFar ? pick(['#fce7f3', '#fbcfe8', '#fda4af']) : pick(['#ffb7c5', '#fbcfe8', '#fda4af', '#fce7f3', '#f472b6']),
      fg: pick(['#ffffff', '#fff1f2', '#fce7f3']),
      a: isFar ? rnd(0.45, 0.7) : rnd(0.75, 0.98),
      z,
      isFar,
    };
  }

  THEMES.push({
    id: 'sakura',
    name: 'Sakura Breeze',
    dark: false,
    veilScale: 0.55,
    alias: ['sakura', 'hoa', 'anhdao', 'cherry', 'kyoto', 'japan', 'fuji', 'phu si', 'torii'],
    glyphs: '*+:.o~°',
    bg(c, w, h, W) {
      const hy = Math.round(W.rows * 0.76) * W.cell;
      // Spring morning sky with pastel twilight
      const sky = c.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, '#fce7f3');
      sky.addColorStop(0.4, '#fed7aa');
      sky.addColorStop(0.75, '#fef3c7');
      sky.addColorStop(1, '#ffedd5');
      c.fillStyle = sky;
      c.fillRect(0, 0, w, hy);

      // Lake reflection
      const lake = c.createLinearGradient(0, hy, 0, h);
      lake.addColorStop(0, '#fbcfe8');
      lake.addColorStop(0.2, '#93c5fd');
      lake.addColorStop(1, '#2563eb');
      c.fillStyle = lake;
      c.fillRect(0, hy, w, h - hy);

      // Rising Sun glow near Mt. Fuji
      rglow(c, w * 0.32, hy * 0.9, Math.max(w, h) * 0.45, '#fb7185', 0.45);
      // Soft warmth from cherry branch canopy
      rglow(c, w * 0.85, hy * 0.2, Math.max(w, h) * 0.5, '#f472b6', 0.28);
    },
    under(w) {
      const hy = Math.round(w.rows * 0.76);
      const fx = Math.round(w.cols * (w.cols < 60 ? 0.42 : 0.28));
      const fw = Math.round(clamp(w.cols * 0.52, 22, 54));
      const fh = Math.round(clamp(w.rows * 0.36, 10, 24));
      const fujiH = fujiHeights(w.cols, fx, fw, fh);

      // Draw Mt. Fuji
      for (let x = 0; x < w.cols; x++) {
        const h = fujiH[x];
        if (h <= 0) continue;
        for (let y = hy - h; y < hy; y++) {
          const elev = hy - y;
          const isSnow = elev > h * 0.62 || (elev > h * 0.46 && hash(x, y, 7) < 0.38);
          if (isSnow) {
            w.tile(x, y, '#ffffff', '#e2e8f0', '*', 0.96);
          } else {
            const dx = x - fx;
            if (dx < 0) w.tile(x, y, '#818cf8', '#c7d2fe', '/', 0.88);
            else w.tile(x, y, '#4338ca', '#312e81', '\\', 0.92);
          }
        }
        // Lake reflection of Mt. Fuji
        const refH = Math.min(Math.round(h * 0.45), w.rows - hy);
        for (let k = 0; k < refH; k++) {
          w.tile(x, hy + k, '#3b82f6', null, '', 0.28 - k * 0.05);
        }
      }

      // Torii Gate on water edge
      const tx = Math.round(clamp(w.cols * (w.cols < 60 ? 0.05 : 0.12), 1, Math.max(2, w.cols - TORII_GATE.w - 2)));
      const ty = hy - TORII_GATE.h + 2;
      w.sprite(TORII_GATE, tx, ty);

      // Lush Sakura Branch canopy at top-right
      const bx = Math.max(0, w.cols - SAKURA_BRANCH_BIG.w);
      w.sprite(SAKURA_BRANCH_BIG, bx, 0);

      if (w.cols > 50) {
        w.tile(bx - 3, 3, '#f472b6', '#ffffff', '*');
        w.tile(bx - 5, 4, '#ffb7c5', '#fff1f2', '+');
        w.tile(bx - 2, 5, '#e11d48', '#ffffff', 'o');
        w.tile(bx - 6, 2, '#86efac', '#15803d', ':');
      }

      // Fallen petals on the water shore
      for (let x = 0; x < w.cols; x += rint(3, 8)) {
        w.tile(x, w.rows - 1, '#fce7f3', '#f472b6', pick(['*', '+', '°']), 0.65);
      }
    },
    init(w) {
      const s = w.s;
      const count = Math.round(clamp((w.cols * w.rows) / 18, 35, 110) * (cfg.density || 1.0));
      s.petals = Array.from({ length: count }, (_, i) => spawnSakuraPetal(w, true, false, i % 3 === 0));
      s.gustTimer = rnd(4, 8);
      s.gustActive = false;
      s.gustDuration = 0;
      s.gustStrength = 0;
      s.birds = Array.from({ length: Math.round(clamp(w.cols / 18, 2, 6)) }, () => ({
        x: rnd(0, w.cols),
        y: rnd(2, w.rows * 0.35),
        v: rnd(1.0, 2.0),
        ph: rnd(0, 6),
      }));
    },
    frame(w, dt) {
      const s = w.s;
      const speedMul = cfg.speed || 1.0;
      const hy = Math.round(w.rows * 0.76);
      const t = w.t;

      // Hanging lantern subtle sway & warm glow
      const bx = Math.max(0, w.cols - SAKURA_BRANCH_BIG.w);
      const lx = bx + 52;
      const ly = 12;
      w.glow(lx, ly, 7, '#fef08a', 0.55 + 0.15 * Math.sin(t * 3));

      // Birds flying over Mt. Fuji
      for (const b of s.birds) {
        b.x -= b.v * dt * speedMul;
        if (b.x < -3) {
          b.x = w.cols + rnd(2, 10);
          b.y = rnd(2, hy * 0.45);
        }
        w.glyph(b.x, b.y + Math.sin(t * 1.6 + b.ph) * 0.5, Math.floor(t * 4 + b.ph) % 2 ? 'v' : '^', '#334155', 0.85);
      }

      // Wind gust logic
      s.gustTimer -= dt;
      if (s.gustTimer <= 0 && !s.gustActive) {
        s.gustActive = true;
        s.gustDuration = rnd(2.0, 3.2);
        s.gustStrength = rnd(2.8, 4.5);
        s.gustTimer = rnd(6, 12);
        const burst = rint(14, 24);
        for (let k = 0; k < burst; k++) {
          s.petals.push(spawnSakuraPetal(w, false, true, Math.random() < 0.3));
        }
      }

      let currentWind = 1;
      if (s.gustActive) {
        s.gustDuration -= dt;
        if (s.gustDuration <= 0) s.gustActive = false;
        else currentWind = 1 + s.gustStrength * Math.sin((s.gustDuration / 3.0) * Math.PI);
      }

      const totalSpeed = speedMul * currentWind;
      const mouse = w.mouse;
      const hasMouse = mouse && mouse.active;

      // Lake ripples
      for (let y = hy; y < w.rows; y++) {
        const dir = y % 2 ? 1 : -1;
        for (let x = 0; x < w.cols; x += 3) {
          if (hash(Math.floor(x + t * 0.7 * dir), y, 31) < 0.09) {
            w.glyph(x, y, '~', '#fbcfe8', 0.5);
          }
        }
      }

      // Parallax Petals
      const maxPetals = Math.round(clamp((w.cols * w.rows) / 14, 50, 150) * (cfg.density || 1.0));
      if (s.petals.length > maxPetals) s.petals.splice(0, s.petals.length - maxPetals);

      for (let i = 0; i < s.petals.length; i++) {
        const p = s.petals[i];
        p.ph += dt * p.swayFreq * (s.gustActive ? 2.0 : 1.0);
        const sway = Math.sin(p.ph) * p.swayAmp;

        p.x -= (p.vx * totalSpeed + sway * 0.4) * dt;
        p.y += (p.vy * totalSpeed * 0.75 + Math.abs(sway) * 0.25) * dt;
        p.rot += p.rotSpeed * dt * totalSpeed;

        if (hasMouse) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 12) {
            const force = (1 - dist / 12) * 9 * dt;
            p.x += (dx / (dist + 0.1)) * force + mouse.vx * 0.45 * dt;
            p.y += (dy / (dist + 0.1)) * force + mouse.vy * 0.45 * dt;
            p.rot += 14 * dt;
          }
        }

        if (p.x < -4 || p.y > w.rows + 1) {
          s.petals[i] = spawnSakuraPetal(w, false, Math.random() < 0.65, p.isFar);
          continue;
        }

        const char = Math.cos(p.rot) > 0.2 ? p.ch : Math.cos(p.rot) < -0.2 ? '+' : '°';
        w.tile(p.x, p.y, p.bg, p.fg, char, p.a * p.z);
      }

      if (s.gustActive) {
        for (let k = 0; k < 5; k++) {
          const wx = Math.round(w.cols - ((t * 40 + k * 18) % (w.cols + 24)));
          const wy = Math.round(2 + (k * 4) % (w.rows - 6));
          w.glyph(wx, wy, '~', '#ffffff', 0.45);
          w.glyph(wx + 1, wy, '~', '#fda4af', 0.35);
        }
      }
    },
  });


  /* ----------------------------------------------------------------- galaxy */

  // Smooth value noise built on hash(), for the nebula clouds.
  function gxNoise(x, y, s) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s);
    const b = hash(xi + 1, yi, s);
    const c = hash(xi, yi + 1, s);
    const d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const gxFbm = (x, y, s) => gxNoise(x, y, s) * 0.55 + gxNoise(x * 2.1, y * 2.1, s + 7) * 0.3 + gxNoise(x * 4.3, y * 4.3, s + 13) * 0.15;

  // Where things sit; shared by the static layer and every frame.
  function gxLayout(w) {
    const narrow = w.cols < 70;
    return {
      bx: Math.round(w.cols * (narrow ? 0.5 : 0.64)),
      by: Math.round(w.rows * 0.42),
      R: clamp(Math.round(Math.min(w.cols / 3, w.rows) * 0.105), 3, 8),
      px: Math.round(w.cols * (narrow ? 0.2 : 0.13)),
      py: Math.round(w.rows * 0.8),
      pr: clamp(Math.round(Math.min(w.cols / 2.5, w.rows) * 0.13), 3, 10),
      gx: Math.round(w.cols * (narrow ? 0.25 : 0.2)),
      gy: Math.round(w.rows * 0.2),
      gs: clamp(Math.round(Math.min(w.cols / 3, w.rows) * 0.09), 3, 8),
    };
  }

  // Ice giant with a tilted ring, lit from the black hole's side.
  function gxPlanet(w, px, py, pr) {
    const bands = ['#312e81', '#4338ca', '#6366f1', '#a5b4fc', '#818cf8', '#3730a3'];
    const ringA = pr * 2.2;
    const ringB = pr * 0.6;
    const spanY = Math.ceil(ringB + ringA * 0.16) + 1;
    const ring = (front) => {
      for (let dy = -spanY; dy <= spanY; dy++) {
        for (let dx = -Math.ceil(ringA); dx <= Math.ceil(ringA); dx++) {
          const ty = dy - dx * 0.16;
          if (front ? ty < 0 : ty >= 0) continue;
          const e = Math.hypot(dx / ringA, ty / ringB);
          if (e < 0.6 || e > 1 || (e > 0.8 && e < 0.86)) continue;
          const col = e < 0.7 ? '#e0e7ff' : e < 0.8 ? '#c4b5fd' : '#94a3b8';
          w.tile(px + dx, py + dy, col, '#475569', e < 0.8 ? '=' : '-', front ? 0.85 : 0.55);
        }
      }
    };
    w.glow(px, py, pr * 2, '#6366f1', 0.28);
    ring(false);
    for (let dy = -pr; dy <= pr; dy++) {
      for (let dx = -pr; dx <= pr; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > pr * pr) continue;
        const bi = Math.floor((dy / pr + 1) * 3 + Math.sin(dx * 0.7) * 0.4);
        const band = bands[((bi % bands.length) + bands.length) % bands.length];
        w.tile(px + dx, py + dy, band, '#1e1b4b', hash(dx, dy, 9) < 0.5 ? '~' : '-', 1);
        const lit = ((dx - dy) / pr) * 0.7;
        const shade = clamp(-lit * 0.6 + 0.12, 0, 0.82);
        if (shade > 0.02) w.tile(px + dx, py + dy, '#020617', null, null, shade);
        if (d2 > (pr - 1) * (pr - 1) && lit > 0.25) w.glyph(px + dx, py + dy, '·', '#e0e7ff', 0.7);
      }
    }
    ring(true);
  }

  // Slowly turning spiral galaxy far away.
  function gxSpiral(w, gx, gy, gs, rot) {
    w.glow(gx, gy, gs * 1.8, '#c4b5fd', 0.3);
    for (let arm = 0; arm < 2; arm++) {
      for (let k = 0; k < 30; k++) {
        const f = k / 30;
        const ang = rot + arm * Math.PI + f * 2.6 * Math.PI;
        const r = gs * (0.15 + f * 0.95) + (hash(k, arm, 5) - 0.5) * 0.6;
        const col = f < 0.25 ? '#fef9c3' : f < 0.6 ? '#c4b5fd' : '#60a5fa';
        w.glyph(gx + Math.cos(ang) * r * 1.7, gy + Math.sin(ang) * r * 0.55, f < 0.3 ? '*' : hash(k, arm, 6) < 0.5 ? '·' : '.', col, 0.9 - f * 0.55);
      }
    }
    w.tile(gx, gy, '#fef3c7', '#ffffff', '*', 0.95);
  }

  // Half of the accretion disk. The far half goes behind the shadow, the near half in front of it.
  function gxDisk(w, L, ang, front) {
    const { bx, by, R } = L;
    const rx = R * 3.1;
    const ry = R * 0.6;
    const ein = (R * 1.3) / rx;
    const y0 = front ? 0 : -Math.ceil(ry);
    const y1 = front ? Math.ceil(ry) : -1;
    for (let dy = y0; dy <= y1; dy++) {
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        const e = Math.hypot(dx / rx, dy / ry);
        if (e > 1 || e < ein) continue;
        const rn = (e - ein) / (1 - ein);
        const th = Math.atan2(dy / ry, dx / rx);
        const beam = 0.78 - 0.42 * Math.cos(th); // Doppler beaming: the side coming toward us is brighter
        const sw = Math.sin(th * 3 - ang * 4 + rn * 8);
        let bg = null;
        let fg;
        let ch;
        if (rn < 0.16) {
          bg = '#fde68a';
          fg = '#ffffff';
          ch = '*';
        } else if (rn < 0.42) {
          bg = sw > 0.2 ? '#f59e0b' : null;
          fg = '#fde68a';
          ch = sw > 0.2 ? '#' : '=';
        } else if (rn < 0.72) {
          fg = sw > 0 ? '#fb923c' : '#f43f5e';
          ch = sw > 0.3 ? '%' : '~';
        } else {
          fg = '#a855f7';
          ch = sw > 0 ? '·' : '.';
        }
        w.tile(bx + dx, by + dy, bg, fg, ch, clamp((1.05 - rn * 0.75) * beam * (0.78 + 0.22 * sw), 0.06, 1));
      }
    }
  }

  // Light from the far side of the disk, bent over the top and under the bottom of the shadow.
  function gxArcs(w, L, t) {
    const { bx, by, R } = L;
    const a = R * 1.75;
    const b = R * 1.45;
    const steps = Math.ceil(Math.PI * a * 1.6);
    for (let k = 0; k <= steps; k++) {
      const phi = (k / steps) * Math.PI;
      const u = Math.cos(phi);
      const h = Math.sin(phi);
      const beam = 0.8 - 0.35 * u;
      const fl = 0.85 + 0.15 * Math.sin(t * 3 + k * 0.4);
      const x = bx + u * a;
      w.tile(x, by - h * b, '#f59e0b', '#fff7ed', '*', clamp(0.92 * beam * fl, 0, 1));
      w.glyph(x, by - h * b - 1, '~', '#fbbf24', 0.4 * beam * h);
      w.glyph(x, by + h * b * 0.82, '~', '#fb923c', 0.55 * beam * fl);
    }
  }

  // The shadow (solid, no tile gaps) and its photon ring.
  function gxHorizon(w, L, t, flash) {
    const { bx, by, R } = L;
    const c = w.cell;
    w.ctx.fillStyle = '#000000';
    for (let dy = -R - 1; dy <= R + 1; dy++) {
      for (let dx = -R - 1; dx <= R + 1; dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= R - 0.2) {
          w.ctx.fillRect((bx + dx) * c, (by + dy) * c, c, c);
        } else if (d <= R + 0.7) {
          const th = Math.atan2(dy, dx);
          w.tile(bx + dx, by + dy, '#fbbf24', '#ffffff', '·', clamp(0.7 + 0.25 * Math.sin(t * 2.5 + th * 3) + flash, 0, 1));
        }
      }
    }
  }

  function gxDust(w, initial) {
    const far = Math.random() < 0.55;
    const sp = far ? 0.25 : 0.6;
    let bvx = rnd(-sp, sp);
    let bvy = rnd(-sp, sp) * 0.6;
    let x = Math.random() * w.cols;
    let y = Math.random() * w.rows;
    if (!initial) {
      const e = rint(0, 3);
      if (e === 0) (x = -1), (bvx = Math.abs(bvx));
      else if (e === 1) (x = w.cols + 1), (bvx = -Math.abs(bvx));
      else if (e === 2) (y = -1), (bvy = Math.abs(bvy));
      else (y = w.rows + 1), (bvy = -Math.abs(bvy));
    }
    return {
      x,
      y,
      vx: bvx,
      vy: bvy,
      bvx,
      bvy,
      far,
      ex: 0,
      sl: 0,
      ch: pick(far ? ['·', '.', '°'] : ['*', '+', '·', '°', '~']),
      color: pick(['#a78bfa', '#f472b6', '#67e8f9', '#93c5fd', '#fde68a', '#e2e8f0']),
      a: far ? rnd(0.25, 0.55) : rnd(0.6, 0.95),
    };
  }

  THEMES.push({
    id: 'galaxy',
    name: 'Cosmic Galaxy',
    dark: true,
    alias: ['galaxy', 'vu tru', 'vutru', 'ngan ha', 'nganha', 'blackhole', 'ho den', 'space', 'nebula', 'cosmos'],
    glyphs: '·*+°~%#@',
    bg(c, w, h) {
      const g = c.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#04020a');
      g.addColorStop(0.45, '#0b061d');
      g.addColorStop(0.8, '#06091f');
      g.addColorStop(1, '#02040d');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      const v = c.createRadialGradient(w * 0.6, h * 0.45, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.55)');
      c.fillStyle = v;
      c.fillRect(0, 0, w, h);
    },
    // Drawn once: nebula clouds and the ringed planet.
    under(w) {
      const L = gxLayout(w);
      w.glow(w.cols * 0.2, w.rows * 0.35, Math.max(w.cols, w.rows) * 0.35, '#7c3aed', 0.22);
      w.glow(w.cols * 0.8, w.rows * 0.75, Math.max(w.cols, w.rows) * 0.35, '#0891b2', 0.18);
      w.glow(w.cols * 0.45, w.rows * 0.15, Math.max(w.cols, w.rows) * 0.25, '#db2777', 0.14);
      const clouds = [
        { s: 101, sx: 0.05, sy: 0.08, bg: '#3b0764', fg: '#a78bfa' },
        { s: 202, sx: 0.07, sy: 0.06, bg: '#500724', fg: '#f472b6' },
        { s: 303, sx: 0.06, sy: 0.09, bg: '#083344', fg: '#67e8f9' },
      ];
      for (let j = 0; j < w.rows; j++) {
        for (let i = 0; i < w.cols; i++) {
          let best = null;
          let bv = 0;
          for (const cl of clouds) {
            const n = gxFbm(i * cl.sx, j * cl.sy, cl.s);
            if (n > bv) (bv = n), (best = cl);
          }
          const k = (bv - 0.56) / 0.3;
          if (k <= 0) continue;
          const ch = k > 0.75 ? '%' : k > 0.45 ? ':' : hash(i, j, 77) < 0.5 ? '.' : '·';
          w.tile(i, j, k > 0.35 ? best.bg : null, best.fg, ch, clamp(k * 0.5, 0.06, 0.45));
        }
      }
      gxPlanet(w, L.px, L.py, L.pr);
    },
    init(w) {
      const density = cfg.density || 1.0;
      const area = w.cols * w.rows;
      w.s = {
        stars: Array.from({ length: Math.round(clamp(area / 12, 60, 180) * density) }, () => ({
          x: Math.random() * w.cols,
          y: Math.random() * w.rows,
          z: pick([0.25, 0.5, 1]),
          tw: rnd(0.8, 3.2),
          ph: Math.random() * Math.PI * 2,
          color: pick(['#ffffff', '#e0e7ff', '#c7d2fe', '#fef08a', '#a5f3fc', '#fbcfe8']),
          ch: pick(['.', '·', '+', '*']),
          base: rnd(0.25, 0.8),
        })),
        hero: Array.from({ length: clamp(Math.round(area / 900), 3, 9) }, () => ({
          x: rint(2, w.cols - 3),
          y: rint(2, w.rows - 3),
          tw: rnd(0.6, 1.6),
          ph: Math.random() * Math.PI * 2,
          color: pick(['#a5f3fc', '#fde68a', '#f9a8d4', '#c4b5fd']),
        })),
        dust: Array.from({ length: Math.round(clamp(area / 9, 70, 200) * density) }, () => gxDust(w, true)),
        meteors: [],
        nextMeteor: rnd(2.0, 5.0),
        trail: [],
        ang: 0,
        flash: 0,
      };
    },
    frame(w, dt) {
      const s = w.s;
      const t = w.t;
      const sp = cfg.speed || 1.0;
      const mouse = w.mouse;
      const hasMouse = !!(mouse && mouse.active);
      const L = gxLayout(w);

      // Black hole aura, breathing slowly
      const breath = 0.85 + 0.15 * Math.sin(t * 0.8);
      w.glow(L.bx, L.by, L.R * 5, '#f59e0b', 0.24 * breath);
      w.glow(L.bx, L.by, L.R * 2.8, '#ec4899', 0.3 * breath);

      // Stars: three depths drifting at different speeds, bent away from the cursor (lensing)
      for (const st of s.stars) {
        st.x -= st.z * 0.12 * dt * sp;
        if (st.x < 0) st.x += w.cols;
        let x = st.x;
        let y = st.y;
        let a = clamp(st.base + Math.sin(t * st.tw + st.ph) * 0.35, 0.05, 1);
        if (hasMouse) {
          const dx = x - mouse.x;
          const dy = y - mouse.y;
          const d = Math.hypot(dx, dy);
          if (d < 7 && d > 0.01) {
            const push = 2.4 * (1 - d / 7);
            x += (dx / d) * push;
            y += (dy / d) * push;
            a = Math.min(1, a + 0.35);
          }
        }
        w.glyph(x, y, st.ch, st.color, a);
      }

      // Bright stars with cross-shaped flares
      for (const h of s.hero) {
        const k = 0.5 + 0.5 * Math.sin(t * h.tw + h.ph);
        w.glow(h.x, h.y, 2.4, h.color, 0.28 * k);
        w.tile(h.x, h.y, null, '#ffffff', '*', 0.7 + 0.3 * k);
        const len = k > 0.6 ? 2 : 1;
        for (let i = 1; i <= len; i++) {
          const a = (0.75 / i) * k;
          w.glyph(h.x - i, h.y, '-', h.color, a);
          w.glyph(h.x + i, h.y, '-', h.color, a);
          w.glyph(h.x, h.y - i, '|', h.color, a);
          w.glyph(h.x, h.y + i, '|', h.color, a);
        }
      }

      gxSpiral(w, L.gx, L.gy, L.gs, -t * 0.08 * sp);

      // Shooting stars
      s.nextMeteor -= dt * sp;
      if (s.nextMeteor <= 0) {
        s.meteors.push({
          x: rnd(w.cols * 0.1, w.cols * 0.9),
          y: rnd(-5, w.rows * 0.3),
          vx: rnd(35, 65),
          vy: rnd(20, 42),
          len: rint(4, 8),
          life: rnd(0.6, 1.2),
          color: pick(['#ffffff', '#a5f3fc', '#fef08a']),
        });
        s.nextMeteor = rnd(3.0, 7.0);
      }
      for (let i = s.meteors.length - 1; i >= 0; i--) {
        const m = s.meteors[i];
        m.life -= dt;
        m.x += m.vx * dt * sp;
        m.y += m.vy * dt * sp;
        if (m.life <= 0 || m.x > w.cols + 10 || m.y > w.rows + 10) {
          s.meteors.splice(i, 1);
          continue;
        }
        for (let k = 0; k < m.len; k++) {
          const a = clamp((m.life / 0.8) * (1 - k / m.len), 0, 1);
          w.glyph(m.x - (m.vx / 35) * k * 0.7, m.y - (m.vy / 20) * k * 0.7, k === 0 ? '*' : k < 3 ? '+' : '~', m.color, a);
        }
      }

      // Black hole: far half of the disk, bent light, shadow, near half of the disk
      s.ang += dt * 0.65 * sp;
      s.flash = Math.max(0, s.flash - dt);
      gxDisk(w, L, s.ang, false);
      gxArcs(w, L, t);
      gxHorizon(w, L, t, s.flash);
      gxDisk(w, L, s.ang, true);

      // Cosmic dust: falls into the black hole, swirls around the cursor, gets flung out when it passes too close
      const damp = Math.pow(0.55, dt);
      for (let i = 0; i < s.dust.length; i++) {
        const p = s.dust[i];
        const inf = p.far ? 0.45 : 1;
        let ax = 0;
        let ay = 0;

        const dx = L.bx - p.x;
        const dy = L.by - p.y;
        const d2 = dx * dx + dy * dy;
        const d = Math.sqrt(d2) || 1;
        if (d < L.R * 0.85) {
          s.flash = 0.3;
          s.dust[i] = gxDust(w, false);
          continue;
        }
        if (d < L.R * 7) {
          const g = (L.R * L.R * 2.2) / (d2 + 2);
          ax += (dx / d) * g - (dy / d) * g * 1.3;
          ay += (dy / d) * g + (dx / d) * g * 1.3;
        }

        if (hasMouse) {
          const mx = mouse.x - p.x;
          const my = mouse.y - p.y;
          const md = Math.hypot(mx, my);
          if (md < 22 && md > 0.05) {
            const ux = mx / md;
            const uy = my / md;
            const n = 1 - md / 22;
            const g = (55 * n * n) / (md + 1.2);
            ax += (ux * 0.9 - uy * 1.6) * g + mouse.vx * 0.6 * n;
            ay += (uy * 0.9 + ux * 1.6) * g + mouse.vy * 0.6 * n;
            if (md < 1.4 && p.sl <= 0) {
              // Gravitational slingshot
              const v = rnd(16, 26);
              p.vx = -uy * v - ux * v * 0.35;
              p.vy = ux * v - uy * v * 0.35;
              p.sl = 1.2;
              p.ex = 0.9;
            } else if (md < 6) {
              p.ex = Math.max(p.ex, 0.25);
            }
          }
        }

        p.vx += ax * dt * inf;
        p.vy += ay * dt * inf;
        p.vx = p.bvx + (p.vx - p.bvx) * damp;
        p.vy = p.bvy + (p.vy - p.bvy) * damp;
        const v = Math.hypot(p.vx, p.vy);
        if (v > 32) {
          p.vx *= 32 / v;
          p.vy *= 32 / v;
        }
        p.x += p.vx * dt * sp;
        p.y += p.vy * dt * sp;
        p.ex -= dt;
        p.sl -= dt;

        if (p.x < -8 || p.x > w.cols + 8 || p.y < -8 || p.y > w.rows + 8) {
          s.dust[i] = gxDust(w, false);
          continue;
        }

        if (p.ex > 0) {
          const hot = p.ex > 0.3;
          w.glyph(p.x - p.vx * 0.05, p.y - p.vy * 0.05, '·', p.color, 0.5);
          w.glyph(p.x, p.y, hot ? '*' : '+', hot ? (i % 2 ? '#67e8f9' : '#fde68a') : p.color, 1);
        } else {
          w.glyph(p.x, p.y, p.ch, p.color, p.a);
        }
      }

      // The cursor: a small singularity with its own spinning ring and a fading trail
      if (hasMouse) s.trail.push({ x: mouse.x, y: mouse.y, life: 0.6 });
      if (s.trail.length > 40) s.trail.splice(0, s.trail.length - 40);
      for (let i = s.trail.length - 1; i >= 0; i--) {
        const p = s.trail[i];
        p.life -= dt;
        if (p.life <= 0) {
          s.trail.splice(i, 1);
          continue;
        }
        w.glyph(p.x, p.y, '·', '#a78bfa', p.life * 1.1);
      }
      if (hasMouse) {
        w.glow(mouse.x, mouse.y, 7, '#7c3aed', 0.4);
        w.glow(mouse.x, mouse.y, 3, '#22d3ee', 0.5);
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2 + t * 2.4;
          const sy = Math.sin(a);
          w.glyph(mouse.x + Math.cos(a) * 2.8, mouse.y + sy * 1.2, sy > 0 ? '*' : '·', sy > 0 ? '#67e8f9' : '#c4b5fd', sy > 0 ? 0.95 : 0.5);
        }
        w.tile(mouse.x, mouse.y, '#000000', '#67e8f9', '•', 1);
      }
    },
  });

  // Hoi An by night: strings of silk lanterns over the old town, paper flower
  // lanterns (hoa dang) and a sampan drifting down the Hoai river.
  const LANTERN_COLS = [
    ['#d8342a', '#9f1f18', '#ff6a4d'],
    ['#ef7d22', '#b9560f', '#ffa95c'],
    ['#f5bd2e', '#c08d12', '#ffe07a'],
    ['#e8487f', '#aa2a58', '#ff8db0'],
    ['#1f9d94', '#13706a', '#56d6c8'],
  ];
  const lanternPal = (c) => ({
    L: [c[0], c[1]],
    B: [c[2], c[0]],
    c: ['#c9a14a', '#8a6c2a', '='],
    t: [null, '#e6c36a', '|'],
  });
  const LANTERN = sprite([' ccc ', 'LLLLL', 'LBBBL', 'LBBBL', 'LLLLL', ' ccc ', '  t  '], null);
  const LANTERN_SMALL = sprite([' c ', 'LBL', 'LBL', ' t '], null);
  const FLOWER = sprite([' f ', 'PpP'], null);
  const flowerPal = (petal, edge) => ({
    f: ['#fff1a8', '#f2b431', '*'],
    P: [petal, edge],
    p: ['#ffd66b', '#d9a22e'],
  });
  const FLOWER_PALS = [flowerPal('#ff9fcb', '#d9628f'), flowerPal('#fff4ea', '#d8c6b4'), flowerPal('#ff8a6b', '#cf5a3e')];
  const SAMPAN = sprite(['          L   ', '    rrrr  |   ', '  rrrrrrrr|   ', 'hhhhhhhhhhhhhh', ' hhhhhhhhhhhh '], {
    L: ['#ff6a4d', '#d8342a'],
    '|': [null, '#a8896a', '|'],
    r: ['#3a2c22', '#2a1f18'],
    h: ['#1c1512', '#2c211b'],
  });

  function hoianGeo(w) {
    const river = Math.round(w.rows * 0.74);
    const houseMax = clamp(Math.round(w.rows * 0.16), 2, 10);
    const small = w.rows < 28;
    const lh = small ? 4 : 7;
    const n = clamp(Math.round(w.rows / 22), 1, 3);
    const roofTop = river - houseMax - 2;
    return { river, houseMax, small, lh, n, step: Math.max(1, (roofTop - lh - 3) / n) };
  }

  THEMES.push({
    id: 'hoian',
    name: 'Hội An',
    dark: true,
    alias: ['hoi an', 'pho co', 'den long', 'den', 'hoa dang', 'lantern', 'lanterns'],
    glyphs: '*+:.',
    bg(c, w, h, W) {
      const g = hoianGeo(W);
      const ry = g.river * W.cell;
      vgrad(c, w, ry, ['#0c0a26', '#1f1438', '#4a2340']);
      const water = c.createLinearGradient(0, ry, 0, h);
      water.addColorStop(0, '#2c1a33');
      water.addColorStop(1, '#0a0a20');
      c.fillStyle = water;
      c.fillRect(0, ry, w, h - ry);
      rglow(c, w * 0.5, ry, Math.max(w, h) * 0.55, '#ff9a4d', 0.2);
    },
    init(w) {
      const s = w.s;
      const g = hoianGeo(w);
      const C = w.cols;

      s.houses = [];
      for (let x = rint(-4, 0); x < C; ) {
        const wd = rint(6, 12);
        s.houses.push({ x, w: wd, h: rint(Math.ceil(g.houseMax * 0.5), g.houseMax), tone: rint(0, 2) });
        x += wd;
      }
      s.windows = [];
      for (const hs of s.houses) {
        for (let wx = hs.x + 2; wx < hs.x + hs.w - 1; wx += 3) {
          for (let wy = g.river - hs.h + 1; wy < g.river - 1; wy += 3) {
            if (Math.random() < 0.65) s.windows.push({ x: wx, y: wy, ph: rnd(0, 6), f: rnd(0.4, 1.3) });
          }
        }
      }

      s.strings = [];
      s.lanterns = [];
      for (let k = 0; k < g.n; k++) {
        const str = { y0: Math.round(k * g.step), sag: g.small ? 1 : rnd(2, 3.2), a: 0.55 + (0.3 * (k + 1)) / g.n };
        s.strings.push(str);
        for (let x = rnd(0, 5); x < C; x += rnd(9, 14)) {
          const u = (x / Math.max(1, C)) * 2 - 1;
          const col = pick(LANTERN_COLS);
          s.lanterns.push({ x, y: str.y0 + str.sag * (1 - u * u), a: str.a, col, pal: lanternPal(col), ph: rnd(0, 6), seed: rint(1, 99) });
        }
      }

      s.stars = Array.from({ length: Math.round(clamp((w.cols * w.rows) / 160, 6, 50)) }, () => ({
        x: rint(0, C - 1),
        y: rint(0, Math.max(0, g.river - g.houseMax - 3)),
        ch: pick(['.', '+', '·']),
        ph: rnd(0, 6),
        f: rnd(0.6, 1.8),
      }));

      const water = w.rows - g.river;
      s.flowers = Array.from({ length: Math.round(clamp(C / 9, 3, 14)) }, () => ({
        x: rnd(-3, C),
        y: rint(g.river + 1, Math.max(g.river + 1, w.rows - 2)),
        v: rnd(0.3, 0.8),
        ph: rnd(0, 6),
        pal: pick(FLOWER_PALS),
      })).sort((a, b) => a.y - b.y);
      s.boat = water >= 8 ? { x: rnd(-14, C), y: g.river + 1, v: rnd(0.35, 0.6), ph: rnd(0, 6) } : null;
    },
    under(w) {
      const s = w.s;
      const g = hoianGeo(w);
      const WALLS = [['#3b2a20', '#4a3527'], ['#46321f', '#574027'], ['#33261f', '#433228']];
      for (const hs of s.houses) {
        const wall = WALLS[hs.tone];
        for (let x = hs.x; x < hs.x + hs.w; x++) {
          for (let y = g.river - hs.h; y < g.river; y++) w.tile(x, y, wall[0], wall[1], w.ch(x, y, 51));
        }
        // Pitched roof of old tiles, one row narrower on each side per step.
        for (let k = 0; k < 2; k++) {
          for (let x = hs.x - 1 + k * 2; x <= hs.x + hs.w - k * 2; x++) w.tile(x, g.river - hs.h - 1 - k, k ? '#6d3324' : '#7f3d2a', '#55261a', '=');
        }
      }
      // Stone embankment, with the town's dark reflection under it.
      for (let x = 0; x < w.cols; x++) {
        w.tile(x, g.river, '#40362f', '#2f2722', '_');
        for (let y = g.river + 1; y < Math.min(w.rows, g.river + 3); y++) w.tile(x, y, '#120d1c', null, '', 0.5 - (y - g.river) * 0.14);
      }
      // Wires, sagging between the eaves.
      for (const str of s.strings) {
        for (let x = 0; x < w.cols; x++) {
          const u = (x / Math.max(1, w.cols)) * 2 - 1;
          w.glyph(x, str.y0 + str.sag * (1 - u * u), '-', '#8d7a68', str.a * 0.6);
        }
      }
    },
    frame(w, dt) {
      const s = w.s;
      const g = hoianGeo(w);
      const t = w.t;
      const sp = g.small ? LANTERN_SMALL : LANTERN;
      const mid = (sp.w - 1) / 2;
      const tick = Math.floor(t * 4);

      for (const st of s.stars) w.glyph(st.x, st.y, st.ch, '#f4e8d0', 0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * st.f + st.ph)));
      for (const wn of s.windows) w.tile(wn.x, wn.y, '#ffc65c', '#d99a2f', '#', 0.55 + 0.35 * Math.sin(t * wn.f + wn.ph));

      // River: slow ripples and the shimmer of every lantern's light.
      for (let y = g.river + 1; y < w.rows; y++) {
        const dir = y % 2 ? 1 : -1;
        for (let x = 0; x < w.cols; x++) {
          if (hash(Math.floor(x + t * 0.6 * dir), y, 61) < 0.06) w.glyph(x, y, '~', '#6d5a86', 0.6);
        }
      }
      for (const l of s.lanterns) {
        const x = Math.round(l.x + mid);
        for (let y = g.river + 1; y < w.rows; y++) {
          const d = y - g.river;
          if (hash(x + (d >> 1), y, tick + l.seed) < 0.34) w.tile(x + rint(-1, 1), y, l.col[0], l.col[1], '~', Math.max(0.08, 0.42 - d * 0.018));
        }
      }

      if (s.boat) {
        const b = s.boat;
        b.x += b.v * dt;
        if (b.x > w.cols + 1) b.x = -15;
        const y = b.y + Math.sin(t * 0.9 + b.ph) * 0.4;
        w.glow(b.x + 10, y, 3.5, '#ff8a4d', 0.4 + 0.08 * Math.sin(t * 3));
        w.sprite(SAMPAN, b.x, y, { seed: 6 });
      }

      for (const f of s.flowers) {
        f.x += f.v * dt;
        if (f.x > w.cols + 1) f.x = -4;
        const y = f.y + Math.sin(t * 1.1 + f.ph) * 0.35;
        w.glow(f.x + 1, y, 3, '#ffbf66', 0.34 + 0.12 * Math.sin(t * 4 + f.ph));
        w.sprite(FLOWER, f.x, y - 1, { pal: f.pal, seed: 8 });
      }

      for (const l of s.lanterns) {
        const sway = Math.sin(t * 0.8 + l.ph) * 0.8;
        const flick = 0.3 + 0.07 * Math.sin(t * 2.6 + l.ph) + 0.03 * Math.sin(t * 7.3 + l.ph * 2);
        w.glow(l.x + mid + sway, l.y + sp.h / 2 - 0.5, g.small ? 3.5 : 6, l.col[2], flick * l.a);
        w.sprite(sp, l.x + sway, l.y, { pal: l.pal, a: l.a, seed: l.seed });
      }
    },
  });

  /* --------------------------------------------------------------------- tet */
  // Tết Việt Nam: Bếp lửa hồng, Nồi bánh chưng đêm 30, Pháo hoa giao thừa rực rỡ, Cành mai đào & Đèn lồng đỏ.

  const BANH_CHUNG_POT = sprite(
    [
      '    ==========    ',
      '   /HHHHHHHHHH\\   ',
      '  |############|  ',
      ' ==############== ',
      '  |############|  ',
      '  |############|  ',
      '  |############|  ',
      '   \\__________/   ',
    ],
    {
      '=': ['#94a3b8', '#cbd5e1', '='],
      '/': ['#64748b', '#94a3b8', '/'],
      '\\': ['#64748b', '#94a3b8', '\\'],
      '|': ['#475569', '#64748b', '|'],
      H: ['#334155', '#94a3b8', '='],
      '#': ['#1e293b', '#475569', '#'],
      _: ['#334155', '#475569', '_'],
    },
  );

  const TET_BRANCH = sprite(
    [
      '                                      bbbbbbbbbbbb',
      '                              bbbbbbbbb     bbbbbb',
      '                     bbbbbbbbbb               bbbb',
      '              MmmM     bbbbb     DddD             ',
      '      DddD   myYYym     bbb     dfFFfd    MmmM    ',
      '     dfFFfd   MmmM     bb bb     DddD    myYYym   ',
      '      DddD            bb   bb             MmmM    ',
      '            MmmM     bb     bb   DddD             ',
      '           myYYym   bb       b  dfFFfd    L       ',
      '            MmmM                DddD     lRl      ',
      '                                         lRl      ',
      '                                         lRl      ',
      '                                          T       ',
    ],
    {
      b: ['#451a03', '#271002', '#'],
      M: ['#d97706', '#b45309', '*'],
      m: ['#f59e0b', '#fbbf24', '+'],
      y: ['#fde047', '#fef08a', '°'],
      Y: ['#ffffff', '#fde047', 'o'],
      D: ['#db2777', '#be185d', '*'],
      d: ['#f472b6', '#fb7185', '+'],
      f: ['#fce7f3', '#fda4af', '°'],
      F: ['#ffffff', '#fce7f3', 'o'],
      L: ['#7f1d1d', '#450a0a', '='],
      R: ['#dc2626', '#ef4444', '#'],
      l: ['#ef4444', '#f87171', '|'],
      T: ['#f59e0b', '#d97706', 'v'],
    },
  );

  const FIREWORK_PALS = [
    { name: 'gold-red', colors: ['#ef4444', '#f59e0b', '#fbbf24', '#fef08a', '#ffffff'] },
    { name: 'emerald-cyan', colors: ['#10b981', '#06b6d4', '#6ee7b7', '#a5f3fc', '#ffffff'] },
    { name: 'lotus-magenta', colors: ['#ec4899', '#a855f7', '#f472b6', '#fbcfe8', '#ffffff'] },
    { name: 'rainbow', colors: ['#ef4444', '#facc15', '#22c55e', '#38bdf8', '#c084fc'] },
  ];

  function spawnRocket(w, fromX = null, fromY = null) {
    const pal = pick(FIREWORK_PALS);
    const startX = fromX != null ? fromX : rnd(w.cols * 0.15, w.cols * 0.85);
    const targetY = rnd(w.rows * 0.12, w.rows * 0.45);
    const startY = fromY != null ? fromY : w.rows + 2;
    const speed = rnd(28, 42);
    const ang = fromX != null ? rnd(-0.35, 0.35) : rnd(-0.2, 0.2);
    return {
      type: 'rocket',
      x: startX,
      y: startY,
      vx: Math.sin(ang) * speed * 0.4,
      vy: -speed,
      targetY,
      pal,
      life: 0,
    };
  }

  function explodeFirework(rocket, w) {
    const sparks = [];
    const count = rint(32, 48);
    const pal = rocket.pal.colors;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = rnd(6, 26);
      sparks.push({
        x: rocket.x,
        y: rocket.y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp * 0.75,
        color: pick(pal),
        ch: pick(['*', '+', '·', '°']),
        life: rnd(0.9, 1.8),
        maxLife: rnd(1.2, 1.8),
      });
    }
    return sparks;
  }

  THEMES.push({
    id: 'tet',
    name: 'Tết Việt Nam',
    dark: true,
    alias: ['tet', 'xuan', 'tet ta', 'banh chung', 'giao thua', 'phao hoa', 'mai dao', 'lunar new year', 'new year', 'nam moi'],
    glyphs: '*+~o:.•#°',
    bg(c, w, h, W) {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#020617');
      g.addColorStop(0.35, '#081226');
      g.addColorStop(0.72, '#121e36');
      g.addColorStop(1, '#1c1917');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);

      // Warm glow around the hearth area
      const potX = Math.round(w * (W.cols < 60 ? 0.5 : 0.28));
      const potY = Math.round(h * 0.82);
      rglow(c, potX, potY, Math.max(w, h) * 0.38, '#ea580c', 0.32);
      rglow(c, potX, potY, Math.max(w, h) * 0.18, '#ef4444', 0.4);
    },
    under(w) {
      // Spring Blossom Branch at top-right
      const bx = Math.max(0, w.cols - TET_BRANCH.w);
      w.sprite(TET_BRANCH, bx, 0);

      // Bánh Chưng Pot & Firewood at bottom
      const potX = Math.round(w.cols * (w.cols < 60 ? 0.5 : 0.28));
      const potY = Math.max(4, w.rows - BANH_CHUNG_POT.h - 3);

      // Firewood logs under the pot
      for (let x = potX - 2; x <= potX + BANH_CHUNG_POT.w + 1; x++) {
        w.tile(x, potY + BANH_CHUNG_POT.h, '#78350f', '#451a03', '=', 0.95);
        w.tile(x, potY + BANH_CHUNG_POT.h + 1, '#451a03', '#271002', '#', 0.95);
      }
      w.sprite(BANH_CHUNG_POT, potX, potY);
    },
    init(w) {
      const area = w.cols * w.rows;
      const density = cfg.density || 1.0;
      const potX = Math.round(w.cols * (w.cols < 60 ? 0.5 : 0.28));
      const potY = Math.max(4, w.rows - BANH_CHUNG_POT.h - 3);

      w.s = {
        potX,
        potY,
        stars: Array.from({ length: Math.round(clamp(area / 25, 20, 60) * density) }, () => ({
          x: rnd(0, w.cols),
          y: rnd(0, w.rows * 0.55),
          tw: rnd(0.8, 3.0),
          ph: Math.random() * Math.PI * 2,
          color: pick(['#fef08a', '#ffffff', '#fed7aa', '#fde047']),
          ch: pick(['.', '·', '+', '*']),
        })),
        rockets: [],
        sparks: [],
        nextRocket: rnd(1.0, 2.5),
        flash: 0,
        flashCol: '#ef4444',
        flashX: 0,
        flashY: 0,
        embers: Array.from({ length: Math.round(22 * density) }, () => ({
          x: potX + rnd(1, BANH_CHUNG_POT.w - 1),
          y: potY + BANH_CHUNG_POT.h + rnd(0, 1),
          vx: rnd(-1.5, 1.5),
          vy: rnd(-3, -7),
          life: rnd(0.8, 2.2),
          maxLife: rnd(1.5, 2.5),
          color: pick(['#fbbf24', '#f97316', '#ef4444', '#fef08a']),
        })),
        steam: Array.from({ length: Math.round(18 * density) }, () => ({
          x: potX + rnd(2, BANH_CHUNG_POT.w - 2),
          y: potY - rnd(0, 2),
          vx: rnd(-0.6, 0.6),
          vy: rnd(-1.5, -3.2),
          life: rnd(1.2, 2.8),
          maxLife: rnd(2.0, 3.2),
        })),
        petals: Array.from({ length: Math.round(clamp(area / 30, 16, 45) * density) }, () => ({
          x: rnd(0, w.cols),
          y: rnd(0, w.rows),
          vx: rnd(-1.2, -0.4),
          vy: rnd(0.8, 1.8),
          color: pick(['#fde047', '#fbbf24', '#f472b6', '#fda4af']),
          ch: pick(['°', '*', '+', '·']),
          ph: Math.random() * Math.PI * 2,
        })),
        sparklers: [],
        mouseTimer: 0,
      };
    },
    frame(w, dt) {
      const s = w.s;
      const t = w.t;
      const sp = cfg.speed || 1.0;
      const mouse = w.mouse;
      const hasMouse = !!(mouse && mouse.active);
      const potX = s.potX;
      const potY = s.potY;

      // Twinkling stars in upper sky
      for (const st of s.stars) {
        const a = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * st.tw + st.ph));
        w.glyph(st.x, st.y, st.ch, st.color, a);
      }

      // 1. Dynamic Leaping Hearth Flames underneath the pot
      const fireW = BANH_CHUNG_POT.w + 2;
      const fireBaseY = potY + BANH_CHUNG_POT.h;
      const hearthBreath = 0.85 + 0.15 * Math.sin(t * 7);
      w.glow(potX + BANH_CHUNG_POT.w / 2, fireBaseY, fireW * 1.6, '#f97316', 0.42 * hearthBreath);
      w.glow(potX + BANH_CHUNG_POT.w / 2, fireBaseY - 1, fireW * 0.9, '#ef4444', 0.48 * hearthBreath);

      for (let fx = 0; fx < fireW; fx++) {
        const colX = potX - 1 + fx;
        const wave = Math.sin(t * 8 + fx * 1.4) * 1.2 + Math.cos(t * 13 + fx * 2.8) * 0.8;
        const flameH = Math.max(1, Math.round(2.6 + wave));
        for (let fy = 0; fy < flameH; fy++) {
          const cy = fireBaseY - fy;
          if (cy <= potY) continue;
          let fgCol = '#ef4444';
          let bgCol = '#7f1d1d';
          let ch = '#';
          if (fy === 0) {
            fgCol = '#fef08a';
            bgCol = '#f59e0b';
            ch = '#';
          } else if (fy === 1) {
            fgCol = '#fbbf24';
            bgCol = '#ea580c';
            ch = '~';
          } else {
            fgCol = '#ef4444';
            bgCol = null;
            ch = '^';
          }
          w.tile(colX, cy, bgCol, fgCol, ch, 0.92);
        }
      }

      // 2. Rising Steam from the Bánh Chưng Pot
      for (let i = 0; i < s.steam.length; i++) {
        const p = s.steam[i];
        p.life -= dt * sp;
        p.x += (p.vx + Math.sin(t * 2 + p.y * 0.4) * 0.35) * dt * sp * 10;
        p.y += p.vy * dt * sp * 8;
        if (p.life <= 0 || p.y < potY - 18) {
          s.steam[i] = {
            x: potX + rnd(2, BANH_CHUNG_POT.w - 2),
            y: potY - rnd(0, 1.5),
            vx: rnd(-0.6, 0.6),
            vy: rnd(-1.5, -3.2),
            life: rnd(1.4, 3.0),
            maxLife: rnd(2.0, 3.2),
          };
          continue;
        }
        const a = clamp((p.life / p.maxLife) * 0.7, 0.05, 0.75);
        const ch = p.life < p.maxLife * 0.4 ? '·' : p.life < p.maxLife * 0.7 ? '°' : '~';
        w.glyph(p.x, p.y, ch, '#cbd5e1', a);
      }

      // 3. Glowing Fire Embers
      for (let i = 0; i < s.embers.length; i++) {
        const e = s.embers[i];
        e.life -= dt * sp;
        e.x += (e.vx + Math.sin(t * 3 + i) * 0.4) * dt * sp * 10;
        e.y += e.vy * dt * sp * 8;
        if (e.life <= 0 || e.y < potY - 14) {
          s.embers[i] = {
            x: potX + rnd(1, BANH_CHUNG_POT.w - 1),
            y: fireBaseY + rnd(0, 0.8),
            vx: rnd(-1.5, 1.5),
            vy: rnd(-3, -7),
            life: rnd(0.8, 2.2),
            maxLife: rnd(1.5, 2.5),
            color: pick(['#fbbf24', '#f97316', '#ef4444', '#fef08a']),
          };
          continue;
        }
        const a = clamp(e.life / e.maxLife, 0.1, 1);
        w.glyph(e.x, e.y, e.life < 0.6 ? '·' : '*', e.color, a);
      }

      // 4. Falling Spring Blossom Petals (Mai & Đào)
      for (let i = 0; i < s.petals.length; i++) {
        const pt = s.petals[i];
        pt.x += (pt.vx + Math.sin(t * 1.8 + pt.ph) * 0.5) * dt * sp * 7;
        pt.y += pt.vy * dt * sp * 6;
        if (pt.y > w.rows + 2 || pt.x < -3) {
          pt.x = rnd(w.cols * 0.4, w.cols + 4);
          pt.y = rnd(-4, -1);
          pt.ph = Math.random() * Math.PI * 2;
        }
        w.glyph(pt.x, pt.y, pt.ch, pt.color, 0.85);
      }

      // 5. Grand Giao Thừa Fireworks System
      s.nextRocket -= dt * sp;
      if (s.nextRocket <= 0) {
        s.rockets.push(spawnRocket(w));
        s.nextRocket = rnd(1.6, 3.2);
      }

      // Handle sky flash glow from recent explosion
      if (s.flash > 0) {
        s.flash -= dt;
        w.glow(s.flashX, s.flashY, Math.min(w.cols, w.rows) * 0.45, s.flashCol, clamp(s.flash * 0.6, 0, 0.4));
      }

      // Update rockets
      for (let i = s.rockets.length - 1; i >= 0; i--) {
        const rk = s.rockets[i];
        rk.x += rk.vx * dt * sp;
        rk.y += rk.vy * dt * sp;
        rk.vy += 12 * dt * sp; // slight deceleration
        rk.life += dt;

        // Spark trail behind rocket
        w.glyph(rk.x, rk.y, '^', '#ffffff', 0.95);
        w.glyph(rk.x - rk.vx * 0.04, rk.y + 1.2, '!', pick(rk.pal.colors), 0.7);
        w.glyph(rk.x - rk.vx * 0.08, rk.y + 2.4, '·', '#f97316', 0.45);

        // Detonation condition
        if (rk.y <= rk.targetY || rk.vy >= -4 || rk.life > 2.0) {
          s.sparks.push(...explodeFirework(rk, w));
          s.flash = 0.28;
          s.flashX = rk.x;
          s.flashY = rk.y;
          s.flashCol = rk.pal.colors[0];
          s.rockets.splice(i, 1);
        }
      }

      // Update bursting firework sparks
      for (let i = s.sparks.length - 1; i >= 0; i--) {
        const spk = s.sparks[i];
        spk.life -= dt * sp;
        spk.x += spk.vx * dt * sp;
        spk.y += spk.vy * dt * sp;
        spk.vy += 9.5 * dt * sp; // gravity
        spk.vx *= 0.96; // drag

        if (spk.life <= 0 || spk.y > w.rows + 3) {
          s.sparks.splice(i, 1);
          continue;
        }

        const a = clamp(spk.life / spk.maxLife, 0.05, 1);
        const ch = spk.life > spk.maxLife * 0.5 ? spk.ch : spk.life > spk.maxLife * 0.2 ? '·' : '.';
        w.glyph(spk.x, spk.y, ch, spk.color, a);
      }

      // 6. Interactive Mouse FX: Pháo Bông Cầm Tay (Sparkler)
      if (hasMouse) {
        w.glow(mouse.x, mouse.y, 5.0, '#f59e0b', 0.45);
        w.glyph(mouse.x, mouse.y, '★', '#fef08a', 1.0);

        // Emit sparkling sparks from cursor
        const sparkCount = rint(3, 6);
        for (let k = 0; k < sparkCount; k++) {
          const ang = Math.random() * Math.PI * 2;
          const v = rnd(4, 18);
          s.sparklers.push({
            x: mouse.x,
            y: mouse.y,
            vx: Math.cos(ang) * v,
            vy: Math.sin(ang) * v,
            life: rnd(0.18, 0.42),
            color: pick(['#fef08a', '#ffffff', '#fde047', '#f97316', '#fb7185']),
          });
        }

        // Periodic celebratory mini rocket when moving mouse
        s.mouseTimer += dt;
        if (s.mouseTimer > 2.0 && Math.hypot(mouse.vx, mouse.vy) > 0.8) {
          s.rockets.push(spawnRocket(w, mouse.x, mouse.y));
          s.mouseTimer = 0;
        }
      }

      // Update mouse sparkler particles
      for (let i = s.sparklers.length - 1; i >= 0; i--) {
        const spk = s.sparklers[i];
        spk.life -= dt;
        spk.x += spk.vx * dt;
        spk.y += spk.vy * dt;
        if (spk.life <= 0) {
          s.sparklers.splice(i, 1);
          continue;
        }
        w.glyph(spk.x, spk.y, spk.life > 0.2 ? '*' : '·', spk.color, spk.life * 2.8);
      }
    },
  });

  const ITEMS = THEMES.map((t) => t.id).concat('off');
  const byId = (id) => THEMES.find((t) => t.id === id);

  /* --------------------------------------------------------------- settings */

  const KEY = 'pixel-themes:v1';
  const cfg = { theme: 'vn', veil: 0.2, glass: 0.72, motion: true, button: true, density: 1.0, speed: 1.0, autoCycle: false };
  try {
    Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch (e) {
    /* storage blocked: keep defaults */
  }
  if (!ITEMS.includes(cfg.theme)) cfg.theme = 'vn';
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch (e) {
      /* ignore */
    }
  };

  /* ----------------------------------------------------------------- styles */

  const PAGE_CSS = `
html[data-pxt-on], html[data-pxt-on] body { background-color: transparent !important; background-image: none !important; }
html[data-pxt-on] [data-pxt="clear"] { background-color: transparent !important; background-image: none !important; }
html[data-pxt-on] [data-pxt="glass"] {
  background-color: rgba(var(--pxt-rgb), var(--pxt-alpha, .72)) !important;
  background-image: none !important;
  -webkit-backdrop-filter: blur(var(--pxt-blur, 12px)) saturate(1.35);
  backdrop-filter: blur(var(--pxt-blur, 12px)) saturate(1.35);
}
canvas[data-pxt-ui="bg"] { position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; z-index: -1 !important; pointer-events: none !important; display: none; }
html[data-pxt-on] canvas[data-pxt-ui="bg"] { display: block !important; }
`;

  const UI_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.fab {
  position: fixed; right: 12px; top: 50%; transform: translateY(-50%); z-index: 2147483000;
  width: 36px; height: 36px; padding: 0; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(255,255,255,.4); background: rgba(24,24,28,.35);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  display: grid; grid-template-columns: repeat(3, 6px); grid-auto-rows: 6px; gap: 2px; place-content: center;
  opacity: .6; transition: opacity .2s;
}
.fab:hover, .fab:focus-visible { opacity: 1; }
.fab i { display: block; border-radius: 1.5px; }
.panel {
  position: fixed; left: 50%; transform: translateX(-50%); z-index: 2147483001;
  width: min(760px, calc(100vw - 20px)); padding: 10px 10px 8px; border-radius: 14px;
  color: #1d1d1f; background: rgba(255,255,255,.88); border: 1px solid rgba(0,0,0,.08);
  box-shadow: 0 12px 40px rgba(0,0,0,.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.4); backdrop-filter: blur(18px) saturate(1.4);
  font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
.panel.dark { color: #f2f2f2; background: rgba(30,30,32,.88); border-color: rgba(255,255,255,.1); }
.hd { display: flex; align-items: center; gap: 10px; padding: 0 4px 8px; }
.cmd { font: 600 11px/1 ui-monospace, Menlo, Consolas, monospace; padding: 4px 6px; border-radius: 5px; background: rgba(127,127,127,.18); }
.ttl { opacity: .7; }
.hint { margin-left: auto; opacity: .55; font-size: 11px; white-space: nowrap; }
.note { padding: 0 4px 6px; font-size: 11px; opacity: .7; }
.list { position: relative; display: flex; flex-wrap: wrap; gap: 10px 8px; max-height: min(52vh, 420px); overflow-y: auto; padding: 3px 3px 8px; scrollbar-width: thin; }
.it { flex: 0 0 auto; width: 84px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.th { display: block; width: 84px; height: 54px; border-radius: 8px; overflow: hidden; outline: 2px solid transparent; outline-offset: 1px; background: rgba(127,127,127,.2); }
.th canvas { display: block; width: 100%; height: 100%; }
.it:hover .th { outline-color: rgba(47,124,246,.45); }
.it.sel .th { outline-color: #2f7cf6; }
.nm { display: block; margin-top: 4px; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.it.cur .nm::after { content: " \\2713"; color: #2f7cf6; }
.off { display: grid; place-items: center; height: 100%; font-weight: 600; letter-spacing: .08em; opacity: .7;
  background: repeating-linear-gradient(45deg, rgba(127,127,127,.22) 0 6px, transparent 6px 12px); }
.ctl { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; padding: 8px 4px 0; border-top: 1px solid rgba(127,127,127,.2); }
.ctl label { display: flex; align-items: center; gap: 6px; font-size: 11px; opacity: .85; cursor: pointer; }
.ctl input[type=range] { width: 96px; accent-color: #2f7cf6; }
.ctl input[type=checkbox] { accent-color: #2f7cf6; }
@media (pointer: coarse) {
  .hint { display: none; }
  .fab { width: 42px; height: 42px; grid-template-columns: repeat(3, 7px); grid-auto-rows: 7px; }
  .it, .th { width: 92px; }
  .th { height: 60px; }
  .ctl input[type=range] { width: 120px; }
}
`;

  function sheet(css, target) {
    try {
      const s = new CSSStyleSheet();
      s.replaceSync(css);
      target.adoptedStyleSheets = [...target.adoptedStyleSheets, s];
      return;
    } catch (e) {
      /* older browser: fall back to a <style> element */
    }
    const el = document.createElement('style');
    el.textContent = css;
    (target === document ? document.head || document.documentElement : target).appendChild(el);
  }

  /* ---------------------------------------------------- background scanner */

  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  const colors = new Map();

  // Any CSS color (rgb, hsl, oklch, ...) -> {r, g, b, a}.
  function toRGBA(s) {
    if (!s || s === 'transparent') return null;
    if (colors.has(s)) return colors.get(s);
    let v = null;
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(s);
    if (m) {
      v = { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : m[5] ? m[4] / 100 : +m[4] };
    } else {
      pctx.fillStyle = '#010203';
      pctx.fillStyle = s;
      if (pctx.fillStyle !== '#010203') {
        pctx.clearRect(0, 0, 1, 1);
        pctx.fillRect(0, 0, 1, 1);
        const d = pctx.getImageData(0, 0, 1, 1).data;
        v = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
      }
    }
    if (colors.size > 500) colors.clear();
    colors.set(s, v);
    return v;
  }

  const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;

  // Saturated colors are buttons / badges: leave them alone.
  function accent(c) {
    const r = c.r / 255;
    const g = c.g / 255;
    const b = c.b / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const d = mx - mn;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return s > 0.4 && l > 0.18 && l < 0.85;
  }

  const SKIP = /^(IMG|VIDEO|CANVAS|SVG|IFRAME|PICTURE|INPUT|SELECT|OPTION|SCRIPT|STYLE|LINK|META|HEAD|BR|HR|PATH|G|USE|HTML|BODY)$/i;
  const UI_SEL = 'button, a, label, [role="button"], [role="menuitem"], [role="option"], [role="tab"]';
  const OVERLAY_SEL = 'dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"], [data-radix-popper-content-wrapper]';

  const glassColor = new WeakMap();

  function mark(el, kind, c) {
    if (kind === 'glass') {
      glassColor.set(el, c);
      el.style.setProperty('--pxt-rgb', `${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}`);
    }
    el.setAttribute('data-pxt', kind);
  }

  function classify(el, vw, vh, area) {
    if (el.nodeType !== 1 || el.hasAttribute('data-pxt') || el.hasAttribute('data-pxt-ui') || SKIP.test(el.tagName)) return;
    const cs = getComputedStyle(el);
    // Inline boxes (code chips, highlights) keep their look: a blurred inline box
    // that wraps across lines would blur the text next to it.
    if (cs.display === 'none' || cs.display === 'inline' || cs.display === 'contents' || cs.visibility === 'hidden') return;
    const img = cs.backgroundImage;
    const grad = img !== 'none' && /gradient/.test(img);
    if (img !== 'none' && !grad) return;
    const c = toRGBA(cs.backgroundColor);
    const solid = c && c.a >= 0.6;
    if (!solid && !grad) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const ratio = (Math.min(r.width, vw) * Math.min(r.height, vh)) / area;
    const ui = el.matches(UI_SEL);
    // Drawers, popovers and modals float above other content, so they need glass, not a hole.
    const floating = el.closest(OVERLAY_SEL) || ((cs.position === 'fixed' || cs.position === 'absolute') && cs.zIndex !== 'auto' && ratio < 0.95);

    if (ratio >= 0.4 && !floating) return mark(el, 'clear');
    if (!solid) {
      // Fade gradients (e.g. above the composer) would paint a band of solid color.
      if (!ui && ratio >= 0.02) mark(el, 'clear');
      return;
    }
    if (ratio < 0.0015 || accent(c) || (ui && ratio < 0.03)) return;
    const outer = el.parentElement && el.parentElement.closest('[data-pxt="glass"]');
    if (outer) {
      // Same-colored wrapper inside a glass panel: drop it so the alpha doesn't stack.
      const o = glassColor.get(outer);
      if (!o || Math.abs(o.r - c.r) + Math.abs(o.g - c.g) + Math.abs(o.b - c.b) < 24) return mark(el, 'clear');
      if (ratio < 0.02) return;
    }
    mark(el, 'glass', c);
  }

  // The veil and the picker follow the page's light/dark mode, read from its text color.
  function computeDark() {
    const els = document.body ? document.body.querySelectorAll('p, li, h1, h2, h3, button, a') : [];
    let n = 0;
    let light = 0;
    for (const el of els) {
      if (n >= 24) break;
      if (!el.textContent.trim()) continue;
      const c = toRGBA(getComputedStyle(el).color);
      if (!c || c.a < 0.3) continue;
      n++;
      if (lum(c) > 0.55) light++;
    }
    if (!n) {
      const c = document.body && toRGBA(getComputedStyle(document.body).color);
      return c ? lum(c) > 0.55 : matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return light / n > 0.5;
  }

  let scanning = false;
  let sampleTimer = 0;
  let flushTimer = 0;
  const deepQ = new Set();
  const shallowQ = new Set();

  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) if (n.nodeType === 1) deepQ.add(n);
      } else if (m.target.nodeType === 1 && !m.target.hasAttribute('data-pxt')) {
        shallowQ.add(m.target);
      }
    }
    if (!flushTimer) flushTimer = setTimeout(flush, 250);
  });

  function flush() {
    flushTimer = 0;
    const vw = innerWidth;
    const vh = innerHeight;
    const area = vw * vh;
    let budget = 3000;
    for (const el of deepQ) {
      if (!el.isConnected) continue;
      classify(el, vw, vh, area);
      const all = el.getElementsByTagName('*');
      for (let i = 0; i < all.length && budget > 0; i++, budget--) classify(all[i], vw, vh, area);
    }
    for (const el of shallowQ) if (el.isConnected) classify(el, vw, vh, area);
    deepQ.clear();
    shallowQ.clear();
  }

  function fullScan() {
    const all = document.body.getElementsByTagName('*');
    const vw = innerWidth;
    const vh = innerHeight;
    const area = vw * vh;
    let i = 0;
    (function chunk() {
      if (!scanning) return;
      const end = Math.min(all.length, i + 600);
      for (; i < end; i++) classify(all[i], vw, vh, area);
      if (i < all.length && i < 20000) setTimeout(chunk, 16);
    })();
  }

  // Catches elements that were hidden during the first scan and shown later.
  function sample() {
    if (document.hidden) return;
    const vw = innerWidth;
    const vh = innerHeight;
    const area = vw * vh;
    const seen = new Set();
    for (let i = 1; i < 7; i++) {
      for (let j = 1; j < 9; j++) {
        const stack = document.elementsFromPoint((i / 7) * vw, (j / 9) * vh);
        for (let k = stack.length - 1; k >= 0; k--) {
          if (seen.has(stack[k])) continue;
          seen.add(stack[k]);
          classify(stack[k], vw, vh, area);
        }
      }
    }
    const d = computeDark();
    if (d !== siteDark) {
      siteDark = d;
      syncPanel();
      if (!raf) paint(0);
    }
  }

  function startScan() {
    if (scanning) return;
    scanning = true;
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    fullScan();
    sampleTimer = setInterval(sample, 3000);
    setTimeout(sample, 600);
  }

  function stopScan() {
    if (!scanning) return;
    scanning = false;
    mo.disconnect();
    clearInterval(sampleTimer);
    clearTimeout(flushTimer);
    flushTimer = 0;
    deepQ.clear();
    shallowQ.clear();
  }

  /* --------------------------------------------------------------- renderer */

  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const FPS = matchMedia('(pointer: coarse)').matches ? 10 : 12;
  let siteDark = false;
  let canvas = null;
  let world = null;
  let curId = 'off';
  let raf = 0;
  let last = 0;

  function measure() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    const cell = Math.min(w, h) < 560 ? 11 : 14;
    // Keep the backing store under ~6M pixels on big screens.
    const dpr = clamp(Math.min(devicePixelRatio || 1, 2, Math.sqrt(6e6 / (w * h))), 1, 2);
    return { w, h, cell, dpr };
  }

  function ensureCanvas() {
    if (canvas && canvas.isConnected) return;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.setAttribute('data-pxt-ui', 'bg');
      canvas.setAttribute('aria-hidden', 'true');
      world = new World(canvas);
      if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);
      addEventListener('resize', onResize);
    }
    root.appendChild(canvas);
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeNow, 120);
  }

  function resizeNow() {
    if (!world || !world.th || curId === 'off') return;
    const m = measure();
    if (Math.abs(m.w - world.w) < 1 && Math.abs(m.h - world.h) < 1 && m.dpr === world.dpr) return;
    const { cols, rows, cell } = world;
    world.resize(m.w, m.h, m.cell, m.dpr);
    // Small changes (mobile toolbars) keep the scene; big ones rebuild it.
    if (m.cell !== cell || Math.abs(world.cols - cols) / cols > 0.25 || Math.abs(world.rows - rows) / rows > 0.25) world.setTheme(world.th);
    paint(0);
    if (open) place();
  }

  let mouse = { x: -999, y: -999, vx: 0, vy: 0, last: 0, active: false };
  window.addEventListener(
    'pointermove',
    (e) => {
      const now = performance.now();
      const dt = Math.max(0.016, (now - (mouse.last || now)) / 1000);
      const nx = e.clientX;
      const ny = e.clientY;
      if (mouse.last && dt > 0) {
        mouse.vx = clamp((nx - mouse.x) / dt / 30, -10, 10);
        mouse.vy = clamp((ny - mouse.y) / dt / 30, -10, 10);
      }
      mouse.x = nx;
      mouse.y = ny;
      mouse.last = now;
      mouse.active = true;
    },
    { passive: true },
  );

  function paint(dt) {
    if (!world || !world.th) return;
    world.veilColor = siteDark ? '#141413' : '#fbfaf6';
    world.veil = clamp(cfg.veil * (world.th.veilScale || 1) + (world.th.dark === siteDark ? 0 : 0.42), 0, 0.9);
    const now = performance.now();
    world.mouse = {
      x: mouse.x / world.cell,
      y: mouse.y / world.cell,
      vx: mouse.vx || 0,
      vy: mouse.vy || 0,
      active: mouse.active && now - mouse.last < 800,
    };
    mouse.vx *= 0.85;
    mouse.vy *= 0.85;
    world.draw(dt);
  }

  const running = () => curId !== 'off' && cfg.motion && !reduce.matches && !document.hidden;

  function loop(now) {
    raf = 0;
    if (!running()) return;
    raf = requestAnimationFrame(loop);
    if (last && now - last < 1000 / FPS - 2) return;
    const dt = last ? Math.min(0.2, (now - last) / 1000) : 1 / FPS;
    last = now;
    paint(dt);
  }

  function startLoop() {
    if (!raf && running()) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  document.addEventListener('visibilitychange', () => (document.hidden ? stopLoop() : startLoop()));

  function applyTheme(id) {
    const th = byId(id);
    if (!th) {
      root.removeAttribute('data-pxt-on');
      stopLoop();
      stopScan();
      curId = 'off';
      syncPanel();
      return;
    }
    ensureCanvas();
    root.setAttribute('data-pxt-on', '');
    root.style.setProperty('--pxt-alpha', String(cfg.glass));
    root.style.setProperty('--pxt-blur', cfg.glass >= 0.95 ? '0px' : '12px');
    siteDark = computeDark();
    const m = measure();
    if (m.w !== world.w || m.h !== world.h || m.dpr !== world.dpr || m.cell !== world.cell) world.resize(m.w, m.h, m.cell, m.dpr);
    if (curId !== id) {
      world.setTheme(th);
      curId = id;
    }
    syncPanel();
    startScan();
    paint(0);
    startLoop();
  }

  /* --------------------------------------------------------------------- UI */

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v != null && v !== false) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }

  const FAB_COLORS = ['#86c3f2', '#ffffff', '#d97757', '#34b6c4', '#ff8fc8', '#d9ff6e', '#b49cff', '#fff2c7', '#ff7b2e'];

  let host = null;
  let fab = null;
  let panel = null;
  let note = null;
  let list = null;
  let items = [];
  let open = false;
  let fromCmd = false;
  let editor = null;
  let anchor = null;
  let sel = 0;

  function thumb(th) {
    const cv = document.createElement('canvas');
    const w = new World(cv);
    w.resize(92, 60, 4, 2);
    w.setTheme(th);
    w.draw(0.5);
    w.draw(0.5);
    return cv;
  }

  function buildUI() {
    host = h('div', { 'data-pxt-ui': 'host' });
    const sh = host.attachShadow({ mode: 'open' });
    sheet(UI_CSS, sh);

    fab = h(
      'button',
      { class: 'fab', type: 'button', title: 'Pixel themes  (/theme · Alt+T)', 'aria-label': 'Đổi hình nền pixel', onclick: () => (open ? closePicker(false) : openPicker(null, false)) },
      FAB_COLORS.map((c) => {
        const i = h('i');
        i.style.setProperty('background', c);
        return i;
      }),
    );
    fab.hidden = !cfg.button;

    panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Chọn hình nền pixel', hidden: true });
    sh.append(fab, panel);
    root.appendChild(host);
  }

  function buildPanel() {
    list = h('div', { class: 'list', role: 'listbox', 'aria-label': 'Themes' });
    items = ITEMS.map((id, i) => {
      const th = byId(id);
      const btn = h(
        'button',
        {
          class: 'it',
          type: 'button',
          role: 'option',
          onclick: () => {
            sel = i;
            commit(id);
            if (fromCmd) {
              fromCmd = false;
              clearEditor(editor);
            }
          },
        },
        h('span', { class: 'th' }, th ? thumb(th) : h('span', { class: 'off' }, 'OFF')),
        h('span', { class: 'nm' }, th ? th.name : 'Tắt'),
      );
      list.append(btn);
      return btn;
    });

    const range = (label, min, max, key, after) =>
      h(
        'label',
        null,
        label,
        h('input', {
          type: 'range',
          min,
          max,
          step: '0.05',
          value: String(cfg[key]),
          oninput: (e) => {
            cfg[key] = +e.target.value;
            save();
            after();
          },
        }),
      );
    const check = (label, key, after) =>
      h(
        'label',
        null,
        h('input', {
          type: 'checkbox',
          checked: cfg[key],
          onchange: (e) => {
            cfg[key] = e.target.checked;
            save();
            after();
          },
        }),
        label,
      );

    note = h('div', { class: 'note', hidden: true });
    panel.append(
      h('div', { class: 'hd' }, h('span', { class: 'cmd' }, '/theme'), h('span', { class: 'ttl' }, 'Pixel wallpapers'), h('span', { class: 'hint' }, '← → chọn · ↵ áp dụng · esc đóng')),
      note,
      list,
      h(
        'div',
        { class: 'ctl' },
        range('Làm dịu nền', '0', '0.8', 'veil', () => {
          if (!raf) paint(0);
        }),
        range('Độ đục khung', '0.3', '0.95', 'glass', () => {
          root.style.setProperty('--pxt-alpha', String(cfg.glass));
          root.style.setProperty('--pxt-blur', cfg.glass >= 0.95 ? '0px' : '12px');
        }),
        range('Mật độ', '0.5', '2.0', 'density', () => {
          if (world && world.th && world.th.init) world.th.init(world);
          if (!raf) paint(0);
        }),
        range('Tốc độ', '0.5', '2.0', 'speed', () => {}),
        check('Chuyển động', 'motion', () => {
          if (cfg.motion) startLoop();
          else stopLoop();
        }),
        check('Tự đổi ngày/đêm', 'autoCycle', () => {
          checkAutoCycle(true);
        }),
        check('Nút nổi', 'button', () => {
          fab.hidden = !cfg.button;
        }),
      ),
    );
  }

  function syncPanel() {
    if (!panel) return;
    panel.classList.toggle('dark', siteDark);
    if (!note) return;
    const th = byId(curId);
    note.hidden = !th || th.dark === siteDark;
    note.textContent = th && th.dark ? 'Theme tối: bật giao diện Dark của trang để màu rõ hơn.' : 'Theme sáng: hợp với giao diện Light của trang hơn.';
  }

  function highlight() {
    syncPanel();
    items.forEach((b, i) => {
      b.classList.toggle('sel', i === sel);
      b.classList.toggle('cur', ITEMS[i] === cfg.theme);
      b.setAttribute('aria-selected', String(i === sel));
    });
    // The grid wraps; on a short screen it scrolls vertically to keep the selection in view.
    const b = items[sel];
    if (b && list) {
      const T = b.offsetTop;
      const B = T + b.offsetHeight;
      if (T < list.scrollTop) list.scrollTop = T - 4;
      else if (B > list.scrollTop + list.clientHeight) list.scrollTop = B - list.clientHeight + 4;
    }
  }

  function place() {
    const a = anchor && anchor.isConnected ? (anchor.closest('fieldset, form') || anchor).getBoundingClientRect() : null;
    const ph = panel.offsetHeight;
    const pw = panel.offsetWidth;
    const vh = innerHeight;
    const vw = document.documentElement.clientWidth || innerWidth;
    let top = vh - ph - 96;
    if (a && a.top - ph - 10 > 8) top = a.top - ph - 10;
    else if (a && a.bottom + ph + 10 < vh) top = a.bottom + 10;
    panel.style.setProperty('top', Math.max(8, top) + 'px');
    panel.style.setProperty('left', clamp(a ? a.left + a.width / 2 : vw / 2, pw / 2 + 10, vw - pw / 2 - 10) + 'px');
  }

  function openPicker(anchorEl, cmd) {
    if (!items.length) buildPanel();
    open = true;
    fromCmd = !!cmd;
    anchor = anchorEl;
    sel = Math.max(0, ITEMS.indexOf(cfg.theme));
    panel.hidden = false;
    highlight();
    place();
  }

  function closePicker(keep) {
    if (!open) return;
    if (!keep && curId !== cfg.theme) applyTheme(cfg.theme);
    open = false;
    fromCmd = false;
    anchor = null;
    panel.hidden = true;
  }

  function move(d) {
    sel = (sel + d + ITEMS.length) % ITEMS.length;
    applyTheme(ITEMS[sel]); // live preview, saved only on Enter / click
    highlight();
  }

  function commit(id) {
    cfg.theme = id;
    save();
    applyTheme(id);
    if (open) highlight();
  }

  function findTheme(q) {
    q = strip(q);
    if (!q) return -1;
    if (/^(off|tat|none|0)$/.test(q)) return ITEMS.indexOf('off');
    const exact = THEMES.findIndex((t) => t.id === q || strip(t.name) === q || t.alias.includes(q));
    if (exact >= 0) return exact;
    return THEMES.findIndex((t) => t.id.startsWith(q) || strip(t.name).includes(q) || t.alias.some((a) => a.startsWith(q)));
  }

  /* ------------------------------------------------------- /theme command */

  // "/thêm" and "/nen" are there because Vietnamese Telex keyboards turn "theme" into "thêm".
  const CMD = /^\/(theme|thêm|them|nen|nền)(?:\s+(.*))?$/iu;

  function editableRoot(t) {
    if (!t || t.nodeType !== 1) return null;
    if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|search)$/i.test(t.type))) return t;
    return t.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
  }

  const textOf = (el) => (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.innerText || '');

  function clearEditor(el) {
    if (!el || !el.isConnected) return;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
    if (!document.execCommand('delete', false)) el.textContent = '';
  }

  function runCommand(text) {
    const m = CMD.exec(String(text).normalize('NFC').trim());
    if (!m) return false;
    const i = m[2] ? findTheme(m[2]) : -1;
    if (i >= 0) commit(ITEMS[i]);
    else openPicker(null, false);
    return true;
  }

  document.addEventListener(
    'input',
    (e) => {
      const el = editableRoot(e.target);
      if (!el || (host && host.contains(el))) return;
      const m = CMD.exec(textOf(el).normalize('NFC').trim());
      if (m) {
        editor = el;
        if (!open) openPicker(el, true);
        fromCmd = true;
        const i = m[2] ? findTheme(m[2]) : -1;
        if (i >= 0 && i !== sel) {
          sel = i;
          applyTheme(ITEMS[i]);
          highlight();
        }
      } else if (open && fromCmd) {
        closePicker(false);
      }
    },
    true,
  );

  addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && (e.code === 'ArrowRight' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const curIdx = Math.max(0, ITEMS.indexOf(cfg.theme));
        const nextIdx = (curIdx + 1) % ITEMS.length;
        commit(ITEMS[nextIdx]);
        return;
      }
      if (e.altKey && e.shiftKey && (e.code === 'ArrowLeft' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const curIdx = Math.max(0, ITEMS.indexOf(cfg.theme));
        const prevIdx = (curIdx - 1 + ITEMS.length) % ITEMS.length;
        commit(ITEMS[prevIdx]);
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyT') {
        e.preventDefault();
        if (open) closePicker(false);
        else openPicker(editableRoot(document.activeElement), false);
        return;
      }
      if (!open || e.isComposing) return;
      const target = e.composedPath()[0];
      if (target && target.tagName === 'INPUT' && target.type === 'range') return;
      // Opened from the button while the user types elsewhere: only Esc belongs to us.
      if (!fromCmd && editableRoot(document.activeElement) && e.key !== 'Escape') return;
      const stop = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        stop();
        move(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        stop();
        const wasCmd = fromCmd;
        commit(ITEMS[sel]);
        closePicker(true);
        if (wasCmd) clearEditor(editor);
      } else if (e.key === 'Escape') {
        stop();
        closePicker(false);
      }
    },
    true,
  );

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (open && !e.composedPath().includes(host) && !(fromCmd && e.composedPath().includes(editor))) closePicker(false);
    },
    true,
  );

  addEventListener('resize', () => open && place());
  if (window.visualViewport) visualViewport.addEventListener('resize', () => open && place());
  reduce.addEventListener && reduce.addEventListener('change', () => (running() ? startLoop() : (stopLoop(), paint(0))));

  /* ------------------------------------------------------------------- boot */

  window.__pixelThemes = {
    themes: ITEMS.slice(),
    get current() {
      return cfg.theme;
    },
    set(id) {
      if (!ITEMS.includes(id)) return false;
      commit(id);
      return true;
    },
    open: () => openPicker(null, false),
    close: () => closePicker(true),
    command: runCommand,
  };

  function checkAutoCycle(force) {
    if (!cfg.autoCycle) return;
    const hr = new Date().getHours();
    const isDay = hr >= 6 && hr < 18;
    const target = isDay ? 'sakura' : 'hoian';
    if (cfg.theme !== target || force) {
      commit(target);
    }
  }

  function boot() {
    if (!document.body) {
      setTimeout(boot, 50);
      return;
    }
    sheet(PAGE_CSS, document);
    buildUI();
    if (cfg.autoCycle) checkAutoCycle();
    applyTheme(cfg.theme);
    setInterval(checkAutoCycle, 60000);
    say('✅ Pixel Themes đã chạy. Bấm Alt+T (hoặc nút ô vuông màu ở cạnh phải) để chọn theme.');
  }

  boot();
})();
