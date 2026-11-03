// API del piso: hype, estanque (peces) y diario de visitas con fotos.
// Todo se guarda en Netlify Blobs (incluido en el plan gratuito).
//
//   GET  /api/state            → { hype, fish, now }
//   POST /api/hype   { n }      → suma n al contador (máx. 50 por llamada)
//   POST /api/pond   { fish, since } → guarda el estanque (fusiona con lo que haya)
//   GET  /api/diary            → { visits: [{ id, date, note, photos: [key] }] }
//   POST /api/diary  { pin, date, note }        → crea una visita  (requiere PIN)
//   POST /api/photo  { pin, visitId, data }     → añade una foto JPEG (data URL, requiere PIN)
//   GET  /api/photo?key=...    → devuelve la foto
//
// Variable de entorno necesaria en Netlify: DIARY_PIN (el PIN para escribir en el diario).
import { getStore } from '@netlify/blobs';

export const config = { path: '/api/*' };

const OLD_HYPE_URL = 'https://api.npoint.io/4a27719f5eef9e8c78f6'; // contador antiguo, para no perderlo
const MAX_FISH = 60;
const DAY = 86400000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });

const env = (k) => (globalThis.Netlify && Netlify.env ? Netlify.env.get(k) : process.env[k]);

function checkPin(pin) {
  const expected = env('DIARY_PIN');
  if (!expected) return 'Falta configurar DIARY_PIN en Netlify.';
  if (typeof pin !== 'string' || pin.length !== expected.length) return 'PIN incorrecto.';
  let diff = 0;
  for (let i = 0; i < pin.length; i++) diff |= pin.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? null : 'PIN incorrecto.';
}

const num = (v, min, max, def) => (typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, v)) : def);

function cleanFish(f) {
  if (!f || typeof f !== 'object' || typeof f.id !== 'string' || f.id.length > 40) return null;
  const col = Array.isArray(f.col) && f.col.length === 3 ? f.col.map((c) => num(c, 0, 255, 128)) : [59, 229, 138];
  return {
    id: f.id,
    name: typeof f.name === 'string' ? f.name.slice(0, 30) : 'Pez',
    x: num(f.x, -0.1, 1.1, 0.5),
    d: num(f.d, -1, 1, 0.5),
    adultS: num(f.adultS, 3, 24, 10),
    adult: !!f.adult,
    bornAt: num(f.bornAt, 0, 1e15, Date.now()),
    fedAt: num(f.fedAt, 0, 1e15, Date.now()),
    fedLevel: num(f.fedLevel, 0, 1.2, 0.8),
    breedAt: num(f.breedAt, 0, 1e15, 0),
    col,
    dead: !!f.dead,
    diedAt: f.dead ? num(f.diedAt, 0, 1e15, Date.now()) : undefined
  };
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const store = getStore({ name: 'piso', consistency: 'strong' });
  const photos = getStore({ name: 'piso-fotos', consistency: 'strong' });
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : null;

  try {
    // ---- estado general ----
    if (route === 'state' && req.method === 'GET') {
      let hype = await store.get('hype', { type: 'json' });
      if (!hype) {
        hype = { count: 0 };
        try {
          const r = await fetch(OLD_HYPE_URL);
          const d = await r.json();
          if (typeof d.count === 'number') hype.count = d.count;
        } catch (e) { /* sin contador antiguo */ }
        await store.setJSON('hype', hype);
      }
      const pond = await store.get('pond', { type: 'json' });
      return json({ hype: hype.count, fish: pond ? pond.fish : [], now: Date.now() });
    }

    // ---- hype ----
    if (route === 'hype' && req.method === 'POST') {
      const add = Math.max(0, Math.min(50, Math.floor(Number(body.n) || 0)));
      const hype = (await store.get('hype', { type: 'json' })) || { count: 0 };
      hype.count += add;
      await store.setJSON('hype', hype);
      return json({ hype: hype.count });
    }

    // ---- estanque ----
    if (route === 'pond' && req.method === 'POST') {
      if (!Array.isArray(body.fish)) return json({ error: 'Datos no válidos.' }, 400);
      const incoming = body.fish.slice(0, MAX_FISH).map(cleanFish).filter(Boolean);
      const since = num(body.since, 0, 1e15, 0);
      const current = ((await store.get('pond', { type: 'json' })) || { fish: [] }).fish;
      const byId = new Map(current.map((f) => [f.id, f]));
      const merged = incoming.map((f) => {
        const old = byId.get(f.id);
        // si alguien le dio de comer después en otro dispositivo, se respeta esa comida
        if (old && !f.dead && old.fedAt > f.fedAt) return { ...f, fedAt: old.fedAt, fedLevel: old.fedLevel };
        return f;
      });
      // peces que nacieron en otro dispositivo después de que este cargase la página
      const ids = new Set(merged.map((f) => f.id));
      for (const f of current) if (!ids.has(f.id) && f.bornAt >= since) merged.push(f);
      // los muertos se guardan 30 días (para el resumen de "desde vuestra última visita")
      const now = Date.now();
      const fish = merged.filter((f) => !f.dead || now - (f.diedAt || now) < 30 * DAY).slice(0, MAX_FISH);
      await store.setJSON('pond', { fish, updatedAt: now });
      return json({ ok: true, count: fish.length });
    }

    // ---- diario ----
    if (route === 'diary' && req.method === 'GET') {
      const diary = (await store.get('diary', { type: 'json' })) || { visits: [] };
      return json(diary);
    }
    if (route === 'diary' && req.method === 'POST') {
      const err = checkPin(body.pin);
      if (err) return json({ error: err }, 401);
      if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return json({ error: 'Fecha no válida.' }, 400);
      const note = typeof body.note === 'string' ? body.note.slice(0, 4000) : '';
      const diary = (await store.get('diary', { type: 'json' })) || { visits: [] };
      const visit = { id: crypto.randomUUID(), date: body.date, note, photos: [], createdAt: Date.now() };
      diary.visits.push(visit);
      await store.setJSON('diary', diary);
      return json({ id: visit.id });
    }

    // ---- fotos ----
    if (route === 'photo' && req.method === 'POST') {
      const err = checkPin(body.pin);
      if (err) return json({ error: err }, 401);
      const m = typeof body.data === 'string' && body.data.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return json({ error: 'Foto no válida.' }, 400);
      const bytes = Buffer.from(m[1], 'base64');
      if (bytes.length > 4.5 * 1024 * 1024) return json({ error: 'Foto demasiado grande.' }, 413);
      const diary = (await store.get('diary', { type: 'json' })) || { visits: [] };
      const visit = diary.visits.find((v) => v.id === body.visitId);
      if (!visit) return json({ error: 'Visita no encontrada.' }, 404);
      const key = 'photos/' + visit.id + '/' + crypto.randomUUID();
      await photos.set(key, bytes, { metadata: { type: 'image/jpeg' } });
      visit.photos.push(key);
      await store.setJSON('diary', diary);
      return json({ key });
    }
    if (route === 'photo' && req.method === 'GET') {
      const key = url.searchParams.get('key') || '';
      if (!/^photos\/[\w-]+\/[\w-]+$/.test(key)) return json({ error: 'Clave no válida.' }, 400);
      const data = await photos.get(key, { type: 'arrayBuffer' });
      if (!data) return json({ error: 'No encontrada.' }, 404);
      return new Response(data, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
    }

    return json({ error: 'Ruta no encontrada.' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: 'Error del servidor.' }, 500);
  }
};
