import { drawGuide } from './guides.js';

// Explorer interactions on the overlay canvas:
//   drag                          → pan the view
//   two-finger scroll / pinch     → zoom at cursor (trackpad, mouse wheel or touch)
//   select mode or shift+drag     → draw a new selection (aspect locked to stitch W:H, current rotation);
//                                   inside the selection it moves it instead
//   drag a corner handle          → resize selection
//   drag the round knob           → rotate selection (shift snaps to 15°)
//   drag the size tag             → move selection
//   click (no drag)               → deselect: the selection is hidden and inert until a new one is drawn
//                                   (anywhere except the handles, knob and size tag)

const HANDLE = 9;
const KNOB_GAP = 26; // px from the top edge to the rotation knob
const SNAP = Math.PI / 12;

export function toComplex(view, w, h, x, y) {
  return [view.cx + (x - w / 2) * view.scale, view.cy - (y - h / 2) * view.scale];
}

export function toPixel(view, w, h, re, im) {
  return [(re - view.cx) / view.scale + w / 2, (view.cy - im) / view.scale + h / 2];
}

// Selection geometry in canvas pixels. The rectangle's column axis on screen is ax = (cos, −sin)
// and its row axis (downwards) is ay = (sin, cos): screen y points down, rotation is counter-clockwise.
export function selGeometry(sel, aspect, view, w, h) {
  const rot = sel.rot || 0;
  const [cx, cy] = toPixel(view, w, h, sel.cx, sel.cy);
  const hw = sel.w / view.scale / 2, hh = hw * aspect;
  const ax = [Math.cos(rot), -Math.sin(rot)], ay = [Math.sin(rot), Math.cos(rot)];
  const pt = (u, v) => [cx + ax[0] * u + ay[0] * v, cy + ax[1] * u + ay[1] * v];
  return {
    c: [cx, cy], hw, hh, ax, ay, rot, pt,
    corners: [pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)], // TL, TR, BR, BL
    knob: pt(0, -hh - KNOB_GAP),
    top: pt(0, -hh),
  };
}

// Pixel distance and midpoint of the first two active pointers.
function pinchInfo(pointers) {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
}

// Wheel delta → zoom factor. Trackpad pinch arrives as ctrl+wheel with small deltas.
export function wheelZoom(e) {
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  return Math.pow(e.ctrlKey ? 1.01 : 1.0015, dy);
}

const RESIZE_CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
// Resize cursor for a corner direction on screen (angle in radians).
const cursorFor = ang => RESIZE_CURSORS[((Math.round(ang / (Math.PI / 4)) % 4) + 4) % 4];

// api: { getView, setView(view, commit), getSel, setSel(sel, commit), getDims, onSelectModeChange,
//        isSelVisible(), setSelVisible(on), getGuide() → { kind, orient } (framing guide inside the selection) }
export class Selector {
  constructor(canvas, api) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.api = api;
    this.drag = null;
    this.pointers = new Map();
    this.selectMode = false; // one-shot: turns off after a new selection is drawn
    this.labelRect = null;

    canvas.addEventListener('pointerdown', e => this.onDown(e));
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerup', e => this.onUp(e));
    canvas.addEventListener('pointercancel', e => this.onUp(e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
  }

  setSelectMode(on) {
    this.selectMode = on;
    this.canvas.style.cursor = on ? 'crosshair' : '';
    this.api.onSelectModeChange?.(on);
  }

  aspect() {
    const { W, H } = this.api.getDims();
    return H / W;
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [
      (e.clientX - r.left) * (this.canvas.width / r.width),
      (e.clientY - r.top) * (this.canvas.height / r.height),
    ];
  }

  geom() {
    const { width: w, height: h } = this.canvas;
    return selGeometry(this.api.getSel(), this.aspect(), this.api.getView(), w, h);
  }

  visible() {
    return this.api.isSelVisible ? this.api.isSelVisible() : true;
  }

  hit(x, y, selecting) {
    if (!this.visible()) return selecting ? { type: 'new', cursor: 'crosshair' } : { type: 'pan', cursor: 'grab' };
    const g = this.geom();
    if (Math.hypot(x - g.knob[0], y - g.knob[1]) <= HANDLE) return { type: 'rotate', cursor: 'grab' };
    for (let k = 0; k < 4; k++) {
      const [px, py] = g.corners[k];
      if (Math.abs(x - px) <= HANDLE && Math.abs(y - py) <= HANDLE) {
        const [ox, oy] = g.corners[(k + 2) % 4];
        return { type: 'resize', anchor: [ox, oy], cursor: cursorFor(Math.atan2(py - oy, px - ox) + Math.PI / 2) };
      }
    }
    const L = this.labelRect;
    if (L && x >= L.x && x <= L.x + L.w && y >= L.y && y <= L.y + L.h) return { type: 'move', cursor: 'move' };
    if (!selecting) return { type: 'pan', cursor: 'grab' };
    const dx = x - g.c[0], dy = y - g.c[1];
    const u = dx * g.ax[0] + dy * g.ax[1], v = dx * g.ay[0] + dy * g.ay[1];
    if (Math.abs(u) < g.hw && Math.abs(v) < g.hh) return { type: 'move', cursor: 'move' };
    return { type: 'new', cursor: 'crosshair' };
  }

  startPinch() {
    const { dist, mid } = pinchInfo(this.pointers);
    this.drag = { type: 'pinch', dist, mid, view: { ...this.api.getView() } };
  }

  onDown(e) {
    const [x, y] = this.pos(e);
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, [x, y]);
    if (this.pointers.size === 2) return this.startPinch();
    if (this.pointers.size > 2) return;

    const { width: w, height: h } = this.canvas;
    const view = this.api.getView();
    const hit = this.hit(x, y, this.selectMode || e.shiftKey);
    if (hit.type === 'rotate') {
      const g = this.geom();
      this.drag = { type: 'rotate', rot0: g.rot, ang0: Math.atan2(y - g.c[1], x - g.c[0]), c: g.c };
      this.canvas.style.cursor = 'grabbing';
    } else if (hit.type === 'resize') {
      this.drag = { type: 'size', anchor: hit.anchor };
    } else if (hit.type === 'move') {
      const [re, im] = toComplex(view, w, h, x, y);
      const sel = this.api.getSel();
      this.drag = { type: 'move', dre: sel.cx - re, dim: sel.cy - im };
    } else if (hit.type === 'new') {
      this.drag = { type: 'size', anchor: [x, y], fresh: true };
    } else {
      this.drag = { type: 'pan', x, y, view: { ...view } };
      this.canvas.style.cursor = 'grabbing';
    }
    this.drag.x0 = x;
    this.drag.y0 = y;
  }

  onMove(e) {
    const [x, y] = this.pos(e);
    const { width: w, height: h } = this.canvas;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [x, y]);
    const d = this.drag;
    if (!d) {
      this.canvas.style.cursor = this.hit(x, y, this.selectMode || e.shiftKey).cursor;
      return;
    }
    const view = this.api.getView();
    const sel = this.api.getSel();
    if (d.x0 != null && Math.hypot(x - d.x0, y - d.y0) > 4) d.moved = true;
    // Handles, knob and size tag ignore click jitter: nothing changes until the pointer really moves.
    if (!d.moved && (d.type === 'rotate' || d.type === 'move' || (d.type === 'size' && !d.fresh))) return;
    if (d.type === 'pinch') {
      if (this.pointers.size < 2) return;
      const { dist, mid } = pinchInfo(this.pointers);
      const scale = d.view.scale * (d.dist / dist);
      const [re, im] = toComplex(d.view, w, h, d.mid[0], d.mid[1]);
      this.api.setView({ cx: re - (mid[0] - w / 2) * scale, cy: im + (mid[1] - h / 2) * scale, scale }, false);
    } else if (d.type === 'pan') {
      this.api.setView({
        ...d.view,
        cx: d.view.cx - (x - d.x) * d.view.scale,
        cy: d.view.cy + (y - d.y) * d.view.scale,
      }, false);
    } else if (d.type === 'rotate') {
      // Screen angles grow clockwise (y down); rotation is counter-clockwise.
      let rot = d.rot0 - (Math.atan2(y - d.c[1], x - d.c[0]) - d.ang0);
      if (e.shiftKey) rot = Math.round(rot / SNAP) * SNAP;
      rot = Math.atan2(Math.sin(rot), Math.cos(rot)); // keep in (−π, π]
      this.api.setSel({ ...sel, rot }, false);
    } else if (d.type === 'move') {
      const [re, im] = toComplex(view, w, h, x, y);
      this.api.setSel({ ...sel, cx: re + d.dre, cy: im + d.dim }, false);
    } else {
      // Resize / draw in the rectangle's own (rotated) frame, anchored at the fixed corner.
      const g = this.geom();
      const [ax, ay] = d.anchor;
      const a = this.aspect();
      const dx = x - ax, dy = y - ay;
      const du = dx * g.ax[0] + dy * g.ax[1], dv = dx * g.ay[0] + dy * g.ay[1];
      const pw = Math.max(Math.abs(du), Math.abs(dv) / a);
      if (d.fresh && pw < 4) return;
      d.drew = true;
      if (d.fresh && !this.visible()) this.api.setSelVisible(true);
      const su = Math.sign(du || 1) * pw, sv = Math.sign(dv || 1) * pw * a;
      const mx = ax + (g.ax[0] * su + g.ay[0] * sv) / 2, my = ay + (g.ax[1] * su + g.ay[1] * sv) / 2;
      const [re, im] = toComplex(view, w, h, mx, my);
      this.api.setSel({ cx: re, cy: im, w: pw * view.scale, rot: sel.rot || 0 }, false);
    }
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!d) return;
    if (d.type === 'pinch') {
      // Lifting one finger ends the pinch; the other finger doesn't start a pan.
      if (this.pointers.size === 0) {
        this.drag = null;
        this.api.setView(this.api.getView(), true);
      }
      return;
    }
    this.drag = null;
    this.canvas.style.cursor = this.selectMode ? 'crosshair' : '';
    if (d.type === 'pan') {
      // A plain click (no drag) deselects: anywhere except the handles, knob and size tag (those
      // start other drags). Inside the rectangle too, since a plain drag there pans anyway.
      if (!d.moved && this.visible()) this.api.setSelVisible(false);
      else this.api.setView(this.api.getView(), true);
    } else if (d.fresh && !d.drew) {
      // Click in select mode without dragging: nothing to do.
    } else {
      this.api.setSel(this.api.getSel(), true);
      if (d.fresh && d.drew && this.selectMode) this.setSelectMode(false);
    }
  }

  onWheel(e) {
    e.preventDefault();
    const [x, y] = this.pos(e);
    const { width: w, height: h } = this.canvas;
    const view = this.api.getView();
    const [re, im] = toComplex(view, w, h, x, y);
    const scale = view.scale * wheelZoom(e);
    this.api.setView({
      cx: re - (x - w / 2) * scale,
      cy: im + (y - h / 2) * scale,
      scale,
    }, true);
  }

  draw() {
    const { ctx, canvas } = this;
    const { width: w, height: h } = canvas;
    if (!this.visible()) {
      ctx.clearRect(0, 0, w, h);
      this.labelRect = null;
      return;
    }
    const g = this.geom();
    const { W, H } = this.api.getDims();
    const poly = () => {
      ctx.moveTo(...g.corners[0]);
      for (let k = 1; k < 4; k++) ctx.lineTo(...g.corners[k]);
      ctx.closePath();
    };
    ctx.clearRect(0, 0, w, h);

    // Dim everything outside the selection.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    poly();
    ctx.fill('evenodd');

    // 10-stitch guide lines, when they are far enough apart to be useful.
    const step = ((g.hw * 2) / W) * 10;
    if (step > 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 10; i < W; i += 10) {
        const u = -g.hw + (2 * g.hw * i) / W;
        ctx.moveTo(...g.pt(u, -g.hh)); ctx.lineTo(...g.pt(u, g.hh));
      }
      for (let j = 10; j < H; j += 10) {
        const v = -g.hh + (2 * g.hh * j) / H;
        ctx.moveTo(...g.pt(-g.hw, v)); ctx.lineTo(...g.pt(g.hw, v));
      }
      ctx.stroke();
    }

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); poly(); ctx.stroke();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#000';
    ctx.beginPath(); poly(); ctx.stroke();
    ctx.setLineDash([]);

    // Framing guide, clipped to the selection (rotates with it).
    const guide = this.api.getGuide?.();
    if (guide && guide.kind !== 'none') {
      const [o, tr, , bl] = g.corners;
      ctx.save();
      ctx.beginPath(); poly(); ctx.clip();
      drawGuide(ctx, guide.kind, guide.orient, o, [tr[0] - o[0], tr[1] - o[1]], [bl[0] - o[0], bl[1] - o[1]], W / H);
      ctx.restore();
    }

    // Rotation knob on a stem above the top edge.
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(...g.top); ctx.lineTo(...g.knob); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(g.knob[0], g.knob[1], 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // Corner handles, drawn rotated with the rectangle.
    for (const [px, py] of g.corners) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-g.rot);
      ctx.fillRect(-4, -4, 8, 8);
      ctx.strokeRect(-4, -4, 8, 8);
      ctx.restore();
    }

    // Size tag (drag it to move the selection), placed above the rectangle's bounding box.
    const deg = Math.round((g.rot * 180) / Math.PI);
    const label = `⠿ ${W} × ${H}` + (deg ? ` · ${deg}°` : '');
    ctx.font = '12px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    const xs = g.corners.map(p => p[0]), ys = [...g.corners.map(p => p[1]), g.knob[1]];
    const bx = Math.min(...xs), by = Math.min(...ys), byMax = Math.max(...g.corners.map(p => p[1]));
    const ly = by > 22 ? by - 20 : byMax + 4;
    this.labelRect = { x: bx, y: ly, w: tw + 10, h: 17 };
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(bx, ly, tw + 10, 17);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, bx + 5, ly + 13);
  }
}
