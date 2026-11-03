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
    this.state = { now: Date.now(), hype: 109, intro: 0, diary: false, scene: false, visits: [], form: false, draftDate: '', draftNote: '', draftPhotos: [], draftPin: '', saving: false, formError: '' };
    this.setCanvas = (el) => { if (el) this.canvas = el; };
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
  async submitVisit() {
    const pin = (this.state.draftPin || '').trim();
    if (!pin) { this.setState({ formError: 'Escribe el PIN del diario.' }); return; }
    this.setState({ saving: true, formError: '' });
    try {
      const { id } = await api('diary', { pin, date: this.state.draftDate, note: this.state.draftNote.trim() });
      const photos = this.state.draftPhotos;
      for (let i = 0; i < photos.length; i++) {
        this.setState({ formError: 'Subiendo fotos… ' + (i + 1) + ' de ' + photos.length });
        await api('photo', { pin, visitId: id, data: await this.shrink(photos[i].file) });
      }
      try { localStorage.setItem('piso-pin', pin); } catch (e) {}
      await this.loadVisits();
      this.setState({ form: false, draftPhotos: [], saving: false, formError: '' });
    } catch (e) {
      this.setState({ saving: false, formError: e.message || 'No se ha podido guardar.' });
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
    // inclinación del móvil: el agua se mantiene horizontal respecto al suelo real
    let tiltTarget = 0, tilt = 0;
    this.onTilt = (e) => { if (e.gamma == null) return; tiltTarget = Math.max(-25, Math.min(25, e.gamma)) * Math.PI / 180; };
    window.addEventListener('deviceorientation', this.onTilt);
    this.askTilt = () => {
      const D = window.DeviceOrientationEvent;
      if (D && typeof D.requestPermission === 'function') D.requestPermission().catch(() => {});
      window.removeEventListener('pointerdown', this.askTilt);
    };
    window.addEventListener('pointerdown', this.askTilt);

    let last = performance.now(), T = 0;
    const frame = (now) => {
      const dt = Math.min(50, now - last); last = now;
      const dts = dt / 1000;
      if (!reduce) T += dts;
      tilt += (tiltTarget - tilt) * Math.min(1, dts * 3);
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
        const tiltY = (x) => -Math.tan(tilt) * (x - W / 2);
        const amp = Math.min(1, (H - level) / 60);
        const surfAt = (x) => level + surf(x, T, amp) + tiltY(x);
        const step = 6;
        // olas lejanas
        ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W + step; x += step) ctx.lineTo(x, level - 8 + surf(x * 1.35 + 400, T * 0.7, 0.7 * amp) + tiltY(x));
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
    window.addEventListener('pagehide', this.onHide);
  }
  componentWillUnmount() {
    clearInterval(this.timer); clearInterval(this.hypeT);
    clearTimeout(this.waterRetry);
    cancelAnimationFrame(this.raf); cancelAnimationFrame(this.wraf);
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    if (this.onTilt) window.removeEventListener('deviceorientation', this.onTilt);
    if (this.askTilt) window.removeEventListener('pointerdown', this.askTilt);
    if (this.onHide) window.removeEventListener('pagehide', this.onHide);
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
      { name: 'Reserva', date: '2025-11-13', icon: 'clip' },
      { name: 'Firma', date: '2026-04-16', icon: 'doc' },
      { name: 'Pago 1', date: '2026-08-01', icon: 'pay' },
      { name: 'Pago 2', date: '2026-12-01', icon: 'pay' },
      { name: 'Pago 3', date: '2027-04-01', icon: 'pay' },
      { name: 'Pago 4', date: '2027-08-01', icon: 'pay' },
      { name: 'Llaves', date: '2028-10-01', icon: 'key' }
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
      return {
        ...m,
        nodeWrap: 'position: absolute; top: 0; left: ' + (f * 100).toFixed(2) + '%; width: 0; display: flex; flex-direction: column; align-items: ' + (i === 0 ? 'flex-start' : i === raw.length - 1 ? 'flex-end' : 'center') + '; gap: 6px; animation: fadeUp .6s ease-out both; animation-delay: ' + (300 + i * 110) + 'ms;',
        node,
        isClip: m.icon === 'clip', isDoc: m.icon === 'doc', isPay: m.icon === 'pay', isKey: m.icon === 'key',
        iconColor: done ? accent : next ? '#FFD27A' : '#6F8C80',
        labelClass: 'ms-label' + (next || i === raw.length - 1 ? ' ms-keep' : ''),
        textColor: done ? '#E8F2EC' : next ? '#FFD27A' : '#8FA89B'
      };
    });
    const next = nextIdx >= 0 ? raw[nextIdx] : null;
    const nextDays = next ? Math.ceil((new Date(next.date + 'T00:00:00').getTime() - now) / 86400000) : 0;


    // Diario de obra: visitas libres al piso (fecha, fotos y notas)
    const visits = (this.state.visits || []).slice().sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1)).map((v) => {
      const t = new Date(v.date + 'T12:00:00').getTime();
      const ago = Math.round((now - t) / 86400000);
      const vp = Math.max(0, Math.min(1, (t - START) / (END - START)));
      const ph = (v.photos || []).map((k) => {
        const url = typeof k === 'string' ? '/api/photo?key=' + encodeURIComponent(k) : k.url;
        return { url, open: () => this.setState({ photo: url }) };
      });
      const d = new Date(v.date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return {
        dateLabel: d.charAt(0).toUpperCase() + d.slice(1),
        ago: ago <= 0 ? 'Hoy' : ago === 1 ? 'Ayer' : 'Hace ' + ago + ' días',
        pctAt: (vp * 100).toFixed(1).replace('.', ',') + '%',
        note: v.note, hasNote: !!v.note,
        photos: ph, hasPhotos: ph.length > 0,
        grid: 'display: grid; grid-template-columns: repeat(' + Math.min(3, Math.max(1, ph.length)) + ', minmax(0, 1fr)); gap: 6px;'
      };
    });

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
      visits,
      noVisits: visits.length === 0,
      formOpen: this.state.form,
      formClosed: !this.state.form,
      openForm: () => this.setState({ form: true, draftDate: new Date().toISOString().slice(0, 10), draftNote: '', draftPhotos: [], formError: '' }),
      cancelForm: () => this.setState({ form: false }),
      draftDate: this.state.draftDate,
      draftNote: this.state.draftNote,
      draftPin: this.state.draftPin || '',
      draftPhotos: this.state.draftPhotos,
      hasDraftPhotos: this.state.draftPhotos.length > 0,
      setDraftDate: (e) => this.setState({ draftDate: e.target.value }),
      setDraftNote: (e) => this.setState({ draftNote: e.target.value }),
      setDraftPin: (e) => this.setState({ draftPin: e.target.value }),
      setDraftPhotos: (e) => { const files = Array.from((e.target && e.target.files) || []).slice(0, 12); this.setState({ draftPhotos: files.map((f) => ({ url: URL.createObjectURL(f), name: f.name, file: f })) }); },
      saving: !!this.state.saving,
      saveLabel: this.state.saving ? 'Guardando…' : 'Guardar visita',
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
      closePhoto: () => this.setState({ photo: null }),
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
