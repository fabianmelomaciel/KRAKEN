# Visor de mesa — spec (aprobado por el CEO, 2026-10-19)

Panel web local, dev-only, que muestra en vivo el avance del trabajo de los agentes.
Una ficha por sesión (aparece al instante), porcentaje animado, badge "terminado" al cerrar.
Se mira en una pantalla aparte (ventana del navegador). Nunca se publica.

## Por qué en `scratch/kraken/`

`scratch/` ya está en `.gitignore:43` y no está en `files` de `package.json:26-44`;
`scripts/install-core.js:134` sólo copia `skills/`. O sea: gitignored, fuera del paquete,
nunca copiado a ningún IDE. R6 sale por construcción, sin tocar `.gitignore` (protegido).

El **estado** va aparte, en `%LOCALAPPDATA%\SkillGrid\live\events.jsonl`: global para que el
panel sirva para cualquier proyecto y sea "independiente del proyecto", y fuera de
`C:\laragon\www` (que es legible por otros usuarios de la máquina).

## 1. Formato de evento (JSONL, append-only, una línea por evento)

```json
{"v":1,"seq":12,"ts":"2026-10-19T12:00:00.000Z","kind":"session.step","sid":"ses_abc123","src":"opencode","title":"agente-ideas","tool":"read","step":7,"total":null,"project":"C:\\laragon\\www\\SkillGrid"}
```

- `kind` ∈ `session.start` | `session.step` | `session.end` | `session.reopen` | `loop.iteration`
- Payload **mínimo**: metadatos. Nunca el cuerpo de mensajes, ni el prompt, ni el contenido
  de los archivos leídos (puede haber secretos del proyecto del usuario).
- `title`: nombre corto de sesión/agente, no el prompt.
- Escritura con `fs.appendFileSync` de una línea completa (nunca read-modify-write) para que
  varios procesos escriban a la vez sin pisarse.

## 2. Fuentes (C1) — 3, un mismo formato

**opencode** — plugin ESM `scratch/kraken/plugin/kraken-feed.js`, exporta el hook `event` y
`tool.execute.before`/`.after` (precedente: `.opencode/plugins/session-memory.js:191-221`,
`.opencode/plugins/write-guard.js:24`).

- `session.created` → `session.start`
- `tool.execute.before` → `session.step` (con `tool` = nombre de la tool)
- `session.idle` → `session.end`
- `session.created`/mensaje nuevo sobre una sesión ya terminada → `session.reopen`

Todo en try/catch: un error del plugin no rompe el IDE.

**Claude Code** — hook en node `scratch/kraken/hook.js` (NO bash: el `bash` del PATH es WSL
sin distro en esta máquina) que lee el JSON de stdin del hook y anexa el mismo formato.
Se instala en `~/.claude/settings.json` (global) con `SessionStart` y `Stop`.

**Ralph Loop** — `scripts/ralph-loop.ps1` y `scripts/ralph-loop.sh`: una línea por iteración
que anexa `loop.iteration` con `step`=iteración y `total`=MaxIterations. Acá el % es real.

## 3. Modelo y % (C2) — honesto, nunca inventado

- Ficha = una sesión. Estados `activo` → `terminado`; `session.reopen` la vuelve a `activo`
  (una sesión terminada puede despertar).
- **% real** sólo con denominador: `loop.iteration` (step/total) o task file/plan con
  checkboxes `- [ ]`. Ahí la barra muestra el número.
- **Sin denominador**: barra de ACTIVIDAD (indeterminada) + contador de pasos ("7 pasos").
  Nunca un % inventado. La UI rotula cada barra: "actividad" o "% del plan".
- Las fichas terminadas **no se borran**: quedan con badge verde "terminado".

## 4. Transporte (C3) — SSE

`scratch/kraken/server.js`, standalone (`node scratch/kraken/server.js`).

- Bind `127.0.0.1` siempre. Nunca `0.0.0.0` salvo flag explícito `--host` con warning.
  Precedente: `skills/brainstorming/scripts/server.cjs:76-78` (puerto aleatorio 49152+,
  `HOST='127.0.0.1'`, `URL_HOST='localhost'`).
- **Validación de `Host`**: allowlist exacta `127.0.0.1:<puerto>` y `localhost:<puerto>`;
  403 al resto (bloquea DNS-rebinding). `Origin` exigido y validado en requests que no sean
  GET. Cero headers CORS.
- **Rutas exactas, sin path params y sin servir directorios** (evita traversal):
  `GET /` (HTML), `GET /api/state` (snapshot JSON), `GET /api/events` (SSE). Resto → 404.
- Tail del JSONL global por offset; red de seguridad con `fs.watch` + `stat` cada 500 ms
  (Windows coalescea eventos). Al llegar datos nuevos, push por SSE.
- El cliente (EventSource) reconecta solo; si la SSE falla, cae a polling de `/api/state`
  cada 1 s.
- Al arrancar abre el navegador (Windows: `cmd /c start "" "<url>"`) o imprime la URL.
- try/catch en todo hook y `unref` en los timers: un fallo no cuelga nada.

## 5. UI (C4) — `scratch/kraken/index.html`, autocontenido

HTML+CSS+JS inline. Sin CDN, sin Google Fonts.

- Dark + glassmorphism, reusando los tokens de los templates del repo
  (mirá `skills/agente-devops/reports/devops-template.html:285-363`).
- Barra de % animada: `transform: scaleX()` con `transition` (nunca `transition: all`) +
  contador numérico con `requestAnimationFrame` que se detiene cuando el valor no cambia
  (CPU 0% en reposo).
- Ficha nueva: entrada animada. Al terminar: la barra se completa y aparece el badge
  "terminado" (verde). Activas arriba, terminadas abajo.
- Animaciones bajo `@media (prefers-reduced-motion: no-preference)`.
- Render: **sólo `textContent`**, CERO `innerHTML` (XSS de E20 + `skills/shared/report-security.md`).
- Por ficha: nombre, proyecto (último segmento del path), estado, último tool, pasos, barra.
- Header: total de sesiones, activas, terminadas, reloj de la última actualización.

## 6. Garantía de dev-only (C6)

- Todo el código en `scratch/kraken/`: gitignored, fuera de `package.json.files`, nunca copiado
  por `install-core.js`.
- **Un** archivo trackeado nuevo: `tests/kraken-dev-only.test.js`, que verifique SÓLO hechos
  estructurales, sin depender de que el kraken exista en la máquina:
  - `npm pack --dry-run` no lista nada bajo `scratch/`, `dev/` ni con "kraken" en el nombre;
  - `scripts/install-core.js` no copia `scratch/` ni `dev/`;
  - `git ls-files scratch/` está vacío.
  Conectalo en `package.json`: `scripts.test` y `scripts.gate` (`node tests/kraken-dev-only.test.js`).
- `scratch/kraken/instalar.js`: instala el plugin de opencode en la ruta global de plugins
  (`~/.config/opencode/plugin/kraken-feed.js`; verificá cuál es la ruta global real) y mergea
  los hooks de Claude Code en `~/.claude/settings.json` (backup `.bak`, merge, no reemplazo).
  Idempotente.

## 7. Documentación

`scratch/kraken/README.md`: cómo arrancar, cómo instalar, qué IDEs quedan instrumentados y
cuáles NO (Cursor/Antigravity/Copilot no emiten eventos: instrumentarlos exigiría publicar
código en ellos — decilo claro).

## 8. Verificación

1. `node tests/kraken-dev-only.test.js` → verde.
2. `npm run gate` → exit 0.
3. `node scratch/kraken/server.js` + `Invoke-WebRequest http://127.0.0.1:<puerto>/api/state`
   → JSON. Matar el server al terminar.
4. `scratch/kraken/kraken.test.js`: server en puerto efímero, eventos al JSONL, snapshot
   correcto, y el HTML servido sin `innerHTML` ni CDN. Determinista (directorio de estado
   temporal, no el global).

## 9. Límites (no tocar)

`.gitignore`, `.opencode/`, `scripts/ralph-policy.js`, `scripts/agent-guard.js`,
`scripts/autonomia.js`, `scripts/check-evolution.js`, `scripts/validate-skills.js`,
`tests/write-guard.test.js`, `tests/ralph-policy.test.js`, `tests/check-evolution.test.js`.
Están en la DENY de la jaula: si algo de eso hace falta, queda pendiente para el humano.
Sin `git commit` / `git push` / `npm publish` / `git tag`. Cero dependencias: sólo stdlib de Node.
