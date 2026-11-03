import { DCLogic } from './dc-lite.js';

// Llamadas a las funciones de Netlify (/api/...)
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
    this.state = { now: Date.now(), hype: 109, intro: 0, sound: false, diary: false, scene: false, hypeToast: null, awayMsg: null, fishAlive: 14, fishHungry: 0, visits: [], form: false, draftDate: '', draftNote: '', draftPhotos: [] };
    this.setCanvas = (el) => { if (el) this.canvas = el; };
    this.setFx = (el) => { if (el) this.fx = el; };
    this.hearts = [];
    this.burstReq = false;
    this.whaleReq = false;
    this.partyNow = false;
    this.skyNow = null;
  }

  // ---------- Hora real de Madrid y cielo ----------
  clock(now) {
    const parts = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(now)).forEach((p) => { parts[p.type] = p.value; });
    const y = +parts.year, m = +parts.month, d = +parts.day;
    return {
      ymd: parts.year + '-' + parts.month + '-' + parts.day,
      h: +parts.hour + (+parts.minute) / 60 + (+parts.second) / 3600,
      hhmm: parts.hour + ':' + parts.minute,
      doy: Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000)
    };
  }
  sky(now) {
    const ck = this.clock(now);
    const cs = Math.cos(2 * Math.PI * (ck.doy - 172) / 365);
    const sr = 7.72 - 0.72 * cs, ss = 19.8 + 1.8 * cs; // amanecer y atardecer aprox. en Málaga
    const mode = this.props.momento ?? 'real';
    let h = ck.h;
    if (mode === 'amanecer') h = sr + 0.15;
    else if (mode === 'dia') h = (sr + ss) / 2;
    else if (mode === 'atardecer') h = ss - 0.1;
    else if (mode === 'noche') h = ((ss + sr + 24) / 2) % 24;
    const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    const day = sm((h - sr + 0.5) / 1.2) * (1 - sm((h - ss + 0.7) / 1.2));
    const tw = Math.max(Math.exp(-Math.pow((h - sr) / 0.75, 2)), Math.exp(-Math.pow((h - ss) / 0.75, 2)));
    const u = (h - sr) / (ss - sr);
    const nightLen = 24 - (ss - sr);
    const v = ((((h - ss) % 24) + 24) % 24) / nightLen;
    let phase = 'noche';
    if (tw > 0.35) phase = h < 13 ? 'amanecer' : 'atardecer';
    else if (day > 0.5) phase = 'dia';
    const mix = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
    let top = mix([4, 9, 14], [18, 58, 82], day), bot = mix([8, 17, 14], [10, 40, 36], day);
    top = mix(top, [70, 36, 78], tw * 0.75); bot = mix(bot, [96, 50, 34], tw * 0.6);
    return { day, tw, u, v, phase, top, bot, hhmm: mode === 'real' ? ck.hhmm : null, ymd: ck.ymd };
  }

  // ---------- Persistencia (Netlify Functions + Blobs) ----------
  // Peces guardados en el servidor: array (puede estar vacío) o null si no hay servidor.
  loadPond() {
    if (!this.server) return null;
    return Array.isArray(this.server.fish) ? this.server.fish : [];
  }
  // Guarda el estanque (con un pequeño retardo para agrupar cambios seguidos).
  savePond(fishes) {
    if (!this.server) return;
    this.pondRef = fishes;
    clearTimeout(this.pondT);
    this.pondT = setTimeout(() => {
      const keep = ['id', 'name', 'x', 'd', 'adultS', 'adult', 'bornAt', 'fedAt', 'fedLevel', 'breedAt', 'col', 'dead', 'diedAt'];
      const data = this.pondRef.map((f) => { const o = {}; keep.forEach((k) => { if (f[k] !== undefined) o[k] = f[k]; }); return o; });
      api('pond', { fish: data, since: this.loadedAt || 0 }).catch(() => {});
    }, 1500);
  }
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

  // ---------- Sonido ----------
  ensureAudio() {
    if (this.ac) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ac = new AC();
    const master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    const len = ac.sampleRate * 3;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0); let lastv = 0;
    for (let i = 0; i < len; i++) { const wv = Math.random() * 2 - 1; lastv = (lastv + 0.02 * wv) / 1.02; d[i] = lastv * 3.5; }
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    const og = ac.createGain(); og.gain.value = 0.35;
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.11;
    const lfoG = ac.createGain(); lfoG.gain.value = 0.25;
    lfo.connect(lfoG); lfoG.connect(og.gain);
    src.connect(lp); lp.connect(og); og.connect(master);
    src.start(); lfo.start();
    this.ac = ac; this.master = master;
    return true;
  }
  sfx(type) {
    if (!this.state.sound || !this.ac) return;
    const ac = this.ac, t = ac.currentTime, out = this.master;
    const tone = (f0, f1, dur, wave, vol, delay) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = wave;
      o.frequency.setValueAtTime(f0, t + delay);
      o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(g); g.connect(out); o.start(t + delay); o.stop(t + delay + dur + 0.05);
    };
    const noise = (dur, freq, vol, delay) => {
      const b = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
      const dd = b.getChannelData(0);
      for (let i = 0; i < dd.length; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / dd.length, 2);
      const s = ac.createBufferSource(); s.buffer = b;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
      const g = ac.createGain(); g.gain.value = vol;
      s.connect(f); f.connect(g); g.connect(out); s.start(t + delay);
    };
    if (type === 'plop') tone(700, 160, 0.16, 'sine', 0.3, 0);
    else if (type === 'splash') { noise(0.35, 1300, 0.45, 0); tone(300, 90, 0.2, 'sine', 0.15, 0); }
    else if (type === 'pop') { tone(660, 1320, 0.09, 'sine', 0.28, 0); tone(990, 1760, 0.08, 'sine', 0.16, 0.07); }
    else if (type === 'birth') [880, 1175, 1568, 2093].forEach((f, i) => tone(f, f * 1.02, 0.14, 'sine', 0.14, i * 0.07));
    else if (type === 'sad') { tone(440, 330, 0.35, 'triangle', 0.1, 0); tone(330, 220, 0.5, 'triangle', 0.1, 0.3); }
    else if (type === 'chomp') { tone(420, 900, 0.07, 'square', 0.08, 0); tone(520, 1100, 0.06, 'square', 0.07, 0.09); }
    else if (type === 'whale') { tone(190, 110, 1.8, 'sine', 0.28, 0); tone(230, 150, 1.5, 'triangle', 0.1, 0.7); }
    else if (type === 'fanfare') [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, f * 1.01, i > 3 ? 0.5 : 0.18, 'triangle', 0.2, i * 0.13));
  }

  // ---------- Animación de cielo, agua, vida y confeti ----------
  startWater() {
    const cv = this.canvas || document.querySelector('canvas[data-water]');
    const fx = this.fx || document.querySelector('canvas[data-fx]');
    if (!cv || !fx) { this.waterRetry = setTimeout(() => this.startWater(), 100); return; }
    const ctx = cv.getContext('2d'), fctx = fx.getContext('2d');
    // lienzo auxiliar (fuera de pantalla) para la capa de agua que cubre la fachada
    const wcv = document.createElement('canvas'), wctx = wcv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      W = r.width; H = r.height;
      [cv, fx, wcv].forEach((el) => { el.width = Math.round(W * dpr); el.height = Math.round(H * dpr); });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); fctx.setTransform(dpr, 0, 0, dpr, 0, 0); wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    this.onResize = resize;
    window.addEventListener('resize', resize);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const START = new Date('2025-11-01T00:00:00').getTime();
    const END = new Date('2028-10-01T00:00:00').getTime();
    const waves = [
      { A: 12, L: 560, S: 0.55, P: 0 },
      { A: 7, L: 310, S: -0.9, P: 1.7 },
      { A: 3.6, L: 160, S: 1.6, P: 4.1 },
      { A: 1.8, L: 74, S: -2.4, P: 2.3 },
      { A: 0.8, L: 31, S: 3.4, P: 0.6 }
    ];
    const surf = (x, t, k, ph) => { let y = 0; for (const w of waves) y += w.A * k * Math.sin((x / w.L) * 6.2832 + t * w.S + w.P + ph); return y; };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const stars = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random() * 0.75, r: rnd(0.4, 1.4), ph: rnd(0, 6.28), sp: rnd(0.6, 2) }));
    const foam = Array.from({ length: 220 }, () => ({ x: Math.random(), d: Math.random() * Math.random() * 14, s: 0.5 + Math.random() * 1.7, v: (Math.random() - 0.5) * 0.00003, ph: Math.random() * 6.28 }));
    const bubbles = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), r: 0.8 + Math.random() * 2.8, v: 0.00003 + Math.random() * 0.00007, w: Math.random() * 6.28 }));
    const ripples = [];
    const rip = (x) => { let y = 0; for (const r of ripples) { const age = T - r.t; const spread = 30 + age * 140; y += r.A * Math.exp(-age * 1.4) * Math.exp(-Math.pow((x - r.x) / spread, 2)) * Math.sin((x - r.x) / 10 - age * 9); } return y; };
    const FISH_COLS = [[59, 229, 138], [255, 210, 122], [92, 200, 255], [255, 107, 139]];
    // ---- Ciclo de vida con tiempo real (escala de días) ----
    // El tiempo corre aunque la web esté cerrada: todo se calcula con timestamps.
    // saciedad = fedLevel − días_desde_fedAt / 7  ·  muerte tras 3 días a 0  ·  cría → adulta en 5 días
    const DAY = 86400000;
    let simClock = Date.now(); // en vista previa "velocidad: rapida" 1 día = 1 minuto
    const satiety = (f, now) => Math.max(0, f.fedLevel - (now - f.fedAt) / (7 * DAY));
    const FULL = 0.9; // a partir de aquí el pez está lleno y no va a por comida
    const deathAt = (f) => f.fedAt + (f.fedLevel * 7 + 3) * DAY;
    // nombres para los peces (sin repetir mientras queden libres)
    const NAMES = ['Pancho', 'Lola', 'Boquerón', 'Chanquete', 'Manolo', 'Curro', 'Rocío', 'Paco', 'Pepa', 'Chispa', 'Burbuja', 'Coral', 'Perla', 'Pipo', 'Triana', 'Biznaga', 'Espeto', 'Malagueta', 'Toñi', 'Fermín', 'Kiko', 'Rita', 'Gamba', 'Sardinita', 'Tula', 'Bombón', 'Canela', 'Fideo', 'Olivia', 'Pepino', 'Brisa', 'Marea', 'Remo', 'Faro', 'Ancla', 'Capitán', 'Almeja', 'Calamar', 'Croqueta', 'Limón', 'Luna', 'Turrón', 'Bruno', 'Vera', 'Leo', 'Mía', 'Churri', 'Pitita', 'Moraga', 'Jazmín'];
    const usedNames = new Set();
    const pickName = () => {
      const free = NAMES.filter((n) => !usedNames.has(n));
      const n = free.length ? free[Math.floor(Math.random() * free.length)] : NAMES[Math.floor(Math.random() * NAMES.length)] + ' II';
      usedNames.add(n);
      return n;
    };
    let hovered = null;
    const newFish = (x, d, baby, now) => {
      const adultS = rnd(7, 17);
      return { id: Math.random().toString(36).slice(2), name: pickName(), x, d: d == null ? rnd(0.12, 0.9) : d, s: baby ? 3.5 : adultS, adultS, adult: !baby, bornAt: baby ? now : now - rnd(20, 120) * DAY, fedAt: now, fedLevel: baby ? 0.6 : rnd(0.7, 1.1), breedAt: 0, v: rnd(0.025, 0.07), dir: Math.random() < 0.5 ? -1 : 1, ph: rnd(0, 6.28), wob: rnd(0, 6.28), col: FISH_COLS[Math.floor(Math.random() * 4)], boost: 0, food: 1, dead: false, front: Math.random() < 0.5 };
    };
    // Población inicial: los peces guardados en Netlify Blobs. Si no hay servidor (abriendo el
    // archivo en local) se simula que la última visita fue hace "diasSinVisitar" días.
    let fishes = null;
    let awayDays = 0, diedAway = 0;
    const saved = this.loadPond();
    if (saved) {
      const lastVisit = this.lastVisit; // de este dispositivo
      awayDays = lastVisit ? Math.floor((simClock - lastVisit) / DAY) : 0;
      fishes = [];
      for (const s of saved) {
        const f = Object.assign(newFish(s.x, s.d, false, simClock), s);
        usedNames.add(f.name);
        f.s = f.adult ? f.adultS : 3.5 + (f.adultS - 3.5) * Math.min(1, (simClock - f.bornAt) / (5 * DAY));
        const da = f.dead ? (f.diedAt || deathAt(f)) : deathAt(f);
        if (lastVisit && da > lastVisit && da < simClock) diedAway++;
        if (da < simClock - DAY) continue; // murió hace más de un día: ya no se ve
        if (da < simClock) { f.dead = true; f.diedAt = da; f.deadY = null; f.fade = 1; }
        fishes.push(f);
      }
      if (!saved.length) {
        // primera vez: estanque nuevo con 14 peces bien alimentados
        for (let i = 0; i < 14; i++) fishes.push(newFish(Math.random(), null, false, simClock));
        this.savePond(fishes);
      }
    }
    if (!fishes) {
      awayDays = Math.max(0, Number(this.props.diasSinVisitar ?? 0));
      fishes = [];
      for (let i = 0; i < 14; i++) {
        const f = newFish(Math.random(), null, false, simClock);
        f.fedAt = simClock - awayDays * DAY - rnd(0, 1.5) * DAY;
        f.fedLevel = rnd(0.7, 1.1);
        const da = deathAt(f);
        if (da < simClock - DAY) { diedAway++; continue; }
        if (da < simClock) { diedAway++; f.dead = true; f.deadY = null; f.fade = 1; }
        fishes.push(f);
      }
    }
    if (awayDays > 0) {
      const hungry = fishes.filter((f) => !f.dead && satiety(f, simClock) < 0.3).length;
      const parts = ['Hace ' + awayDays + (awayDays === 1 ? ' día' : ' días') + ' que no venís.'];
      if (diedAway) parts.push(diedAway + (diedAway === 1 ? ' pez no lo ha aguantado.' : ' peces no lo han aguantado.'));
      if (hungry) parts.push(hungry + ' tienen hambre: ¡dadles hype!');
      else if (!diedAway) parts.push('Todos están bien alimentados.');
      this.setState({ awayMsg: parts.join(' ') });
      clearTimeout(this.awayT);
      this.awayT = setTimeout(() => this.setState({ awayMsg: null }), 11000);
    }
    const jellies = Array.from({ length: 3 }, () => ({ x: Math.random(), d: rnd(0.3, 0.75), s: rnd(14, 22), ph: rnd(0, 6.28), vx: rnd(-0.004, 0.004) }));
    const weeds = Array.from({ length: 18 }, () => ({ x: Math.random(), h: rnd(50, 150), w: rnd(2, 5), ph: rnd(0, 6.28), tone: rnd(0.18, 0.4) }));
    const boat = { x: 0.68, v: 0.0000025 };
    // corales esparcidos por la montaña del arrecife (y algunos sueltos por el fondo)
    const CORAL_TYPES = ['branch', 'fan', 'grass', 'anem', 'brain', 'tube'];
    const CORAL_COLS = ['#FF6B8B', '#FF9F6B', '#C49BFF', '#FFD27A', '#5CC8FF', '#3BE58A'];
    // 0–17: laderas · 18–27: centro de la montaña (bajo el arrecife) · 28–39: sueltos por el fondo
    const corals = Array.from({ length: 40 }, (_, i) => ({
      wide: i >= 28, xr: Math.random(),
      mid: i >= 18 && i < 28, yo: rnd(0.25, 0.8),
      u: i >= 18 && i < 28 ? rnd(-0.5, 0.5) : (Math.random() < 0.5 ? -1 : 1) * rnd(0.5, 1.7),
      type: CORAL_TYPES[i % CORAL_TYPES.length],
      s: rnd(0.55, 1.2), col: CORAL_COLS[Math.floor(Math.random() * CORAL_COLS.length)], ph: rnd(0, 6.28)
    })).sort((a, b) => a.s - b.s);
    // corales que trepan un poco por la base del edificio
    const baseCorals = [
      { xr: 0.42, dy: 16, type: 'anem', s: 0.6, col: '#C49BFF', ph: 3 },
      { xr: 0.71, dy: 2, type: 'branch', s: 0.6, col: '#FF6B8B', ph: 4 }
    ];
    const drawCoral = (c2, k, x, y, a, alpha) => {
      c2.save(); c2.translate(x, y); c2.rotate(a); c2.scale(k.s, k.s);
      c2.globalAlpha = alpha; c2.lineCap = 'round'; c2.lineJoin = 'round';
      c2.strokeStyle = k.col; c2.fillStyle = k.col;
      if (k.type === 'branch') {
        c2.lineWidth = 3.5; c2.beginPath();
        c2.moveTo(0, 0); c2.lineTo(0, -24); c2.moveTo(0, -12); c2.lineTo(-10, -24); c2.moveTo(0, -18); c2.lineTo(10, -32);
        c2.moveTo(-10, -24); c2.lineTo(-13, -34); c2.moveTo(10, -32); c2.lineTo(13, -42); c2.moveTo(0, -24); c2.lineTo(-3, -36);
        c2.stroke();
      } else if (k.type === 'fan') {
        c2.beginPath(); c2.moveTo(0, 0); c2.bezierCurveTo(-18, -14, -16, -38, 0, -42); c2.bezierCurveTo(16, -38, 18, -14, 0, 0); c2.fill();
        c2.globalAlpha = alpha * 0.55; c2.strokeStyle = '#0A1411'; c2.lineWidth = 1.2; c2.beginPath();
        c2.moveTo(0, 0); c2.lineTo(0, -38); c2.moveTo(0, -14); c2.lineTo(-9, -28); c2.moveTo(0, -14); c2.lineTo(9, -28); c2.moveTo(0, -24); c2.lineTo(-6, -36); c2.moveTo(0, -24); c2.lineTo(6, -36); c2.stroke();
      } else if (k.type === 'grass') {
        c2.lineWidth = 2.5; c2.strokeStyle = '#2CB56B'; c2.beginPath();
        for (let q = -2; q <= 2; q++) { c2.moveTo(q * 4, 0); c2.quadraticCurveTo(q * 4 + Math.sin(T * 1.3 + k.ph + q) * 6, -18, q * 5 + Math.sin(T * 1.1 + q) * 4, -30 + Math.abs(q) * 3); }
        c2.stroke();
      } else if (k.type === 'anem') {
        c2.lineWidth = 2.2; c2.beginPath();
        for (let q = -3; q <= 3; q++) { c2.moveTo(q * 2.5, -4); c2.quadraticCurveTo(q * 4 + Math.sin(T * 2 + q + k.ph) * 4, -14, q * 5.5 + Math.sin(T * 2.4 + q) * 3, -22); }
        c2.stroke(); c2.beginPath(); c2.ellipse(0, -2, 8, 5, 0, 0, 6.2832); c2.fill();
      } else if (k.type === 'brain') {
        c2.beginPath(); c2.ellipse(0, 0, 16, 12, 0, Math.PI, 0); c2.closePath(); c2.fill();
        c2.globalAlpha = alpha * 0.5; c2.strokeStyle = '#0A1411'; c2.lineWidth = 1.2; c2.beginPath();
        c2.moveTo(-11, -2); c2.quadraticCurveTo(-6, -10, 0, -4); c2.quadraticCurveTo(6, -10, 11, -2);
        c2.moveTo(-7, -6); c2.quadraticCurveTo(0, -12, 7, -6); c2.stroke();
      } else {
        const hs = [18, 28, 22];
        for (let q = 0; q < 3; q++) {
          const tx = (q - 1) * 7;
          c2.beginPath(); if (c2.roundRect) c2.roundRect(tx - 3, -hs[q], 6, hs[q], 3); else c2.rect(tx - 3, -hs[q], 6, hs[q]); c2.fill();
          c2.save(); c2.globalAlpha = alpha * 0.6; c2.fillStyle = '#0A1411'; c2.beginPath(); c2.ellipse(tx, -hs[q] + 1.5, 2.2, 1.2, 0, 0, 6.2832); c2.fill(); c2.restore();
        }
      }
      c2.restore();
    };
    // skyline de la costa y palmeras (detrás del agua)
    const skyline = [];
    { let sx = -20; while (sx < 2800) { const w = rnd(46, 120); skyline.push({ x: sx, w, h: rnd(40, 170), wins: Array.from({ length: 14 }, () => ({ fx: Math.random(), fy: Math.random(), on: Math.random() < 0.35 })) }); sx += w + rnd(-8, 30); } }
    const palms = Array.from({ length: 8 }, () => ({ x: Math.random(), h: rnd(70, 120), lean: rnd(-0.25, 0.25), ph: rnd(0, 6.28) }));
    const jumps = []; let nextJump = 5;
    const drops = [], sparks = [], confetti = [], fireworks = [];
    let whale = null, nextFirework = 0, nextSpout = 0;
    const CONF = ['#3BE58A', '#FFD27A', '#FF6B8B', '#5CC8FF', '#C49BFF', '#FFFFFF'];
    let mouse = { x: -999, y: -999 }, lastRip = 0;
    this.onMove = (e) => {
      const r = cv.getBoundingClientRect();
      const nx = e.clientX - r.left, ny = e.clientY - r.top, nt = performance.now();
      const v = mouse.t ? Math.hypot(nx - mouse.x, ny - mouse.y) / Math.max(1, nt - mouse.t) : 0;
      mouse = { x: nx, y: ny, t: nt, v: Math.max(v, (mouse.v || 0) * 0.5) };
      if (this.levelNow != null && Math.abs(mouse.y - this.levelNow) < 36 && T - lastRip > 0.12) { ripples.push({ x: mouse.x, t: T, A: 4 }); lastRip = T; }
    };
    window.addEventListener('pointermove', this.onMove);
    const drawFish = (x, y, s, dir, ph, col, a, ang, happy, g = ctx) => {
      g.save(); g.translate(x, y); g.rotate(ang || 0); g.scale(dir, 1);
      g.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + a + ')';
      g.beginPath(); g.ellipse(0, 0, s, s * 0.42, 0, 0, 6.2832); g.fill();
      const tw = Math.sin(ph) * s * 0.18;
      g.beginPath(); g.moveTo(-s * 0.8, 0); g.lineTo(-s * 1.55, -s * 0.5 + tw); g.lineTo(-s * 1.4, tw * 0.3); g.lineTo(-s * 1.55, s * 0.5 + tw); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-s * 0.2, -s * 0.38); g.quadraticCurveTo(s * 0.1, -s * 0.8, s * 0.35, -s * 0.36); g.fill();
      g.fillStyle = 'rgba(255,255,255,' + a * 0.35 + ')';
      g.beginPath(); g.ellipse(s * 0.1, -s * 0.12, s * 0.55, s * 0.12, -0.1, 0, 6.2832); g.fill();
      g.fillStyle = 'rgba(4,16,12,' + a + ')';
      g.beginPath(); g.arc(s * 0.55, -s * 0.06, Math.max(1, s * 0.08), 0, 6.2832); g.fill();
      if (happy && s > 7) {
        g.strokeStyle = 'rgba(4,16,12,' + a + ')'; g.lineWidth = Math.max(1, s * 0.07);
        g.beginPath(); g.arc(s * 0.68, s * 0.08, s * 0.16, 0.3, 2.4); g.stroke();
        g.fillStyle = 'rgba(255,107,139,' + a * 0.6 + ')';
        g.beginPath(); g.arc(s * 0.42, s * 0.12, s * 0.09, 0, 6.2832); g.fill();
      }
      g.restore();
    };
    const heartPath = (c2, x, y, s) => {
      c2.beginPath();
      c2.moveTo(x, y + s * 0.35);
      c2.bezierCurveTo(x - s * 0.9, y - s * 0.25, x - s * 0.45, y - s * 0.95, x, y - s * 0.45);
      c2.bezierCurveTo(x + s * 0.45, y - s * 0.95, x + s * 0.9, y - s * 0.25, x, y + s * 0.35);
    };
    const burst = (cx, cy, n) => {
      for (let k = 0; k < n; k++) {
        const a = rnd(-Math.PI, 0), sp = rnd(250, 700);
        confetti.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: rnd(0, 6.28), vr: rnd(-8, 8), w: rnd(6, 11), h: rnd(3, 6), col: CONF[k % CONF.length], flip: rnd(0, 6.28) });
      }
    };
    let last = performance.now(), T = 0;
    const frame = (now) => {
      const dt = Math.min(50, now - last); last = now;
      const dts = dt / 1000;
      if (!reduce) T += dts;
      simClock += dt * (this.props.velocidad === 'rapida' ? 1440 : 1);
      mouse.v = (mouse.v || 0) * 0.9;
      const party = !!this.partyNow;
      const sky = this.skyNow || { day: 0, tw: 0, u: -1, v: 0.5 };
      const hex = (this.props.accent ?? '#3BE58A').replace('#', '');
      const R = parseInt(hex.slice(0, 2), 16), G = parseInt(hex.slice(2, 4), 16), B = parseInt(hex.slice(4, 6), 16);
      const c = (a) => 'rgba(' + R + ',' + G + ',' + B + ',' + a + ')';
      const p = Math.max(0, Math.min(1, (Date.now() - START) / (END - START))) * this.state.intro;
      ctx.clearRect(0, 0, W, H);
      fctx.clearRect(0, 0, W, H);

      // --- cielo: estrellas, luna y sol ---
      const night = 1 - sky.day;
      if (night > 0.05) {
        for (const s of stars) {
          const a = night * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(T * s.sp + s.ph))) * 0.8;
          ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 6.2832); ctx.fillStyle = 'rgba(235,245,255,' + a + ')'; ctx.fill();
        }
      }
      let sunX = null, sunA = 0;
      if (sky.u > -0.05 && sky.u < 1.05) {
        sunX = W * (0.08 + 0.84 * sky.u);
        const sy = H * (0.8 - 0.62 * Math.sin(Math.PI * Math.max(0, Math.min(1, sky.u))));
        sunA = Math.min(1, sky.day + sky.tw);
        const g = ctx.createRadialGradient(sunX, sy, 0, sunX, sy, 160);
        g.addColorStop(0, 'rgba(255,226,170,' + 0.35 * sunA + ')'); g.addColorStop(1, 'rgba(255,190,120,0)');
        ctx.fillStyle = g; ctx.fillRect(sunX - 160, sy - 160, 320, 320);
        ctx.beginPath(); ctx.arc(sunX, sy, 24, 0, 6.2832); ctx.fillStyle = 'rgba(255,238,200,' + 0.9 * sunA + ')'; ctx.fill();
      }
      let moonX = null;
      if (sky.v >= 0 && sky.v <= 1 && night > 0.3) {
        moonX = W * (0.08 + 0.84 * sky.v);
        const my = H * (0.78 - 0.6 * Math.sin(Math.PI * sky.v));
        const g = ctx.createRadialGradient(moonX, my, 0, moonX, my, 90);
        g.addColorStop(0, 'rgba(210,225,255,' + 0.18 * night + ')'); g.addColorStop(1, 'rgba(210,225,255,0)');
        ctx.fillStyle = g; ctx.fillRect(moonX - 90, my - 90, 180, 180);
        ctx.beginPath(); ctx.arc(moonX, my, 20, 0, 6.2832); ctx.fillStyle = 'rgba(238,242,220,' + 0.95 * night + ')'; ctx.fill();
        ctx.save(); ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(moonX + 9, my - 5, 17, 0, 6.2832); ctx.fillStyle = 'rgba(0,0,0,0.92)'; ctx.fill(); ctx.restore();
      }
      // --- fuegos artificiales en días de celebración ---
      if (party && !reduce && T > nextFirework) {
        nextFirework = T + rnd(1.1, 2.2);
        const fxX = rnd(0.12, 0.88) * W, fxY = rnd(0.1, 0.38) * H, col = CONF[Math.floor(Math.random() * 5)];
        for (let k = 0; k < 70; k++) { const a = (k / 70) * 6.2832, sp = rnd(60, 190); fireworks.push({ x: fxX, y: fxY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, col }); }
        this.sfx('pop');
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let k = fireworks.length - 1; k >= 0; k--) {
        const f = fireworks[k];
        f.vy += 70 * dts; f.vx *= 0.985; f.vy *= 0.985; f.x += f.vx * dts; f.y += f.vy * dts; f.life -= dts * 0.7;
        if (f.life <= 0) { fireworks.splice(k, 1); continue; }
        ctx.globalAlpha = f.life; ctx.beginPath(); ctx.arc(f.x, f.y, 1.8, 0, 6.2832); ctx.fillStyle = f.col; ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      // posición del edificio en pantalla (para que el agua lo bañe por delante)
      if (!this.bRect || T - (this.bRectT || 0) > 0.5) {
        this.bRectT = T;
        const el = document.querySelector('[data-bldg]');
        const r0 = cv.getBoundingClientRect();
        if (el) { const r1 = el.getBoundingClientRect(); this.bRect = { x: r1.left - r0.left, y: r1.top - r0.top, w: r1.width, h: r1.height }; }
        const rf = document.querySelector('[data-reef]');
        if (rf) { const r2 = rf.getBoundingClientRect(); this.rRect = { x: r2.left - r0.left, w: r2.width, y: r2.top - r0.top, h: r2.height }; }
      }

      // --- fondo marino: suelo con dunas que sube en un montículo bajo el arrecife ---
      {
        const rr = this.rRect;
        const cx = rr ? rr.x + rr.w / 2 : W * 0.8;
        const peak = rr ? rr.y + rr.h * 0.55 : H - 60;
        const base = H - 36;
        const mh = Math.max(0, base - peak);
        const spread = rr ? rr.w * 0.62 : 180;
        const ground = (x) => base - 7 * Math.sin(x / 95) - 4 * Math.sin(x / 37 + 1.3) - mh * Math.exp(-Math.pow((x - cx) / spread, 2));
        const sea = new Path2D();
        sea.moveTo(0, H);
        for (let x = 0; x <= W + 8; x += 8) {
          sea.lineTo(x, ground(x));
        }
        sea.lineTo(W, H); sea.closePath();
        const sg = ctx.createLinearGradient(0, peak, 0, H);
        sg.addColorStop(0, '#1A2E27'); sg.addColorStop(0.5, '#13231E'); sg.addColorStop(1, '#0A1411');
        ctx.fillStyle = sg; ctx.fill(sea);
        // piedrecitas y manchas en el suelo
        ctx.save(); ctx.clip(sea);
        for (let i = 0; i < 60; i++) {
          const px = (i * 97.3) % W, py = H - 10 - ((i * 53.1) % 40);
          ctx.beginPath(); ctx.ellipse(px, py, 3 + (i % 4) * 2, 1.5 + (i % 3), 0, 0, 6.2832);
          ctx.fillStyle = i % 5 === 0 ? 'rgba(255,210,122,0.12)' : 'rgba(36,57,47,0.8)'; ctx.fill();
        }
        ctx.restore();
        // corales sobre la ladera
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const k of corals) {
          const x = k.wide ? k.xr * W : cx + k.u * spread;
          if (x < -20 || x > W + 20) continue;
          const y = ground(x) + 3 + (k.mid ? k.yo * mh : 0);
          const a = Math.sin(T * 0.9 + k.ph) * 0.09;
          drawCoral(ctx, k, x, y, a, 0.85);
        }
        ctx.globalAlpha = 1;
        // unos pocos corales en la base del edificio (delante), para que no haya un corte limpio
        const bB = this.bRect;
        if (bB) {
          const by0 = bB.y + bB.h;
          for (const k of baseCorals) drawCoral(fctx, k, bB.x + k.xr * bB.w, by0 + k.dy, Math.sin(T * 0.9 + k.ph) * 0.09, 0.9);
          fctx.globalAlpha = 1;
        }
      }
      if (p > 0.002 && W > 0) {
        const level = H * (1 - p);
        const amp = Math.min(1, (H - level) / 60) * (party ? 1.25 : 1);
        const step = 6;
        // capa de fondo (olas lejanas)
        ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W + step; x += step) ctx.lineTo(x, level - 9 + surf(x * 1.35 + 400, T * 0.7, 0.75 * amp, 2));
        ctx.lineTo(W, H); ctx.closePath();
        ctx.fillStyle = c(0.07); ctx.fill();
        // cuerpo principal
        const pts = [];
        for (let x = 0; x <= W + step; x += step) pts.push([x, level + surf(x, T, amp, 0) + rip(x)]);
        this.levelNow = level;
        const body = new Path2D();
        body.moveTo(0, H);
        for (const q of pts) body.lineTo(q[0], q[1]);
        body.lineTo(W, H); body.closePath();
        const gr = ctx.createLinearGradient(0, level - 16, 0, H);
        gr.addColorStop(0, c(0.18 + 0.08 * sky.day));
        gr.addColorStop(0.08, c(0.11 + 0.06 * sky.day));
        gr.addColorStop(0.45, 'rgba(6,34,28,0.45)');
        gr.addColorStop(1, 'rgba(3,14,12,0.7)');
        ctx.fillStyle = gr; ctx.fill(body);
        ctx.save(); ctx.clip(body);
        ctx.globalCompositeOperation = 'lighter';
        // reflejo del sol o la luna en el agua
        const refX = sunX != null && sunA > 0.2 ? sunX : moonX;
        if (refX != null) {
          const ra = sunX != null && sunA > 0.2 ? 0.35 * sunA : 0.18 * night;
          const refCol = sky.tw > 0.35 ? '255,170,110' : (sunX != null && sunA > 0.2 ? '255,235,190' : '220,232,255');
          for (let y = level - 6; y < Math.min(H, level + 220); y += 5) {
            const k = 1 - (y - level) / 220;
            const wdt = 14 + (y - level) * 0.35;
            const xo = Math.sin(y * 0.18 + T * 3) * wdt * 0.6;
            ctx.fillStyle = 'rgba(' + refCol + ',' + ra * k * (0.5 + 0.5 * Math.sin(y * 0.7 + T * 5)) + ')';
            ctx.fillRect(refX + xo - wdt / 2, y, wdt, 2);
          }
        }
        // rayos de luz
        for (let i = 0; i < 7; i++) {
          const x0 = W * (i + 0.5) / 7 + Math.sin(T * 0.25 + i * 1.7) * 70;
          const wTop = 26 + 16 * Math.sin(T * 0.4 + i);
          const lg = ctx.createLinearGradient(0, level, 0, level + (H - level) * 0.85);
          lg.addColorStop(0, c((0.03 + 0.06 * sky.day) + 0.03 * Math.sin(T * 0.8 + i * 2)));
          lg.addColorStop(1, c(0));
          ctx.fillStyle = lg;
          ctx.beginPath();
          ctx.moveTo(x0 - wTop, level); ctx.lineTo(x0 + wTop, level);
          ctx.lineTo(x0 + wTop * 2.4 + 90, H); ctx.lineTo(x0 + 50, H); ctx.closePath(); ctx.fill();
        }
        // cáusticas
        for (let i = 0; i < 26; i++) {
          const cx = ((i * 157.3 + T * 18 * (i % 2 ? 1 : -1)) % (W + 200) + W + 200) % (W + 200) - 100;
          const cy = level + 24 + (i % 5) * 18 + Math.sin(T + i) * 6;
          const rr = 30 + (i % 4) * 14;
          const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
          rg.addColorStop(0, c(0.05 + 0.03 * Math.sin(T * 1.3 + i)));
          rg.addColorStop(1, c(0));
          ctx.fillStyle = rg; ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
        }
        const depth = H - level;
        // medusas
        for (const j of jellies) {
          if (!reduce) { j.x += j.vx * dts; if (j.x < -0.05) j.x = 1.05; if (j.x > 1.05) j.x = -0.05; }
          if (depth < 140) continue;
          const jx = j.x * W, jy = level + 50 + (depth - 130) * j.d + Math.sin(T * 0.5 + j.ph) * 22;
          const pu = 1 + 0.16 * Math.sin(T * (party ? 4 : 2.2) + j.ph);
          const s = j.s;
          const jg = ctx.createRadialGradient(jx, jy - s * 0.2, 0, jx, jy, s * 1.6);
          jg.addColorStop(0, 'rgba(214,180,255,0.35)'); jg.addColorStop(1, 'rgba(196,155,255,0)');
          ctx.fillStyle = jg; ctx.fillRect(jx - s * 2, jy - s * 2, s * 4, s * 4);
          ctx.beginPath(); ctx.ellipse(jx, jy, s * pu, s * 0.8 / pu, 0, Math.PI, 0); ctx.quadraticCurveTo(jx, jy + s * 0.25, jx - s * pu, jy);
          ctx.fillStyle = 'rgba(214,180,255,0.28)'; ctx.fill();
          ctx.strokeStyle = 'rgba(230,210,255,0.45)'; ctx.lineWidth = 1; ctx.stroke();
          for (let k = 0; k < 5; k++) {
            const tx = jx - s * 0.6 * pu + k * (s * 1.2 * pu / 4);
            ctx.beginPath(); ctx.moveTo(tx, jy + 2);
            for (let q = 1; q <= 8; q++) ctx.lineTo(tx + Math.sin(T * 2 + q * 0.7 + k + j.ph) * 3, jy + 2 + q * s * 0.3);
            ctx.strokeStyle = 'rgba(220,190,255,0.22)'; ctx.stroke();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
        // algas
        for (const wd of weeds) {
          const h = Math.min(wd.h, depth * 0.55);
          if (h < 12) continue;
          const bx = wd.x * W;
          ctx.beginPath(); ctx.moveTo(bx, H + 2);
          for (let k = 1; k <= 10; k++) ctx.lineTo(bx + Math.sin(T * (party ? 1.8 : 0.9) + wd.ph + k * 0.4) * k * 1.4, H - h * k / 10);
          ctx.strokeStyle = c(wd.tone); ctx.lineWidth = wd.w; ctx.lineCap = 'round'; ctx.stroke();
        }
        // ballena (al llegar a una cifra redonda de hype)
        if (this.whaleReq) { whale = { t: T }; this.whaleReq = false; nextSpout = T + 1.5; }
        if (whale) {
          const k = (T - whale.t) / 18;
          if (k > 1) whale = null;
          else {
            const wx = -260 + (W + 520) * k;
            const wy = level + Math.max(34, Math.min(depth * 0.5, 160));
            const L = 150;
            ctx.save(); ctx.translate(wx, wy); ctx.rotate(Math.sin(T * 0.8) * 0.04);
            ctx.fillStyle = 'rgba(16,52,66,0.85)';
            ctx.beginPath(); ctx.ellipse(0, 0, L * 0.5, L * 0.17, 0, 0, 6.2832); ctx.fill();
            ctx.beginPath(); ctx.moveTo(-L * 0.42, -4); ctx.quadraticCurveTo(-L * 0.62, -2, -L * 0.7, -L * 0.13 + Math.sin(T * 2) * 6); ctx.lineTo(-L * 0.64, 0); ctx.lineTo(-L * 0.7, L * 0.13 + Math.sin(T * 2) * 6); ctx.quadraticCurveTo(-L * 0.62, 2, -L * 0.42, 4); ctx.fill();
            ctx.fillStyle = 'rgba(150,200,210,0.35)';
            ctx.beginPath(); ctx.ellipse(L * 0.05, L * 0.08, L * 0.38, L * 0.07, 0, 0, 3.1416); ctx.fill();
            ctx.fillStyle = 'rgba(16,52,66,0.85)';
            ctx.beginPath(); ctx.ellipse(L * 0.02, L * 0.15, L * 0.12, L * 0.04, 0.5, 0, 6.2832); ctx.fill();
            ctx.fillStyle = 'rgba(230,255,244,0.9)';
            ctx.beginPath(); ctx.arc(L * 0.36, -L * 0.03, 2.4, 0, 6.2832); ctx.fill();
            ctx.restore();
            if (T > nextSpout && wx > 0 && wx < W) {
              nextSpout = T + 3.2;
              for (let q = 0; q < 26; q++) drops.push({ x: wx + L * 0.25, y: level - 2, vx: rnd(-50, 50), vy: rnd(-380, -220) });
            }
          }
        }
        // peces (huyen del ratón; en celebración van más rápido y saltan de alegría)
        // estanque vacío: un corazón que se hunde se convierte en huevas y nacen peces nuevos
        if (!fishes.some((f) => !f.dead)) {
          for (const hh of heartsLive) {
            if (hh.inWater && !hh.eaten && hh.y > level + 50) {
              hh.eaten = true;
              for (let q = 0; q < 3; q++) fishes.push(newFish(hh.x / W + rnd(-0.01, 0.01), Math.max(0, (hh.y - level - 28) / Math.max(1, depth - 60)), true, simClock));
              this.savePond(fishes);
              for (let q = 0; q < 10; q++) sparks.push({ x: hh.x, y: hh.y, vx: rnd(-80, 80), vy: rnd(-140, -40), life: 0.8, s: rnd(3, 6) });
              this.sfx('birth');
            }
          }
        }
        // cada corazón que cae al agua atrae a los peces más cercanos (hasta 3 compiten por él)
        for (const hh of heartsLive) {
          if (!hh.inWater || hh.eaten) continue;
          if (fishes.filter((f) => f.target === hh).length >= 3) continue;
          let best = null, bd = 1e12;
          for (const f of fishes) {
            if (f.target || f.dead || satiety(f, simClock) > FULL) continue;
            const d2 = Math.pow(f.x * W - hh.x, 2) + Math.pow((f.py == null ? level : f.py) - hh.y, 2);
            if (d2 < bd) { bd = d2; best = f; }
          }
          if (best) best.target = hh;
        }
        const span = Math.max(1, depth - 60);
        const babies = [];
        // cada pez nada delante o detrás del edificio; los de delante se pintan más abajo, bajo la capa de agua de la fachada
        const frontFish = [];
        const paintFish = (f, ...args) => { if (f.front) frontFish.push(args); else drawFish(...args); };
        let hov = null, hovD = 1e12;
        for (let i = fishes.length - 1; i >= 0; i--) {
          const f = fishes[i];
          if (f.dead) {
            // pez muerto: panza arriba, sube a la superficie y se desvanece
            if (f.deadY == null) f.deadY = level + 6;
            if (!reduce) f.deadY = Math.max(level + 6, f.deadY - 24 * dts);
            if (f.deadY <= level + 6) f.fade -= dts / 5;
            if (f.fade <= 0) { fishes.splice(i, 1); continue; }
            if (depth >= 50) {
              paintFish(f, f.x * W, f.deadY + Math.sin(T * 1.5 + f.wob) * 2, f.s, f.dir, 0, [150, 158, 152], 0.65 * f.fade, Math.PI, false);
              const ddx = f.x * W - mouse.x, ddy = f.deadY - mouse.y, dd = ddx * ddx + ddy * ddy, rr = f.s * 1.4 + 10;
              if (dd < rr * rr && dd < hovD) { hovD = dd; hov = f; }
            }
            continue;
          }
          // hambre por tiempo real: de lleno a 0 en 7 días; tras 3 días a 0, muere
          f.food = satiety(f, simClock);
          if (simClock > deathAt(f)) {
            f.dead = true; f.diedAt = deathAt(f); f.deadY = f.py == null ? level + 40 : f.py; f.fade = 1; f.target = null;
            this.sfx('sad');
            this.savePond(fishes);
            continue;
          }
          // las crías tardan 5 días en hacerse adultas
          if (!f.adult) { const gk = Math.min(1, (simClock - f.bornAt) / (5 * DAY)); f.s = 3.5 + (f.adultS - 3.5) * gk; if (gk >= 1) f.adult = true; }
          const vigor = 0.45 + 0.55 * Math.min(1, f.food / 0.3);
          if (f.target && (f.target.eaten || heartsLive.indexOf(f.target) < 0)) f.target = null;
          // los corazones caen por delante: quien va a por uno sale delante (si no está tapado, para que no aparezca de golpe)
          if (f.target && !f.front) {
            const b = this.bRect, lo = b && Math.min(b.x, (this.rRect || b).x) - f.s * 2, hi = b && b.x + b.w + f.s * 2;
            if (!b || f.x * W < lo || f.x * W > hi) f.front = true;
          }
          if (f.target && !reduce) {
            // nada hacia la comida
            const dxT = f.target.x / W - f.x;
            f.dir = dxT >= 0 ? 1 : -1;
            f.x += Math.sign(dxT) * Math.min(Math.abs(dxT), 0.17 * vigor * dt / Math.max(1, W));
            const td = Math.max(-20 / span, Math.min(1, (f.target.y - level - 28) / span));
            f.d += (td - f.d) * Math.min(1, dts * 2.5);
            f.ph += dt * 0.035;
          }
          let fy = level + 28 + span * f.d + (f.target ? 0 : Math.sin(T * 0.8 + f.wob) * 6);
          if (party && !f.target) fy -= Math.abs(Math.sin(T * 3 + f.wob)) * Math.min(18, Math.max(0, f.d) * depth * 0.2);
          if (!f.target) {
            const dx = f.x * W - mouse.x, dy = fy - mouse.y;
            // solo huyen si el ratón se mueve rápido; si te acercas despacio se quedan mirándote
            if (f !== hovered && mouse.v > 0.8 && dx * dx + dy * dy < 120 * 120) { f.dir = dx >= 0 ? 1 : -1; f.boost = 1; }
            f.boost = Math.max(0, f.boost - dt / 900);
            const spd = (party ? 1.7 : 1) * (1 + f.boost * 3) * vigor;
            if (!reduce) {
              if (f === hovered) { f.dir = mouse.x >= f.x * W ? 1 : -1; f.ph += dt * 0.006; }
              else { f.x += f.dir * f.v * spd * dt / Math.max(1, W); f.ph += dt * 0.012 * spd; }
            }
            if (f.d < 0.05) f.d += dts * 0.2;
          }
          // al salir por un lado y entrar por el otro se sortea si pasa por delante o por detrás del edificio
          if (f.x > 1.05) { f.x = -0.05; f.d = rnd(0.12, 0.9); f.front = Math.random() < 0.5; }
          if (f.x < -0.05) { f.x = 1.05; f.d = rnd(0.12, 0.9); f.front = Math.random() < 0.5; }
          // ¡ñam! se come el corazón
          if (f.target) {
            const ex = f.x * W + f.dir * f.s * 0.6 - f.target.x, ey = fy - f.target.y;
            if (ex * ex + ey * ey < Math.pow(f.s + 10, 2)) {
              f.target.eaten = true; f.target = null; f.happy = T + 5;
              f.fedLevel = Math.min(1.2, f.food + 0.35); f.fedAt = simClock; f.food = f.fedLevel;
              this.savePond(fishes); // TODO BD: POST feed_event { fish_id, at }
              if (f.adult) f.s = f.adultS = Math.min(22, f.adultS + 0.3);
              for (let q = 0; q < 6; q++) sparks.push({ x: f.x * W, y: fy, vx: rnd(-70, 70), vy: rnd(-140, -40), life: 0.7, s: rnd(3, 6) });
              ripples.push({ x: f.x * W, t: T, A: 2 });
              this.sfx('chomp');
              // bien alimentado: nacen crías
              if (f.adult && f.food >= 1 && simClock > f.breedAt && fishes.length + babies.length < 45) {
                const n = 1 + Math.floor(Math.random() * 3);
                for (let q = 0; q < n; q++) babies.push(Object.assign(newFish(f.x + rnd(-0.015, 0.015), f.d, true, simClock), { front: f.front }));
                f.breedAt = simClock + 3 * DAY; f.fedLevel -= 0.3; f.food = f.fedLevel;
                for (let q = 0; q < 12; q++) sparks.push({ x: f.x * W, y: fy, vx: rnd(-90, 90), vy: rnd(-160, -40), life: 0.9, s: rnd(3, 7) });
                this.sfx('birth');
              }
            }
          }
          f.py = fy;
          if (depth < 50) continue;
          { const hx2 = f.x * W - mouse.x, hy2 = fy - mouse.y, d2 = hx2 * hx2 + hy2 * hy2, rr = f.s * 1.4 + 10; if (d2 < rr * rr && d2 < hovD) { hovD = d2; hov = f; } }
          // con hambre pierden color
          const hk = f.food < 0.3 ? 1 - f.food / 0.3 : 0;
          const col = f.col.map((v, q) => Math.round(v + ([128, 138, 132][q] - v) * hk * 0.8));
          paintFish(f, f.x * W, fy, f.s, f.dir, f.ph, col, (0.55 + 0.25 * (1 - Math.max(0, f.d)) + (party ? 0.15 : 0)) * (1 - hk * 0.3), 0, party || (f.happy || 0) > T);
        }
        hovered = hov;
        if (babies.length) { fishes.push(...babies); this.savePond(fishes); }
        // contador de peces para la cabecera
        if (T - (this.popT || 0) > 0.5) {
          this.popT = T;
          const a = fishes.filter((f) => !f.dead);
          const hg = a.filter((f) => f.food < 0.3).length;
          if (a.length !== this.state.fishAlive || hg !== this.state.fishHungry) this.setState({ fishAlive: a.length, fishHungry: hg });
        }
        // burbujas
        for (const b of bubbles) {
          if (!reduce) b.y -= b.v * dt * (party ? 2 : 1);
          if (b.y < 0) { b.y = 1; b.x = Math.random(); }
          const bx = b.x * W + Math.sin(T * 1.8 + b.w) * 5;
          const by = level + (H - level) * b.y;
          ctx.beginPath(); ctx.arc(bx, by, b.r, 0, 6.2832);
          ctx.strokeStyle = 'rgba(220,255,240,' + (0.12 + 0.25 * b.y) + ')'; ctx.lineWidth = 1; ctx.stroke();
          ctx.beginPath(); ctx.arc(bx - b.r * 0.35, by - b.r * 0.35, b.r * 0.3, 0, 6.2832);
          ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
        }
        ctx.restore();
        // superficie y espuma
        const line = (off, a, w) => {
          ctx.beginPath();
          pts.forEach((q, i) => { const y = q[1] + off + Math.sin(i * 0.9 + T * 3 + off) * (off ? 1.2 : 0); i ? ctx.lineTo(q[0], y) : ctx.moveTo(q[0], y); });
          ctx.strokeStyle = 'rgba(230,255,244,' + a + ')'; ctx.lineWidth = w; ctx.stroke();
        };
        line(0, 0.55, 1.6); line(3, 0.18, 2.5); line(7, 0.08, 3);
        ctx.shadowColor = c(0.8); ctx.shadowBlur = 12; line(0, 0.25, 1); ctx.shadowBlur = 0;
        for (const f of foam) {
          if (!reduce) { f.x += f.v * dt; if (f.x < 0) f.x += 1; if (f.x > 1) f.x -= 1; }
          const x = f.x * W;
          const s = surf(x, T, amp, 0) + rip(x);
          const crest = Math.max(0, Math.min(1, -s / (14 * amp + 0.01) + 0.35));
          if (crest < 0.15) continue;
          const y = level + s + f.d * (1.2 - crest) + Math.sin(T * 2.2 + f.ph) * 1.2;
          ctx.beginPath(); ctx.arc(x, y, f.s * (0.5 + crest), 0, 6.2832);
          ctx.fillStyle = 'rgba(240,255,248,' + (0.1 + 0.55 * crest) * (1 - f.d / 16) + ')'; ctx.fill();
        }
        for (let i = 0; i < pts.length; i += 9) {
          const s = pts[i][1] - level;
          if (s < -13 * amp) {
            const tw = 0.5 + 0.5 * Math.sin(T * 6 + i);
            ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1] + 1, 1.4, 0, 6.2832);
            ctx.fillStyle = 'rgba(255,255,255,' + 0.7 * tw + ')'; ctx.fill();
          }
        }
        const surfAt = (x) => level + surf(x, T, amp, 0) + rip(x);
        // peces que nadan por delante del edificio (debajo de la capa de agua de la fachada)
        for (const a of frontFish) drawFish(...a, fctx);
        // el agua baña el edificio: capa translúcida delante de la fachada, reflejos de ventanas y espuma.
        // Se pinta aparte y luego se pone encima, para que el difuminado de los bordes no borre los peces.
        const bR = this.bRect;
        if (bR && bR.w > 0) {
          const rR = this.rRect || { x: bR.x, w: bR.w };
          // de la izquierda del arrecife hasta justo antes de los textos de hitos (que quedan fuera del agua)
          const x0 = rR.x - 3, x1 = bR.x + bR.w + 10;
          wctx.clearRect(0, 0, W, H);
          wctx.save();
          wctx.beginPath(); wctx.rect(x0, 0, x1 - x0, H); wctx.clip();
          const wp = new Path2D(); wp.moveTo(x0, H);
          for (let x = x0; x <= x1 + 4; x += 4) wp.lineTo(x, surfAt(x));
          wp.lineTo(x1 + 4, H); wp.closePath();
          const wg = wctx.createLinearGradient(0, level - 12, 0, H);
          wg.addColorStop(0, c(0.2)); wg.addColorStop(0.15, c(0.1)); wg.addColorStop(1, 'rgba(4,20,16,0.28)');
          wctx.fillStyle = wg; wctx.fill(wp);
          for (let k = 0; k < 5; k++) {
            const cx = bR.x + 16 + (bR.w - 32) * (k + 0.5) / 5;
            for (let y = level; y < Math.min(H, level + 150); y += 4) {
              const kk = 1 - (y - level) / 150;
              const xo = Math.sin(y * 0.22 + T * 3 + k) * 4;
              wctx.fillStyle = 'rgba(255,210,122,' + (0.24 * kk * (0.6 + 0.4 * Math.sin(y * 0.6 + T * 4 + k))) + ')';
              wctx.fillRect(cx + xo - 5, y, 10, 2);
            }
          }
          wctx.beginPath();
          for (let x = x0; x <= x1 + 4; x += 4) { const y = surfAt(x); if (x === x0) wctx.moveTo(x, y); else wctx.lineTo(x, y); }
          wctx.strokeStyle = 'rgba(235,255,246,0.7)'; wctx.lineWidth = 1.6; wctx.stroke();
          for (let i = 0; i < 18; i++) {
            const fx2 = x0 + ((i * 37.7 + T * 12) % (x1 - x0));
            wctx.beginPath(); wctx.arc(fx2, surfAt(fx2) + 2 + Math.sin(T * 3 + i) * 1.5, 1.2 + (i % 3) * 0.6, 0, 6.2832);
            wctx.fillStyle = 'rgba(240,255,248,0.55)'; wctx.fill();
          }
          // bordes difuminados: sin cortes rectos a los lados
          wctx.globalCompositeOperation = 'destination-out';
          const fl = wctx.createLinearGradient(x0, 0, x0 + 44, 0); fl.addColorStop(0, 'rgba(0,0,0,1)'); fl.addColorStop(1, 'rgba(0,0,0,0)');
          wctx.fillStyle = fl; wctx.fillRect(x0, 0, 44, H);
          const fr = wctx.createLinearGradient(x1 - 22, 0, x1, 0); fr.addColorStop(0, 'rgba(0,0,0,0)'); fr.addColorStop(1, 'rgba(0,0,0,1)');
          wctx.fillStyle = fr; wctx.fillRect(x1 - 22, 0, 22, H);
          wctx.globalCompositeOperation = 'source-over';
          wctx.restore();
          fctx.drawImage(wcv, 0, 0, W, H);
          for (const ex of [bR.x, bR.x + bR.w]) {
            const ey = surfAt(ex);
            for (let q = 0; q < 7; q++) {
              fctx.beginPath(); fctx.arc(ex + Math.sin(T * 4 + q) * 7, ey - Math.abs(Math.sin(T * 2.5 + q * 1.3)) * 7, 1.4 + (q % 2), 0, 6.2832);
              fctx.fillStyle = 'rgba(240,255,248,0.6)'; fctx.fill();
            }
          }
        }
        // barquito de papel
        if (!reduce) { boat.x += boat.v * dt; if (boat.x > 1.08) boat.x = -0.08; }
        const bx = boat.x * W;
        const by = surfAt(bx);
        const sl = (surfAt(bx + 8) - surfAt(bx - 8)) / 16;
        ctx.save(); ctx.translate(bx, by - 3); ctx.rotate(Math.atan(sl));
        ctx.fillStyle = 'rgba(236,246,240,0.92)';
        ctx.beginPath(); ctx.moveTo(-24, -7); ctx.lineTo(24, -7); ctx.lineTo(15, 5); ctx.lineTo(-15, 5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.moveTo(-3, -7); ctx.lineTo(-3, -34); ctx.lineTo(15, -9); ctx.closePath(); ctx.fill();
        ctx.fillStyle = c(0.95);
        ctx.beginPath(); ctx.moveTo(-3, -34); ctx.lineTo(-15, -30 + (party ? Math.sin(T * 10) * 2 : 0)); ctx.lineTo(-3, -26); ctx.closePath(); ctx.fill();
        ctx.restore();
        // peces que saltan (muchos más en celebración), siempre por delante del edificio
        const maxJ = party ? 4 : 1;
        if (jumps.length < maxJ && T > nextJump && depth > 90 && !reduce) {
          const j = { dir: Math.random() < 0.5 ? -1 : 1, dist: rnd(110, 200), hgt: rnd(60, party ? 150 : 110), t0: T, dur: rnd(1.1, 1.5), col: FISH_COLS[Math.floor(Math.random() * 4)], spin: party && Math.random() < 0.4 };
          j.x0 = rnd(0.08, 0.92) * W - j.dir * j.dist / 2;
          jumps.push(j);
          nextJump = T + (party ? rnd(0.6, 1.6) : rnd(6, 13));
          ripples.push({ x: j.x0, t: T, A: 6 });
          for (let k = 0; k < 7; k++) drops.push({ x: j.x0, y: surfAt(j.x0), vx: rnd(-60, 60) + j.dir * 40, vy: rnd(-220, -120), front: true });
          this.sfx('plop');
        }
        for (let q = jumps.length - 1; q >= 0; q--) {
          const j = jumps[q];
          const u = (T - j.t0) / j.dur;
          if (u >= 1) {
            jumps.splice(q, 1);
            const xe = j.x0 + j.dir * j.dist;
            ripples.push({ x: xe, t: T, A: 8 });
            for (let k = 0; k < 12; k++) drops.push({ x: xe, y: surfAt(xe), vx: rnd(-90, 90), vy: rnd(-260, -120), front: true });
            this.sfx('splash');
          } else {
            const jx = j.x0 + j.dir * j.dist * u;
            const jy = surfAt(jx) - j.hgt * 4 * u * (1 - u);
            let ang = Math.atan2(-j.hgt * 4 * (1 - 2 * u), j.dist) * j.dir;
            if (j.spin) ang += u * 6.2832 * j.dir;
            drawFish(jx, jy, 13, j.dir, T * 20, j.col, 0.95, ang, party, fctx);
          }
        }
        // corazones de hype = comida: caen al agua (por delante del edificio), se hunden despacio y los peces van a por ellos
        while (this.hearts.length) { const hh = this.hearts.shift(); heartsLive.push({ x: hh.x * W, y: -20, vy: 0, t: T, inWater: false, eaten: false }); }
        for (let k = heartsLive.length - 1; k >= 0; k--) {
          const hh = heartsLive[k];
          if (hh.eaten) { heartsLive.splice(k, 1); continue; }
          const sY = surfAt(hh.x);
          if (!hh.inWater) {
            hh.vy += 900 * dts; hh.y += hh.vy * dts;
            if (hh.y >= sY) {
              hh.inWater = true; hh.vy = 70;
              ripples.push({ x: hh.x, t: T, A: 6 });
              for (let q = 0; q < 8; q++) drops.push({ x: hh.x, y: sY, vx: rnd(-70, 70), vy: rnd(-200, -90), front: true });
              this.sfx('plop');
            }
          } else {
            hh.vy += (20 - hh.vy) * Math.min(1, dts * 3);
            hh.y += hh.vy * dts;
            hh.x += Math.sin((T - hh.t) * 2.5) * 0.4;
            if (hh.y > H - 10) {
              heartsLive.splice(k, 1);
              for (let q = 0; q < 6; q++) sparks.push({ x: hh.x, y: H - 12, vx: rnd(-60, 60), vy: rnd(-120, -40), life: 0.8, s: rnd(4, 7) });
              continue;
            }
          }
          const hs = hh.inWater ? 12 : 16;
          fctx.save(); fctx.shadowColor = 'rgba(255,107,139,0.9)'; fctx.shadowBlur = 12;
          heartPath(fctx, hh.x, hh.y, hs); fctx.fillStyle = 'rgba(255,107,139,' + (hh.inWater ? 0.8 : 0.9) + ')'; fctx.fill();
          fctx.restore();
          heartPath(fctx, hh.x - 2.5, hh.y - 3.5, hs * 0.33); fctx.fillStyle = 'rgba(255,255,255,0.45)'; fctx.fill();
        }
        // gotas
        for (let k = drops.length - 1; k >= 0; k--) {
          const d = drops[k];
          d.vy += 700 * dts; d.x += d.vx * dts; d.y += d.vy * dts;
          if (d.vy > 0 && d.y > surfAt(d.x)) { drops.splice(k, 1); continue; }
          const g = d.front ? fctx : ctx;
          g.beginPath(); g.arc(d.x, d.y, 1.8, 0, 6.2832); g.fillStyle = 'rgba(230,255,244,0.85)'; g.fill();
        }
        for (let k = ripples.length - 1; k >= 0; k--) if (T - ripples[k].t > 3) ripples.splice(k, 1);
      } else {
        hovered = null;
        while (this.hearts.length) { const hh = this.hearts.shift(); for (let q = 0; q < 8; q++) sparks.push({ x: hh.x * W, y: H - 40, vx: rnd(-90, 90), vy: rnd(-260, -120), life: 1, s: rnd(5, 9) }); }
      }
      // corazoncitos tras estallar
      for (let k = sparks.length - 1; k >= 0; k--) {
        const s = sparks[k];
        s.vy += 260 * dts; s.x += s.vx * dts; s.y += s.vy * dts; s.life -= dts * 0.8;
        if (s.life <= 0) { sparks.splice(k, 1); continue; }
        heartPath(fctx, s.x, s.y, s.s); fctx.fillStyle = 'rgba(255,140,165,' + s.life + ')'; fctx.fill();
      }
      // --- confeti (delante del contenido) ---
      if (this.burstReq) { this.burstReq = false; burst(W * 0.25, H * 0.55, 160); burst(W * 0.75, H * 0.55, 160); }
      if (party && !reduce && confetti.length < 260) {
        for (let k = 0; k < 2; k++) confetti.push({ x: rnd(0, W), y: -10, vx: rnd(-30, 30), vy: rnd(40, 120), rot: rnd(0, 6.28), vr: rnd(-6, 6), w: rnd(6, 10), h: rnd(3, 5), col: CONF[Math.floor(Math.random() * CONF.length)], flip: rnd(0, 6.28) });
      }
      for (let k = confetti.length - 1; k >= 0; k--) {
        const f = confetti[k];
        f.vy += 260 * dts; f.vx *= 0.985; f.vy = Math.min(f.vy, 160);
        f.x += (f.vx + Math.sin(T * 2 + f.flip) * 30) * dts; f.y += f.vy * dts; f.rot += f.vr * dts; f.flip += dts * 6;
        if (f.y > H + 20) { confetti.splice(k, 1); continue; }
        fctx.save(); fctx.translate(f.x, f.y); fctx.rotate(f.rot); fctx.scale(1, Math.cos(f.flip));
        fctx.fillStyle = f.col; fctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h); fctx.restore();
      }
      // --- ficha del pez bajo el ratón: nombre, edad y cómo está ---
      if (hovered && W > 0) {
        const f = hovered;
        const fx0 = f.x * W, fy0 = f.dead ? f.deadY : f.py;
        if (fy0 != null) {
          const age = Math.max(0, Math.floor((simClock - f.bornAt) / DAY));
          const fedDays = Math.max(0, Math.floor((simClock - f.fedAt) / DAY));
          const fedTxt = fedDays === 0 ? 'ha comido hoy' : 'comió hace ' + (fedDays === 1 ? '1 día' : fedDays + ' días');
          const st = f.dead ? 'Descanse en paz' : (f.food < 0.3 ? 'Con hambre' : f.food > FULL ? 'Lleno' : 'Contento') + ' · ' + fedTxt;
          const l1 = f.name + '  ·  ' + (!f.adult ? 'cría, ' : '') + (age === 1 ? '1 día' : age + ' días') + (f.dead ? ' de vida' : ' vivo');
          const l2 = st;
          fctx.font = '700 15px Inter, system-ui, sans-serif'; const w1 = fctx.measureText(l1).width;
          fctx.font = '500 12px Inter, system-ui, sans-serif'; const w2 = fctx.measureText(l2).width;
          const bw = Math.max(w1, w2) + 22, bh = 46;
          const bx = Math.min(W - bw - 8, Math.max(8, fx0 - bw / 2));
          const by = Math.max(8, fy0 - f.s - 22 - bh);
          fctx.beginPath(); fctx.arc(fx0, fy0, f.s * 1.6 + 4, 0, 6.2832); fctx.strokeStyle = c(0.55); fctx.lineWidth = 1.5; fctx.stroke();
          fctx.fillStyle = 'rgba(12,24,20,0.95)';
          fctx.beginPath();
          if (fctx.roundRect) fctx.roundRect(bx, by, bw, bh, 10); else fctx.rect(bx, by, bw, bh);
          fctx.fill();
          fctx.strokeStyle = f.dead ? '#8FA89B' : f.food < 0.3 ? '#FF9F6B' : c(0.9); fctx.lineWidth = 1; fctx.stroke();
          fctx.beginPath(); fctx.moveTo(fx0 - 6, by + bh); fctx.lineTo(fx0 + 6, by + bh); fctx.lineTo(fx0, by + bh + 7); fctx.closePath(); fctx.fillStyle = 'rgba(12,24,20,0.95)'; fctx.fill();
          fctx.fillStyle = '#E8F2EC'; fctx.font = '700 15px Inter, system-ui, sans-serif'; fctx.fillText(l1, bx + 11, by + 20);
          fctx.fillStyle = f.food < 0.3 && !f.dead ? '#FFB98F' : '#B9CCC2'; fctx.font = '500 12px Inter, system-ui, sans-serif'; fctx.fillText(l2, bx + 11, by + 37);
        }
      }
      this.wraf = requestAnimationFrame(frame);
    };
    const heartsLive = [];
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
    // Datos del servidor (hype + peces). Sin servidor, todo funciona en modo simulación.
    try { this.lastVisit = Number(localStorage.getItem('piso-last-visit')) || 0; } catch (e) { this.lastVisit = 0; }
    try { this.setState({ draftPin: localStorage.getItem('piso-pin') || '' }); } catch (e) {}
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000));
    Promise.race([api('state'), timeout])
      .then((d) => { this.server = d; this.loadedAt = Date.now(); if (typeof d.hype === 'number') this.setState({ hype: d.hype }); })
      .catch(() => { this.server = null; })
      .then(() => {
        this.startWater();
        try { localStorage.setItem('piso-last-visit', String(Date.now())); } catch (e) {}
        if (this.server) this.loadVisits();
      });
    this.hypeT = setInterval(() => this.sendHype(), 1200);
    window.addEventListener('pagehide', () => this.sendHype());
    this.partyT = setTimeout(() => { if (this.partyNow) this.burstReq = true; }, 1300);
  }
  componentWillUnmount() {
    clearInterval(this.timer);
    clearInterval(this.hypeT);
    clearTimeout(this.partyT); clearTimeout(this.toastT); clearTimeout(this.awayT); clearTimeout(this.waterRetry);
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.wraf);
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    if (this.onMove) window.removeEventListener('pointermove', this.onMove);
    if (this.ac) this.ac.close();
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

    // Cielo según la hora real de Madrid
    const sky = this.sky(now);
    this.skyNow = sky;
    const rgb = (a) => 'rgb(' + a.join(',') + ')';
    const sunPos = sky.u > 0 && sky.u < 1 ? [8 + 84 * sky.u, 80 - 62 * Math.sin(Math.PI * sky.u)] : [8 + 84 * Math.max(0, Math.min(1, sky.v)), 80 - 60 * Math.sin(Math.PI * Math.max(0, Math.min(1, sky.v)))];
    const glowA = (0.1 * sky.day + 0.28 * sky.tw).toFixed(3);
    const skyBg = 'background: radial-gradient(ellipse 55% 45% at ' + sunPos[0].toFixed(1) + '% ' + sunPos[1].toFixed(1) + '%, rgba(255,180,120,' + glowA + '), transparent 70%), linear-gradient(to bottom, ' + rgb(sky.top) + ', ' + rgb(sky.bot) + ');';
    const PHASE = { noche: 'Noche', dia: 'Día', amanecer: 'Amanecer', atardecer: 'Atardecer' };
    const skyLabel = PHASE[sky.phase] + ' en Málaga · ' + (sky.hhmm || 'simulado');

    const raw = [
      { name: 'Reserva', long: 'Reserva', date: '2025-11-13', label: '13 nov 2025', icon: 'clip' },
      { name: 'Firma', long: 'Firma del contrato', date: '2026-04-16', label: '16 abr 2026', icon: 'doc' },
      { name: 'Pago 1', long: 'Pago 1', date: '2026-08-01', label: '1 ago 2026', icon: 'pay' },
      { name: 'Pago 2', long: 'Pago 2', date: '2026-12-01', label: '1 dic 2026', icon: 'pay' },
      { name: 'Pago 3', long: 'Pago 3', date: '2027-04-01', label: '1 abr 2027', icon: 'pay' },
      { name: 'Pago 4', long: 'Pago 4', date: '2027-08-01', label: '1 ago 2027', icon: 'pay' },
      { name: 'Llaves', long: 'Entrega de llaves', date: '2028-10-01', label: '1 oct 2028', icon: 'key' }
    ];
    const nextIdx = raw.findIndex((m) => new Date(m.date + 'T00:00:00').getTime() > now);
    const todayIdx = raw.findIndex((m) => m.date === sky.ymd);
    const party = todayIdx >= 0 || !!this.props.celebrar;
    this.partyNow = party;
    const partyName = todayIdx >= 0 ? raw[todayIdx].long : (nextIdx >= 0 ? raw[nextIdx].long : 'Entrega de llaves');

    const milestones = raw.map((m, i) => {
      const t = new Date(m.date + 'T00:00:00').getTime();
      const f = Math.max(0, Math.min(1, (t - START) / (END - START)));
      const done = t <= now, next = i === nextIdx;
      const align = i === 0 ? 'translateX(calc(var(--nh, 20px) * -1))' : i === raw.length - 1 ? 'translateX(calc(-100% + var(--nh, 20px)))' : 'translateX(-50%)';
      const items = i === 0 ? 'flex-start' : i === raw.length - 1 ? 'flex-end' : 'center';
      let node = 'display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; box-sizing: border-box; border-radius: 50%;';
      if (done) node += ' background: ' + accent + '; color: #08110E; border: 2px solid ' + accent + '; box-shadow: 0 0 14px ' + tint(0.6) + ';';
      else if (next) node += ' background: #1A2A1F; color: #FFD27A; border: 2px solid #FFD27A; animation: pulseRing 1.8s ease-out infinite;';
      else node += ' background: #0B1612; color: #6F8C80; border: 2px solid #2F4A3E;';
      return {
        ...m,
        isClip: m.icon === 'clip', isDoc: m.icon === 'doc', isPay: m.icon === 'pay', isKey: m.icon === 'key',
        nodeWrap: 'position: absolute; top: 2px; left: ' + (f * 100).toFixed(2) + '%; width: 0; margin-left: ' + (i === 0 ? 'calc(var(--nh, 20px) * -1)' : i === raw.length - 1 ? 'var(--nh, 20px)' : '0') + '; display: flex; flex-direction: column; align-items: ' + items + '; gap: 4px; animation: fadeUp .6s ease-out both; animation-delay: ' + (300 + i * 110) + 'ms;',
        node,
        textColor: done ? '#E8F2EC' : next ? '#FFD27A' : '#8FA89B',
        tick: 'position: absolute; left: 0; bottom: ' + (f * 100).toFixed(2) + '%; transform: translateY(50%); display: flex; align-items: center; gap: 6px;',
        tickColor: done ? accent : next ? '#FFD27A' : '#4C7364'
      };
    });
    const next = nextIdx >= 0 ? raw[nextIdx] : null;
    const nextDays = next ? Math.ceil((new Date(next.date + 'T00:00:00').getTime() - now) / 86400000) : 0;

    // Diario de obra: visitas libres al piso (fecha, fotos y notas)
    const visits = (this.state.visits || []).slice().sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1)).map((v) => {
      const t = new Date(v.date + 'T12:00:00').getTime();
      const ago = Math.round((now - t) / 86400000);
      const vp = Math.max(0, Math.min(1, (t - START) / (END - START)));
      return {
        dateLabel: ((d) => d.charAt(0).toUpperCase() + d.slice(1))(new Date(v.date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
        ago: ago <= 0 ? 'Hoy' : ago === 1 ? 'Ayer' : 'Hace ' + ago + ' días',
        pctAt: (vp * 100).toFixed(1).replace('.', ',') + '%',
        note: v.note, hasNote: !!v.note,
        photos: (v.photos || []).map((k) => {
          const url = '/api/photo?key=' + encodeURIComponent(k);
          return { url, open: () => this.setState({ photo: url }) };
        }), hasPhotos: (v.photos || []).length > 0,
        grid: 'display: grid; grid-template-columns: repeat(' + Math.min(3, Math.max(1, (v.photos || []).length)) + ', minmax(0, 1fr)); gap: 6px;'
      };
    });

    // Edificio: 7 plantas (bajos + 6), puertas A–E; nuestro piso 3ºE
    const FLOORS = 7, WIN = 5;
    const OUR_FLOOR = 3, OUR_DOOR = 4;
    const litTotal = p * FLOORS * WIN;
    const night = 1 - sky.day;
    const winGlow = '0 0 ' + Math.round(8 + 14 * night) + 'px rgba(255,210,122,' + (0.4 + 0.4 * night).toFixed(2) + ')';
    const floors = [];
    for (let fl = FLOORS - 1; fl >= 0; fl--) {
      const built = p * FLOORS > fl;
      const windows = [];
      for (let w = 0; w < WIN; w++) {
        const idx = fl * WIN + w;
        const lit = idx < Math.floor(litTotal);
        const partial = !lit && idx < litTotal;
        let style = 'border-radius: 2px; min-height: 0; display: flex; align-items: center; justify-content: center;';
        const ours = fl === OUR_FLOOR && w === OUR_DOOR;
        if (ours) {
          style += (lit ? ' background: ' + accent + ';' : ' background: #1C2F28;') + ' border: 0; padding: 0; cursor: pointer; outline: 2px solid ' + accent + '; outline-offset: 2px; box-shadow: 0 0 16px ' + tint(0.7) + ';';
          windows.push({ style, ours: true, plain: false, iconColor: lit ? '#08110E' : accent });
          continue;
        }
        if (lit) style += ' background: #FFD27A; box-shadow: ' + winGlow + '; animation: ' + (party ? 'partyWin ' + (0.6 + (idx % 5) * 0.15).toFixed(2) + 's ease-in-out ' + (idx * 40) + 'ms infinite alternate' : 'winOn .55s ease-out ' + (700 + idx * 70) + 'ms both') + ';';
        else if (partial) style += ' background: rgba(255,210,122,.35); animation: glowPulse 1.6s ease-in-out infinite;';
        else if (built) style += ' background: #1C2F28;';
        else style += ' border: 1px dashed #3A5A4E;';
        windows.push({ style, ours: false, plain: true, iconColor: accent });
      }
      const top = fl === FLOORS - 1;
      floors.push({
        windows,
        rowStyle: 'flex: 1 1 0; min-height: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); grid-template-rows: minmax(0, 1fr); gap: 7px; padding: 4px 6px; border-radius: 3px; animation: floorIn .5s ease-out both; animation-delay: ' + (fl * 50) + 'ms;' + (top ? ' outline: 1px solid ' + (p >= 1 ? accent : '#3A5A4E') + ';' : '') + (built ? '' : ' opacity: 0.8;')
      });
    }
    const oursFrac = ((OUR_FLOOR + 0.5) / FLOORS).toFixed(4);
    const sceneSky = sky.phase === 'dia' ? '#8FD0EA' : sky.phase === 'noche' ? '#0D1B2C' : '#E58F6B';

    const hype = this.state.hype;
    const hypeLevel = hype < 50 ? 'Tranquilos' : hype < 100 ? 'Ilusionados' : hype < 150 ? 'Mirando sofás en bucle' : hype < 250 ? 'Ya tenemos nombre para el wifi' : 'Hype legendario';

    return {
      accent,
      glow: tint(party ? 0.55 : 0.35),
      glowSpeed: party ? '0.9s' : '3.2s',
      pctAnim: party ? 'partyPulse 1.1s ease-in-out infinite' : 'none',
      skyBg,
      skyLabel,
      isDay: sky.phase === 'dia',
      isNight: sky.phase === 'noche',
      isTwilight: sky.phase === 'amanecer' || sky.phase === 'atardecer',
      setCanvas: this.setCanvas,
      setFx: this.setFx,
      pctInt,
      pctDec,
      days: String(Math.floor(diff / 86400000)),
      hours: pad(Math.floor(diff / 3600000) % 24),
      mins: pad(Math.floor(diff / 60000) % 60),
      secs: pad(Math.floor(diff / 1000) % 60),
      barStyle: 'position: absolute; left: 0; top: 18px; height: 8px; width: ' + (pa * 100).toFixed(2) + '%; border-radius: 999px; background: ' + accent + '; box-shadow: 0 0 16px ' + tint(0.6) + ';',
      nextName: next ? next.name : '¡Ya es nuestro!',
      nextIn: next ? 'faltan ' + nextDays + ' días' : 'a disfrutarlo',
      party,
      notParty: !party,
      partyName,
      celebrate: () => { this.burstReq = true; this.sfx('fanfare'); },
      milestones,
      floors,
      floorsBuilt: String(Math.max(1, Math.min(FLOORS, Math.ceil(pa * FLOORS)))),
      building: p < 1,
      finished: p >= 1,
      levelStyle: 'position: absolute; left: -6px; right: -6px; bottom: calc(8px + (100% - 16px) * ' + pa.toFixed(4) + '); height: 2px; background: ' + accent + '; box-shadow: 0 0 10px ' + tint(0.8) + ';',
      oursStyle: 'position: absolute; right: 100%; bottom: calc(8px + (100% - 16px) * ' + oursFrac + '); transform: translateY(50%); display: flex; align-items: center; white-space: nowrap; animation: fadeUp .6s ease-out both; animation-delay: 3.6s;',
      sceneOpen: this.state.scene,
      sceneExpanded: this.state.scene ? 'true' : 'false',
      sceneStyle: 'position: absolute; right: calc(100% + 16px); bottom: calc(8px + (100% - 16px) * ' + oursFrac + ' + 22px); z-index: 6; width: 264px; box-sizing: border-box; padding: 8px; border-radius: 16px; background: #0C1814; border: 1px solid ' + accent + '; box-shadow: 0 12px 40px rgba(0,0,0,.5), 0 0 24px ' + tint(0.3) + '; animation: popIn .25s ease-out both;',
      sceneSky,
      sceneIsNight: sky.phase !== 'dia',
      sceneIsDay: sky.phase === 'dia',
      showScene: () => this.setState({ scene: true }),
      hideScene: () => this.setState({ scene: false }),
      toggleScene: () => this.setState({ scene: !this.state.scene }),
      visits,
      noVisits: visits.length === 0,
      formOpen: this.state.form,
      formClosed: !this.state.form,
      openForm: () => this.setState({ form: true, draftDate: this.clock(Date.now()).ymd, draftNote: '', draftPhotos: [], formError: '' }),
      cancelForm: () => this.setState({ form: false }),
      draftDate: this.state.draftDate,
      draftNote: this.state.draftNote,
      draftPhotos: this.state.draftPhotos,
      hasDraftPhotos: this.state.draftPhotos.length > 0,
      setDraftDate: (e) => this.setState({ draftDate: e.target.value }),
      setDraftNote: (e) => this.setState({ draftNote: e.target.value }),
      setDraftPhotos: (e) => { const files = Array.from((e.target && e.target.files) || []).slice(0, 12); this.setState({ draftPhotos: files.map((f) => ({ url: URL.createObjectURL(f), name: f.name, file: f })) }); },
      setDraftPin: (e) => this.setState({ draftPin: e.target.value }),
      draftPin: this.state.draftPin || '',
      saving: !!this.state.saving,
      saveLabel: this.state.saving ? 'Guardando…' : 'Guardar visita',
      hasFormError: !!this.state.formError,
      formError: this.state.formError || '',
      saveVisit: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (!this.state.draftDate || this.state.saving) return;
        if (!this.server) { this.setState({ formError: 'Sin conexión con el servidor: no se puede guardar.' }); return; }
        this.submitVisit();
      },
      diaryOpen: this.state.diary,
      openDiary: () => this.setState({ diary: true }),
      closeDiary: () => this.setState({ diary: false, photo: null }),
      // foto del diario a pantalla completa
      photoOpen: !!this.state.photo,
      photoUrl: this.state.photo,
      closePhoto: () => this.setState({ photo: null }),
      sound: this.state.sound,
      muted: !this.state.sound,
      soundPressed: this.state.sound ? 'true' : 'false',
      soundLabel: this.state.sound ? 'Silenciar' : 'Activar sonido',
      soundColor: this.state.sound ? accent : '#E8F2EC',
      toggleSound: () => {
        if (!this.ensureAudio()) return;
        const on = !this.state.sound;
        this.ac.resume();
        this.master.gain.setTargetAtTime(on ? 0.6 : 0, this.ac.currentTime, 0.3);
        this.setState({ sound: on }, () => { if (on && this.partyNow) this.sfx('fanfare'); });
      },
      hasAway: !!this.state.awayMsg,
      awayMsg: this.state.awayMsg || '',
      fishAlive: String(this.state.fishAlive),
      fishHungry: String(this.state.fishHungry),
      hasHungry: this.state.fishHungry > 0 && this.state.fishAlive > 0,
      pondEmpty: this.state.fishAlive === 0,
      hype: String(hype),
      hypeLevel,
      hasHypeToast: !!this.state.hypeToast,
      hypeToast: this.state.hypeToast || '',
      addHype: () => {
        const h = this.state.hype + 1;
        this.setState({ hype: h });
        this.hypePending = (this.hypePending || 0) + 1;
        this.hearts.push({ x: 0.15 + Math.random() * 0.7 });
        this.sfx('pop');
        if (h % 50 === 0) {
          this.whaleReq = true;
          this.sfx('whale');
          this.setState({ hypeToast: '¡Hype ' + h + '! Ballena a la vista' });
          clearTimeout(this.toastT);
          this.toastT = setTimeout(() => this.setState({ hypeToast: null }), 5000);
        }
      }
    };
  }
}

export default Component;
