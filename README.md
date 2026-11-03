# HomeLoadBar · Entrega del mejor piso del mundo

Cuenta atrás hasta la entrega de llaves: el porcentaje, una línea de hitos y el tiempo restante
integrados sobre el fondo, con el agua subiendo al ritmo del progreso, el contador de hype
y un diario de visitas al piso con fotos. Pensado sobre todo para verse bien en el móvil.

## Estructura

```
public/                 ← la web (lo que publica Netlify)
  index.html            plantilla y estilos
  app.js                lógica: contador, hitos, agua, hype y diario
  dc-lite.js            mini-motor que pinta la plantilla con Preact
  main.js               arranque
  vendor/preact.module.js
  milestones.json       hitos (referencia; las fechas están en app.js)
netlify/functions/api.mjs  API: hype y diario (Netlify Blobs)
netlify.toml
package.json
```

## Puesta en marcha en Netlify

1. Sube esta rama y despliega (Netlify lee `netlify.toml`: publica `public/` y crea la función).
2. En **Site configuration → Environment variables** añade `DIARY_PIN` con el PIN para escribir
   en el diario. Sin esa variable el diario se puede ver pero no escribir.
3. Nada más: Netlify Blobs viene incluido en el plan gratuito.

La primera vez que se abre la web, el contador de hype se importa del npoint antiguo para no perderlo.

## API (`/api/*`)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/state` | contador de hype |
| POST | `/api/hype` `{ n }` | suma hype (máx. 50 por llamada) |
| GET | `/api/diary` | visitas del diario |
| POST | `/api/diary` `{ pin, date, note }` | nueva visita |
| POST | `/api/photo` `{ pin, visitId, data }` | añade una foto (JPEG reducido en el navegador) |
| GET | `/api/photo?key=…` | sirve una foto |

## Desarrollo local

```
npm install
npx netlify dev        # sirve la web y la función con Blobs local
```

Para cambiar las fechas de los hitos o la de entrega, edita `raw`, `START` y `END` en `public/app.js`.
