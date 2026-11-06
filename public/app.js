import { DCLogic } from './dc-lite.js';

// Llamadas a las funciones de Netlify (/api/...). En la vista previa no hay servidor y se ignoran.
async function api(route, body) {
  const r = await fetch('/api/' + route, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  let d = {};
  try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(d.error || ('Error ' + r.status));
  return d;
}

class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { now: Date.now(), hype: 109, intro: 0, diary: false, scene: false, visits: [], form: false, draftDate: '', draftNote: '', draftPhotos: [], draftPin: '', saving: false, formError: '', draftVisitId: null, uploadDone: 0, uploadTotal: 0, photo: null, photoList: [], photoIdx: 0, msOpen: -1 };
    this.setCanvas = (el) => { if (el) this.canvas = el; };
    this.setPvImg = (el) => { this.pvImg = el; };
    this.zoom = { s: 1, x: 0, y: 0 };
    this.ptrs = new Map();
    this.hearts = [];
    this.server = null;
  }

  // ---------- Servidor: hype y diario ----------
  sendHype() {
    const n = this.hypePending || 0;
    if (!n || !this.server) return;
    this.hypePending = 0;
    api('hype', { n }).catch(() => { this.hypePending = (this.hypePending || 0) + n; });
  }
  async loadVisits() {
    try { const d = await api('diary'); this.setState({ visits: d.visits || [] }); } catch (e) { /* sin servidor */ }
  }
  // Reduce la foto en el navegador antes de subirla (máx. 1600 px, JPEG)
  async shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
    } finally { URL.revokeObjectURL(url); }
  }
  // Guarda la visita y sube sus fotos. Si algo falla a mitad, al volver a pulsar "Guardar"
  // se reutiliza la visita ya creada (draftVisitId) y solo se suben las fotos que faltan.
  async submitVisit() {
    const pin = (this.state.draftPin || '').trim();
    if (!pin) { this.setState({ formError: 'Escribe el PIN del diario.' }); return; }
    const pending = this.state.draftPhotos.filter((p) => !p.done);
    this.setState({ saving: true, formError: '', uploadDone: this.state.draftPhotos.length - pending.length, uploadTotal: this.state.draftPhotos.length });
    try {
      let id = this.state.draftVisitId;
      if (!id) {
        id = (await api('diary', { pin, date: this.state.draftDate, note: this.state.draftNote.trim() })).id;
        this.setState({ draftVisitId: id });
      }
      for (const ph of pending) {
        await api('photo', { pin, visitId: id, data: await this.shrink(ph.file) });
        ph.done = true; // queda marcada como subida aunque falle una posterior
        this.setState({ uploadDone: this.state.uploadDone + 1, draftPhotos: this.state.draftPhotos.slice() });
      }
      try { localStorage.setItem('piso-pin', pin); } catch (e) {}
      await this.loadVisits();
      this.state.draftPhotos.forEach((p) => URL.revokeObjectURL(p.url));
      this.setState({ form: false, draftPhotos: [], draftVisitId: null, saving: false, formError: '', uploadTotal: 0, uploadDone: 0 });
    } catch (e) {
      const msg = e.message || 'No se ha podido guardar.';
      this.setState({ saving: false, formError: this.state.draftVisitId ? msg + ' Pulsa "Reintentar" para subir las fotos que faltan.' : msg });
    }
  }
  clockDate() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // ---- visor de fotos ----
  openPhotos(list, i) { this.resetZoom(); this.setState({ photoList: list, photoIdx: i, photo: list[i] }); }
  stepPhoto(d) {
    const list = this.state.photoList || [];
    if (list.length < 2) return;
    const i = (this.state.photoIdx + d + list.length) % list.length;
    this.resetZoom();
    this.setState({ photoIdx: i, photo: list[i] });
  }
  // ---- zoom del visor: pellizcar, doble toque / doble clic y rueda; con zoom se arrastra para mover la foto ----
  resetZoom() { this.zoom = { s: 1, x: 0, y: 0 }; this.ptrs.clear(); this.g = null; this.applyZoom(false); }
  applyZoom(animate) {
    const im = this.pvImg, z = this.zoom;
    if (!im) return;
    im.style.transition = animate ? 'transform .2s ease' : 'none';
    im.style.transform = z.s > 1 ? 'translate(' + z.x + 'px, ' + z.y + 'px) scale(' + z.s + ')' : '';
    im.style.cursor = z.s > 1 ? 'grab' : '';
  }
  // cambia la escala a s dejando quieto bajo (px, py) el punto de la foto que hay ahí
  zoomAt(s, px, py, animate) {
    const im = this.pvImg, z = this.zoom;
    if (!im || !im.offsetParent) return;
    const pr = im.offsetParent.getBoundingClientRect();
    const cx = pr.left + im.offsetLeft + im.offsetWidth / 2, cy = pr.top + im.offsetTop + im.offsetHeight / 2; // centro sin transformar
    s = Math.max(1, Math.min(4, s));
    const qx = (px - cx - z.x) / z.s, qy = (py - cy - z.y) / z.s;
    z.x = px - cx - s * qx; z.y = py - cy - s * qy; z.s = s;
    this.clampZoom();
    this.applyZoom(animate);
  }
  // sin zoom la foto vuelve a su sitio; con zoom no se puede sacar de sus bordes
  clampZoom() {
    const im = this.pvImg, z = this.zoom;
    if (z.s <= 1.01) { z.s = 1; z.x = 0; z.y = 0; return; }
    const mx = (z.s - 1) * im.offsetWidth / 2, my = (z.s - 1) * im.offsetHeight / 2;
    z.x = Math.max(-mx, Math.min(mx, z.x)); z.y = Math.max(-my, Math.min(my, z.y));
  }
  toggleZoom(px, py) {
    if (this.zoom.s > 1) { this.zoom = { s: 1, x: 0, y: 0 }; this.applyZoom(true); } else this.zoomAt(2.5, px, py, true);
  }
  // empieza (o reinicia) un gesto con los dedos que haya en pantalla
  gestureStart() {
    const p = [...this.ptrs.values()], z = this.zoom;
    this.g = { s: z.s, x: z.x, y: z.y, p0: { ...p[0] }, pinch: p.length >= 2, moved: false };
    if (p.length >= 2) {
      this.g.d = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) || 1;
      this.g.mx = (p[0].x + p[1].x) / 2; this.g.my = (p[0].y + p[1].y) / 2;
    }
  }
  pvDown(e) {
    if (e.target.closest && e.target.closest('button')) return; // flechas y cerrar van aparte
    if (e.pointerType === 'touch') this.lastTouchAt = Date.now();
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.gestureStart();
  }
  pvMove(e) {
    const pt = this.ptrs.get(e.pointerId), g = this.g, z = this.zoom;
    if (!pt || !g) return;
    pt.x = e.clientX; pt.y = e.clientY;
    const p = [...this.ptrs.values()];
    if (p.length >= 2) {
      // pellizco: escala con la distancia entre dedos y se mueve con su punto medio
      const d = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) || 1;
      const mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
      z.s = g.s; z.x = g.x + mx - g.mx; z.y = g.y + my - g.my;
      this.zoomAt(g.s * d / g.d, mx, my, false);
      g.moved = true;
      return;
    }
    const dx = p[0].x - g.p0.x, dy = p[0].y - g.p0.y;
    if (Math.hypot(dx, dy) > 8) g.moved = true;
    if (z.s > 1) { z.x = g.x + dx; z.y = g.y + dy; this.clampZoom(); this.applyZoom(false); }
  }
  pvUp(e) {
    if (!this.ptrs.has(e.pointerId)) return;
    const g = this.g;
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size) { this.gestureStart(); this.g.pinch = true; return; } // queda un dedo: sigue desde ahí
    this.g = null;
    if (!g) return;
    if (g.pinch) { this.swipeAt = Date.now(); return; } // tras pellizcar no se cierra ni cambia de foto
    const dx = e.clientX - g.p0.x, dy = e.clientY - g.p0.y;
    if (this.zoom.s === 1 && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) { this.swipeAt = Date.now(); this.stepPhoto(dx < 0 ? 1 : -1); return; }
    if (g.moved) { this.swipeAt = Date.now(); return; }
    // doble toque sobre la foto: amplía o vuelve al tamaño normal
    if (e.pointerType === 'touch' && e.target === this.pvImg) {
      const now = Date.now(), lt = this.lastTap;
      if (lt && now - lt.t < 320 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 30) { this.lastTap = null; this.toggleZoom(e.clientX, e.clientY); }
      else this.lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  }

  // ---------- Agua que sube con el porcentaje ----------
  startWater() {
    const cv = this.canvas || document.querySelector('canvas[data-water]');
    if (!cv) { this.waterRetry = setTimeout(() => this.startWater(), 100); return; }
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    this.onResize = resize;
    window.addEventListener('resize', resize);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const START = new Date('2025-11-01T00:00:00').getTime();
    const END = new Date('2028-10-01T00:00:00').getTime();
    const waves = [
      { A: 10, L: 560, S: 0.5, P: 0 },
      { A: 5, L: 300, S: -0.8, P: 1.7 },
      { A: 2.4, L: 150, S: 1.4, P: 4.1 },
      { A: 1, L: 70, S: -2.2, P: 2.3 }
    ];
    const surf = (x, t, k) => { let y = 0; for (const w of waves) y += w.A * k * Math.sin((x / w.L) * 6.2832 + t * w.S + w.P); return y; };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random() * 0.7, r: rnd(0.4, 1.3), ph: rnd(0, 6.28), sp: rnd(0.5, 1.6) }));
    const bubbles = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), r: 0.8 + Math.random() * 2.4, v: 0.00003 + Math.random() * 0.00006, w: Math.random() * 6.28 }));
    const sparks = [];
    const heartsLive = [];
    const heartPath = (c2, x, y, s) => {
      c2.beginPath();
      c2.moveTo(x, y + s * 0.35);
      c2.bezierCurveTo(x - s * 0.9, y - s * 0.25, x - s * 0.45, y - s * 0.95, x, y - s * 0.45);
      c2.bezierCurveTo(x + s * 0.45, y - s * 0.95, x + s * 0.9, y - s * 0.25, x, y + s * 0.35);
    };
    let last = performance.now(), T = 0;
    const frame = (now) => {
      const dt = Math.min(50, now - last); last = now;
      const dts = dt / 1000;
      if (!reduce) T += dts;
      const hex = (this.props.accent ?? '#3BE58A').replace('#', '');
      const R = parseInt(hex.slice(0, 2), 16), G = parseInt(hex.slice(2, 4), 16), B = parseInt(hex.slice(4, 6), 16);
      const c = (a) => 'rgba(' + R + ',' + G + ',' + B + ',' + a + ')';
      const p = Math.max(0, Math.min(1, (Date.now() - START) / (END - START))) * this.state.intro;
      ctx.clearRect(0, 0, W, H);
      // estrellas
      for (const s of stars) {
        const a = 0.15 + 0.45 * (0.5 + 0.5 * Math.sin(T * s.sp + s.ph));
        ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 6.2832); ctx.fillStyle = 'rgba(235,245,255,' + a + ')'; ctx.fill();
      }
      if (p > 0.002 && W > 0) {
        const level = H * (1 - p);
        const amp = Math.min(1, (H - level) / 60);
        const surfAt = (x) => level + surf(x, T, amp);
        const step = 6;
        // olas lejanas
        ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W + step; x += step) ctx.lineTo(x, level - 8 + surf(x * 1.35 + 400, T * 0.7, 0.7 * amp));
        ctx.lineTo(W, H); ctx.closePath();
        ctx.fillStyle = c(0.06); ctx.fill();
        // cuerpo del agua
        const pts = [];
        for (let x = 0; x <= W + step; x += step) pts.push([x, surfAt(x)]);
        const body = new Path2D();
        body.moveTo(0, H);
        for (const q of pts) body.lineTo(q[0], q[1]);
        body.lineTo(W, H); body.closePath();
        const gr = ctx.createLinearGradient(0, level - 14, 0, H);
        gr.addColorStop(0, c(0.2)); gr.addColorStop(0.1, c(0.12));
        gr.addColorStop(0.5, 'rgba(6,34,28,0.45)'); gr.addColorStop(1, 'rgba(3,14,12,0.7)');
        ctx.fillStyle = gr; ctx.fill(body);
        // rayos de luz suaves y burbujas
        ctx.save(); ctx.clip(body);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 6; i++) {
          const x0 = W * (i + 0.5) / 6 + Math.sin(T * 0.25 + i * 1.7) * 60;
          const wTop = 24 + 14 * Math.sin(T * 0.4 + i);
          const lg = ctx.createLinearGradient(0, level, 0, level + (H - level) * 0.8);
          lg.addColorStop(0, c(0.05 + 0.02 * Math.sin(T * 0.8 + i * 2))); lg.addColorStop(1, c(0));
          ctx.fillStyle = lg;
          ctx.beginPath(); ctx.moveTo(x0 - wTop, level); ctx.lineTo(x0 + wTop, level); ctx.lineTo(x0 + wTop * 2.4 + 80, H); ctx.lineTo(x0 + 40, H); ctx.closePath(); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        for (const b of bubbles) {
          if (!reduce) b.y -= b.v * dt;
          if (b.y < 0) { b.y = 1; b.x = Math.random(); }
          const bx = b.x * W + Math.sin(T * 1.8 + b.w) * 5;
          const by = level + (H - level) * b.y;
          ctx.beginPath(); ctx.arc(bx, by, b.r, 0, 6.2832);
          ctx.strokeStyle = 'rgba(220,255,240,' + (0.1 + 0.22 * b.y) + ')'; ctx.lineWidth = 1; ctx.stroke();
        }
        ctx.restore();
        // superficie y espuma
        const line = (off, a, w) => {
          ctx.beginPath();
          pts.forEach((q, i) => { const y = q[1] + off + Math.sin(i * 0.9 + T * 3 + off) * (off ? 1.2 : 0); i ? ctx.lineTo(q[0], y) : ctx.moveTo(q[0], y); });
          ctx.strokeStyle = 'rgba(230,255,244,' + a + ')'; ctx.lineWidth = w; ctx.stroke();
        };
        line(0, 0.5, 1.5); line(3, 0.14, 2.5);
        ctx.shadowColor = c(0.8); ctx.shadowBlur = 12; line(0, 0.22, 1); ctx.shadowBlur = 0;
        // corazones de hype: suben desde el fondo y estallan al llegar a la superficie
        while (this.hearts.length) { const hh = this.hearts.shift(); heartsLive.push({ x: hh.x * W, y: H - 16, t: T }); }
        for (let k = heartsLive.length - 1; k >= 0; k--) {
          const hh = heartsLive[k];
          hh.y -= 120 * dts;
          const hx = hh.x + Math.sin((T - hh.t) * 4) * 8;
          if (hh.y < surfAt(hx)) {
            heartsLive.splice(k, 1);
            for (let q = 0; q < 8; q++) sparks.push({ x: hx, y: hh.y, vx: rnd(-90, 90), vy: rnd(-200, -80), life: 1, s: rnd(5, 9) });
            continue;
          }
          ctx.save(); ctx.shadowColor = 'rgba(255,107,139,0.9)'; ctx.shadowBlur = 14;
          heartPath(ctx, hx, hh.y, 16); ctx.fillStyle = 'rgba(255,107,139,0.8)'; ctx.fill();
          ctx.restore();
        }
      } else {
        while (this.hearts.length) { const hh = this.hearts.shift(); for (let q = 0; q < 8; q++) sparks.push({ x: hh.x * W, y: H - 40, vx: rnd(-90, 90), vy: rnd(-260, -120), life: 1, s: rnd(5, 9) }); }
      }
      // corazoncitos tras estallar
      for (let k = sparks.length - 1; k >= 0; k--) {
        const s = sparks[k];
        s.vy += 260 * dts; s.x += s.vx * dts; s.y += s.vy * dts; s.life -= dts * 0.8;
        if (s.life <= 0) { sparks.splice(k, 1); continue; }
        heartPath(ctx, s.x, s.y, s.s); ctx.fillStyle = 'rgba(255,140,165,' + s.life + ')'; ctx.fill();
      }
      this.wraf = requestAnimationFrame(frame);
    };
    this.wraf = requestAnimationFrame(frame);
  }

  componentDidMount() {
    this.timer = setInterval(() => this.setState({ now: Date.now() }), 1000);
    // Llenado lento al cargar: 0,5 s de espera y 4 s subiendo con suavizado
    const DELAY = 500, D = 4000;
    let t0 = null;
    const step = (t) => {
      if (t0 === null) t0 = t;
      const k = Math.max(0, Math.min(1, (t - t0 - DELAY) / D));
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.setState({ intro: e });
      if (k < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
    this.startWater();
    try { this.setState({ draftPin: localStorage.getItem('piso-pin') || '' }); } catch (e) {}
    api('state')
      .then((d) => { this.server = d; if (typeof d.hype === 'number') this.setState({ hype: d.hype }); this.loadVisits(); })
      .catch(() => { this.server = null; });
    this.hypeT = setInterval(() => this.sendHype(), 1200);
    this.onHide = () => this.sendHype();
    // el bocadillo de un hito se cierra al tocar fuera o con Escape
    this.onDocClick = () => { if (this.state.msOpen >= 0) this.setState({ msOpen: -1 }); };
    this.onKey = (e) => { if (e.key === 'Escape' && this.state.msOpen >= 0) this.setState({ msOpen: -1 }); };
    document.addEventListener('click', this.onDocClick);
    document.addEventListener('keydown', this.onKey);
    window.addEventListener('pagehide', this.onHide);
  }
  componentWillUnmount() {
    clearInterval(this.timer); clearInterval(this.hypeT);
    clearTimeout(this.waterRetry);
    cancelAnimationFrame(this.raf); cancelAnimationFrame(this.wraf);
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    if (this.onHide) window.removeEventListener('pagehide', this.onHide);
    if (this.onDocClick) document.removeEventListener('click', this.onDocClick);
    if (this.onKey) document.removeEventListener('keydown', this.onKey);
  }

  renderVals() {
    const accent = this.props.accent ?? '#3BE58A';
    const hex = accent.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const tint = (a) => 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    const now = this.state.now;
    const START = new Date('2025-11-01T00:00:00').getTime();
    const END = new Date('2028-10-01T00:00:00').getTime();
    const diff = Math.max(0, END - now);
    const pad = (n) => String(n).padStart(2, '0');
    const p = Math.max(0, Math.min(1, (now - START) / (END - START)));
    const pa = p * this.state.intro;
    const [pctInt, pctDec] = (pa * 100).toFixed(2).split('.');

    const raw = [
      { name: 'Reserva', full: 'Reserva del piso', date: '2025-11-13', icon: 'clip' },
      { name: 'Firma', full: 'Firma del contrato', date: '2026-04-16', icon: 'doc' },
      { name: 'Pago 1', full: 'Pago 1 de 4', date: '2026-08-01', icon: 'pay' },
      { name: 'Pago 2', full: 'Pago 2 de 4', date: '2026-12-01', icon: 'pay' },
      { name: 'Pago 3', full: 'Pago 3 de 4', date: '2027-04-01', icon: 'pay' },
      { name: 'Pago 4', full: 'Pago 4 de 4', date: '2027-08-01', icon: 'pay' },
      { name: 'Llaves', full: 'Entrega de llaves', date: '2028-10-01', icon: 'key' }
    ];
    const nextIdx = raw.findIndex((m) => new Date(m.date + 'T00:00:00').getTime() > now);
    const milestones = raw.map((m, i) => {
      const t = new Date(m.date + 'T00:00:00').getTime();
      const f = Math.max(0, Math.min(1, (t - START) / (END - START)));
      const done = t <= now, next = i === nextIdx;
      const size = done ? 12 : next ? 14 : 10;
      let node = 'display: block; width: ' + size + 'px; height: ' + size + 'px; box-sizing: border-box; border-radius: 50%; margin-top: ' + (9.5 - size / 2) + 'px;';
      if (done) node += ' background: ' + accent + '; box-shadow: 0 0 10px ' + tint(0.7) + ';';
      else if (next) node += ' background: #08110E; border: 3px solid #FFD27A; animation: pulseRing 1.8s ease-out infinite;';
      else node += ' background: #08110E; border: 2px solid rgba(232,242,236,.3);';
      // bocadillo con el nombre completo y la fecha (se abre al tocar el hito)
      const open = this.state.msOpen === i;
      const cx = i === 0 ? size / 2 : i === raw.length - 1 ? -size / 2 : 0; // centro del punto respecto al ancla
      const BW = 184;
      const bx = f < 0.25 ? cx - 22 : f > 0.75 ? cx - BW + 22 : -BW / 2; // cerca de los bordes, el bocadillo se desplaza hacia dentro
      const days = Math.round((t - now) / 86400000);
      const fecha = new Date(t).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return {
        ...m,
        nodeWrap: 'position: absolute; top: 0; left: ' + (f * 100).toFixed(2) + '%; width: 0; display: flex; flex-direction: column; align-items: ' + (i === 0 ? 'flex-start' : i === raw.length - 1 ? 'flex-end' : 'center') + '; gap: 6px; animation: fadeUp .6s ease-out both; animation-delay: ' + (300 + i * 110) + 'ms;' + (open ? ' z-index: 5;' : ''),
        hitStyle: 'left: ' + (cx - 22) + 'px;',
        open,
        toggle: (e) => { e.stopPropagation(); this.setState({ msOpen: open ? -1 : i }); },
        ariaLabel: m.full + ', ' + fecha,
        bubbleStyle: 'left: ' + bx + 'px; width: ' + BW + 'px; border-color: ' + (done ? tint(0.55) : next ? 'rgba(255,210,122,.6)' : 'rgba(232,242,236,.22)') + ';',
        arrowStyle: 'left: ' + (cx - bx - 6) + 'px; border-color: ' + (done ? tint(0.55) : next ? 'rgba(255,210,122,.6)' : 'rgba(232,242,236,.22)') + ';',
        fullName: m.full,
        fecha: fecha.charAt(0).toUpperCase() + fecha.slice(1),
        estado: done ? (days === 0 ? 'Hoy' : 'Hecho · hace ' + -days + (days === -1 ? ' día' : ' días')) : 'Faltan ' + days + (days === 1 ? ' día' : ' días'),
        estadoColor: done ? accent : next ? '#FFD27A' : '#8FA89B',
        node,
        isClip: m.icon === 'clip', isDoc: m.icon === 'doc', isPay: m.icon === 'pay', isKey: m.icon === 'key',
        iconColor: done ? accent : next ? '#FFD27A' : '#6F8C80',
        labelClass: 'ms-label' + (next || i === raw.length - 1 ? ' ms-keep' : ''),
        textColor: done ? '#E8F2EC' : next ? '#FFD27A' : '#8FA89B'
      };
    });
    const next = nextIdx >= 0 ? raw[nextIdx] : null;
    const nextDays = next ? Math.ceil((new Date(next.date + 'T00:00:00').getTime() - now) / 86400000) : 0;


    // Diario de obra: línea de tiempo de visitas agrupadas por mes (la más reciente arriba)
    const pctOf = (date) => Math.max(0, Math.min(1, (new Date(date + 'T12:00:00').getTime() - START) / (END - START))) * 100;
    const fmtPct = (x) => x.toFixed(1).replace('.', ',') + '%';
    const sorted = (this.state.visits || []).slice().sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
    let photoTotal = 0;
    const visits = sorted.map((v, idx) => {
      const t = new Date(v.date + 'T12:00:00');
      const ago = Math.round((now - t.getTime()) / 86400000);
      const pct = pctOf(v.date);
      const older = sorted[idx + 1];
      const delta = older ? pct - pctOf(older.date) : 0;
      const urls = (v.photos || []).map((k) => (typeof k === 'string' ? '/api/photo?key=' + encodeURIComponent(k) : k.url));
      photoTotal += urls.length;
      const d = t.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      return {
        month: t.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
        day: String(t.getDate()),
        wd: t.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', ''),
        dateStyle: idx === 0 ? 'border-color: ' + accent + '; box-shadow: 0 0 16px ' + tint(0.25) + ';' : '',
        dateLabel: d.charAt(0).toUpperCase() + d.slice(1),
        ago: ago <= 0 ? 'Hoy' : ago === 1 ? 'Ayer' : 'Hace ' + ago + ' días',
        pctAt: fmtPct(pct),
        pctAria: 'La obra iba al ' + fmtPct(pct),
        pctBar: 'height: 100%; width: ' + pct.toFixed(1) + '%; border-radius: 999px; background: ' + accent + '; box-shadow: 0 0 8px ' + tint(0.6) + ';',
        hasDelta: delta >= 0.05,
        delta: '+' + fmtPct(delta),
        note: v.note, hasNote: !!v.note,
        hasPhotos: urls.length > 0,
        first: urls[0] || '',
        heroLabel: 'Ver las fotos de esta visita (' + urls.length + ')',
        openFirst: () => this.openPhotos(urls, 0),
        hasMore: urls.length > 1,
        photoCount: urls.length + ' fotos',
        thumbs: urls.slice(1).map((url, k) => ({ url, open: () => this.openPhotos(urls, k + 1) }))
      };
    });
    const groups = [];
    visits.forEach((v) => {
      let g = groups[groups.length - 1];
      if (!g || g.key !== v.month) {
        g = { key: v.month, label: v.month.charAt(0).toUpperCase() + v.month.slice(1), visits: [] };
        groups.push(g);
      }
      g.visits.push(v);
    });
    groups.forEach((g) => { g.countLabel = g.visits.length === 1 ? '1 visita' : g.visits.length + ' visitas'; });
    const draftPhotosView = this.state.draftPhotos.map((ph, k) => ({
      ...ph,
      canRemove: !ph.done && !this.state.saving,
      remove: () => {
        URL.revokeObjectURL(ph.url);
        this.setState({ draftPhotos: this.state.draftPhotos.filter((_, n) => n !== k) });
      }
    }));
    const photoList = this.state.photoList || [];

    return {
      accent,
      glow: tint(0.35),
      setCanvas: this.setCanvas,
      pctInt, pctDec,
      days: String(Math.floor(diff / 86400000)),
      hours: pad(Math.floor(diff / 3600000) % 24),
      mins: pad(Math.floor(diff / 60000) % 60),
      secs: pad(Math.floor(diff / 1000) % 60),
      barStyle: 'position: absolute; left: 0; top: 32px; height: 3px; width: ' + (pa * 100).toFixed(2) + '%; border-radius: 999px; background: ' + accent + '; box-shadow: 0 0 16px ' + tint(0.6) + ';',
      nextName: next ? next.name : '¡Ya es nuestro!',
      nextIn: next ? 'faltan ' + nextDays + ' días' : 'a disfrutarlo',
      milestones,
      groups,
      hasVisits: visits.length > 0,
      diaryStats: (visits.length === 1 ? '1 visita' : visits.length + ' visitas') + ' · ' + (photoTotal === 1 ? '1 foto' : photoTotal + ' fotos'),
      showCta: !this.state.form,
      showEmpty: visits.length === 0 && !this.state.form,
      formOpen: this.state.form,
      formClosed: !this.state.form,
      openForm: () => this.setState({ form: true, draftDate: this.clockDate(), draftNote: '', draftPhotos: [], draftVisitId: null, formError: '', uploadDone: 0, uploadTotal: 0 }),
      cancelForm: () => {
        if (this.state.saving) return;
        this.state.draftPhotos.forEach((p) => URL.revokeObjectURL(p.url));
        if (this.state.draftVisitId) this.loadVisits(); // la visita ya creada aparece con las fotos que llegaron a subirse
        this.setState({ form: false, draftPhotos: [], draftVisitId: null, formError: '' });
      },
      resuming: !!this.state.draftVisitId,
      draftCount: this.state.draftPhotos.length + ' de 12',
      draftPhotosView,
      uploading: this.state.saving && this.state.uploadTotal > 0,
      uploadDone: this.state.uploadDone,
      uploadTotal: this.state.uploadTotal,
      uploadBar: 'height: 100%; border-radius: 999px; background: ' + accent + '; box-shadow: 0 0 10px ' + tint(0.6) + '; transition: width .35s ease; width: ' + (this.state.uploadTotal ? Math.round(100 * Math.max(0.04, this.state.uploadDone / this.state.uploadTotal)) : 0) + '%;',
      draftDate: this.state.draftDate,
      draftNote: this.state.draftNote,
      draftPin: this.state.draftPin || '',
      draftPhotos: this.state.draftPhotos,
      hasDraftPhotos: this.state.draftPhotos.length > 0,
      setDraftDate: (e) => this.setState({ draftDate: e.target.value }),
      setDraftNote: (e) => this.setState({ draftNote: e.target.value }),
      setDraftPin: (e) => this.setState({ draftPin: e.target.value }),
      // las fotos elegidas y las hechas con la cámara se van sumando (máx. 12)
      addDraftPhotos: (e) => {
        const files = Array.from((e.target && e.target.files) || []);
        if (e.target) e.target.value = ''; // permite elegir o hacer otra foto seguida
        const added = files.map((f) => ({ url: URL.createObjectURL(f), name: f.name, file: f }));
        this.setState({ draftPhotos: this.state.draftPhotos.concat(added).slice(0, 12) });
      },
      saving: !!this.state.saving,
      saveLabel: this.state.saving ? (this.state.uploadTotal ? 'Subiendo ' + Math.min(this.state.uploadDone + 1, this.state.uploadTotal) + '/' + this.state.uploadTotal + '…' : 'Guardando…') : this.state.draftVisitId ? 'Reintentar' : 'Guardar visita',
      hasFormError: !!this.state.formError,
      formError: this.state.formError || '',
      saveVisit: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (!this.state.draftDate || this.state.saving) return;
        if (!this.server) {
          // vista previa sin servidor: se guarda solo en esta sesión
          this.setState({ visits: [{ date: this.state.draftDate, note: this.state.draftNote.trim(), photos: this.state.draftPhotos.map((f) => ({ url: f.url })), createdAt: Date.now() }].concat(this.state.visits), form: false, draftPhotos: [] });
          return;
        }
        this.submitVisit();
      },
      diaryOpen: this.state.diary,
      openDiary: () => this.setState({ diary: true }),
      closeDiary: () => this.setState({ diary: false, photo: null }),
      // foto del diario a pantalla completa
      photoOpen: !!this.state.photo,
      photoUrl: this.state.photo,
      closePhoto: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (Date.now() - (this.swipeAt || 0) < 400) return; // al deslizar no se cierra
        this.setState({ photo: null });
      },
      photoMany: photoList.length > 1,
      photoCounter: photoList.length > 1 ? (this.state.photoIdx + 1) + ' de ' + photoList.length : 'Foto de la visita',
      prevPhoto: (e) => { if (e) e.stopPropagation(); this.stepPhoto(-1); },
      nextPhoto: (e) => { if (e) e.stopPropagation(); this.stepPhoto(1); },
      // gestos del visor (dedo y ratón): deslizar para cambiar de foto, pellizcar y arrastrar con zoom
      setPvImg: this.setPvImg,
      photoDown: (e) => this.pvDown(e),
      photoMove: (e) => this.pvMove(e),
      photoUp: (e) => this.pvUp(e),
      photoWheel: (e) => { e.preventDefault(); this.zoomAt(this.zoom.s * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY, false); },
      photoDblClick: (e) => {
        e.stopPropagation();
        if (Date.now() - (this.lastTouchAt || 0) < 600) return; // en el móvil el doble toque ya se gestiona aparte
        this.toggleZoom(e.clientX, e.clientY);
      },
      photoImgClick: (e) => e.stopPropagation(), // tocar la foto no cierra el visor (sí el fondo o la ✕)
      hype: String(this.state.hype),
      addHype: () => {
        this.setState({ hype: this.state.hype + 1 });
        this.hypePending = (this.hypePending || 0) + 1;
        this.hearts.push({ x: 0.15 + Math.random() * 0.7 });
      }
    };
  }
}

export default Component;
