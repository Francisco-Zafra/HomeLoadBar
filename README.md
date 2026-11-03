# HomeLoadBar · Entrega del mejor piso del mundo

Cuenta atrás hasta la entrega de llaves con un estanque vivo: el agua sube con el progreso, los
peces hay que alimentarlos con hype (o se mueren) y un diario guarda las visitas al piso con fotos.

## Estructura

```
public/                 ← la web (lo que publica Netlify)
  index.html            plantilla y estilos
  app.js                lógica: contador, edificio, agua, peces, diario, sonido…
  dc-lite.js            mini-motor que pinta la plantilla con Preact
  main.js               arranque (+ ajustes por URL)
  vendor/preact.module.js
  milestones.json       hitos (referencia; las fechas también están en app.js)
netlify/functions/api.mjs  API: hype, estanque y diario (Netlify Blobs)
netlify.toml
package.json
```

## Puesta en marcha en Netlify

1. Sube esta rama y despliega (Netlify lee `netlify.toml`: publica `public/` y crea la función).
2. En **Site configuration → Environment variables** añade `DIARY_PIN` con el PIN para escribir
   en el diario (por ejemplo, 4–6 cifras). Sin esa variable el diario se puede ver pero no escribir.
3. No hace falta configurar nada más: Netlify Blobs viene incluido en el plan gratuito.

La primera vez que se abre la web:
- el contador de hype se importa del npoint antiguo (`api.npoint.io/4a27…`) para no perderlo;
- se crea un estanque con 14 peces.

## API (`/api/*`)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/state` | hype + peces |
| POST | `/api/hype` `{ n }` | suma hype (máx. 50 por llamada) |
| POST | `/api/pond` `{ fish, since }` | guarda el estanque (fusiona con otros dispositivos) |
| GET | `/api/diary` | visitas del diario |
| POST | `/api/diary` `{ pin, date, note }` | nueva visita |
| POST | `/api/photo` `{ pin, visitId, data }` | añade una foto (JPEG reducido en el navegador) |
| GET | `/api/photo?key=…` | sirve una foto |

## Reglas del estanque

- Hambre: la saciedad baja de 1 a 0 en 7 días; tras 3 días a 0 el pez muere.
- Cada corazón de hype es comida (+0,35). Un adulto que llega a saciedad ≥ 1 tiene 1–3 crías (máx. una vez cada 3 días).
- Las crías tardan 5 días en hacerse adultas. Máximo 45 peces.
- Si el estanque se queda vacío, el siguiente corazón se convierte en huevas.
- Al entrar se muestra lo que ha pasado desde la última visita de ese dispositivo.

## Probar sin esperar

Parámetros de URL: `?celebrar=1` (modo fiesta), `?momento=noche|dia|amanecer|atardecer`,
`?velocidad=rapida` (1 día = 1 minuto), `?color=5CC8FF`.

## Desarrollo local

```
npm install
npx netlify dev        # sirve la web y la función con Blobs local
```
