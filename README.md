# Visor IA

Panel local para ver, en vivo, qué están haciendo tus agentes de código.
Sesiones activas arriba, terminadas abajo, con tokens, costo, tools, diffs,
checklists y subagentes. Todo corre en tu máquina: el visor lee lo que los
IDEs ya escribieron y no manda nada a ningún lado.

![El panel en desktop](docs/img/visor-desktop.png)

Es un producto cross-platform: Windows, macOS y Linux. Cero dependencias de
runtime, sin telemetría, sin update-check, sin `postinstall`.

## Instalar

```bash
npm i -g git+https://github.com/fabianmelomaciel/visor-ia.git
```

O sin instalar nada:

```bash
npx git+https://github.com/fabianmelomaciel/visor-ia.git serve
```

Hace falta **Node 22.13 o más**: la base de opencode se lee con `node:sqlite`,
que todavía es experimental. Con un Node más viejo el visor igual levanta:
avisa en el panel y sigue con Claude Code y con los eventos.

## Arrancar

```bash
visor serve
```

Levanta en `http://localhost:7317` (puerto fijo por defecto) y abre el
navegador. La primera carga lleva el token en la query:

```
http://localhost:7317/?token=<128 bits en hex>
```

El panel lo guarda en `localStorage`, lo saca de la URL y de ahí en adelante
lo manda en el header. Para tomar un puerto fijo:

```bash
visor serve --port 8080
```

Flags: `--port N` (0 = efímero), `--host H`, `--no-browser`, `--lang es|en|pt`,
`--dir RUTA` (el estado en otro lado, para probar).

El panel sólo escucha en `127.0.0.1` y valida el `Host`: si no es
`127.0.0.1:<puerto>` o `localhost:<puerto>` contesta 403. Con `--host` para
otra cosa avisa por consola que queda expuesto a la red.

Si el 7317 está tomado el visor prueba con el 7318, y así hasta el 7327: si
se agotan cae a un puerto efímero. Nunca se queda sin puerto y nunca se muere
por un puerto ocupado.

## La URL y el token

El token de 128 bits no sale nunca por consola. La URL que lo lleva se pide
explícitamente:

```bash
visor url      # imprime la URL con el token
visor open     # abre esa URL en el navegador
```

`visor url` arma la URL con el puerto que quedó escuchando y el token del
archivo de estado (modo 0600). `visor open` hace lo mismo y la abre: la URL
se valida antes de tocar el sistema (sólo `localhost` o `127.0.0.1` con
puerto numérico, sin caracteres de control) y nunca pasa por un intérprete
de comandos. Si la máquina no tiene navegador, `visor open` imprime la URL y
sale con 0.

## El autostart

`visor autostart` deja el visor arrancando solo al iniciar sesión y, además
de escribir el archivo, **lo activa** en cada sistema:

| SO | Qué escribe | Qué activa |
| --- | --- | --- |
| Windows | `VisorIA.cmd` en la carpeta Startup | la carpeta Startup lo corre en el próximo login; el `.cmd` deja un log en `autostart.log` |
| macOS | `~/Library/LaunchAgents/io.visor-ia.plist` | `launchctl bootstrap` (y `bootout` al desinstalar) |
| Linux | `~/.config/systemd/user/io.visor-ia.service` | `systemctl --user daemon-reload` y `enable --now` (y `disable` al desinstalar) |

En macOS el `KeepAlive` es por fallo y en Linux `Restart=on-failure` con
`RestartSec=5`: si el visor se cae, vuelve solo. Si el comando del sistema
falla (permisos, systemd que no está), se avisa por consola y se sigue.

Por defecto el autostart **no** abre el navegador. Con el flag sí:

```bash
visor autostart --con-navegador
```

En macOS y Linux el flag se traduce en la opción del launcher; en Windows el
`.cmd` llama a `visor open` después de arrancar el visor. Para dar vuelta
todo: `visor autostart --remove`. `visor doctor` dice si el autostart está
instalado **y** si está activo en esta máquina.

## Las tres fuentes

| Fuente | Dónde | Qué sale |
| --- | --- | --- |
| opencode | `~/.local/share/opencode/opencode.db` | sesiones, agente, modelo, tokens, costo, diff, todo, tool, subagentes |
| Claude Code | `~/.claude/projects/*/*.jsonl` | sesiones, modelo, tokens, tool, subagentes |
| eventos | el JSONL del estado | dispara el tick y dice qué sesión terminó |

**Fuentes oficiales: opencode y Claude Code.** Para Cursor, Antigravity y
Copilot hay **contrato de ingesta**, no integración nativa: esos IDEs no
dejan datos legibles en un formato estable, así que el visor no los adivina.
Si tu agente expone eventos, mandalos vos:

```bash
visor emit --kind session.step --sid mi-agente --src cursor --tool read
```

o por HTTP:

```bash
curl -X POST http://127.0.0.1:7317/api/event \
  -H "X-Visor-Token: <el token>" \
  -H "Content-Type: application/json" \
  -d '{"kind":"session.step","sid":"mi-agente","src":"cursor","tool":"read"}'
```

El JSONL dejó de ser la fuente de verdad: es el que **dispara** la lectura y
el único que puede marcar una sesión como terminada. Si el plugin o el hook no
lo dicen, el panel dice "sin actividad hace Xm" y nunca inventa el fin.

## Instrumentar los IDEs (opt-in)

El visor **no toca los IDEs** por default. `visor install-ide` es para quien
quiera la señal exacta de "terminó" y el trigger en vivo:

```bash
visor install-ide          # instala
visor install-ide --dry-run  # muestra qué haría
```

El instalador hace dos cosas:

1. copia el plugin a `~/.config/opencode/plugins/` (`visor-feed.js` más
   `visor-eventos.js`);
2. mergea los hooks de Claude Code en `~/.claude/settings.json` (backup en
   `.bak`, nunca reemplaza lo que estaba).

Es idempotente: se puede correr de nuevo sin duplicar nada. Y
`visor uninstall` da vuelta todo: saca el plugin, restaura el `.bak` de los
hooks, borra el autostart y limpia el estado (`--keep-state` lo deja).

### Hooks de Claude Code

| Hook | Qué anota |
| --- | --- |
| `SessionStart` | abre la ficha |
| `UserPromptSubmit` | la sesión volvió a moverse |
| `PreToolUse` | un paso más (con el nombre de la tool) |
| `Stop` / `SessionEnd` | cierra la ficha |

## Qué muestra y qué no

Por sesión: nombre, proyecto, IDE, agente, modelo, estado, barra, tokens
(entrada, salida, cache), costo, duración, última tool y su estado, diff
`+add/−del`, nº de mensajes, checklist de tareas y subagentes anidados.

Global: sesiones activas, terminadas, agentes vivos, tokens acumulados, costo
acumulado, % global (sólo si hay denominador real), reloj de la última
lectura, luz de estado y la columna de proyectos.

**Nunca sale**: el texto de los prompts, el texto de las respuestas, el
`tool.input` ni el `tool.output`. Todo lo que sale pasa por un filtro de
secretos (`sk-…`, `ghp_…`, `AKIA…`, claves privadas, `Bearer …`, JWT, `npm_…`)
y por un tope de 200 caracteres por campo.

El snapshot **no lleva paths absolutos**: el proyecto sale con su nombre y un
hash corto del path, así que el panel no cuenta en qué carpeta vivís. La
allowlist de adentro sí usa el path completo.

El render del HTML es sólo `textContent` y `createElement`: no hay `innerHTML`
en ningún lado.

## La allowlist

Por default la allowlist está en **modo automático**: se ve lo que tus IDEs ya
conocen, o sea los proyectos en los que trabajás, y nada más. Para
restringirla, escribí `permisos.json` en la carpeta de configuración con las
raíces que querés (una lista vacía deniega todo):

| SO | Ruta |
| --- | --- |
| Windows | `%APPDATA%\VisorIA\permisos.json` |
| macOS | `~/Library/Application Support/VisorIA/permisos.json` |
| Linux | `$XDG_CONFIG_HOME/visor-ia/permisos.json` (o `~/.config/visor-ia/permisos.json`) |

```json
{
  "raices": ["C:\\proyectos\\mi-repo", "/home/usuario/codigo"],
  "dias": 30,
  "nivel": "metadata"
}
```

- `raices`: una sesión cuyo directorio no cae en ninguna raíz **no se muestra**.
  Una lista vacía deniega todo.
- `dias`: los transcripts de Claude Code más viejos que esto ni se leen.
- `nivel`: `metadata` es el único valor implementado. El texto de los prompts
  no se expone en ningún nivel.

`visor doctor` te dice dónde está cada cosa y si las fuentes están.

## Seguridad

- **Token de 128 bits obligatorio** en todas las rutas `/api/*`: sin token
  (o con un token que no es el) la respuesta es 401. Vive en el archivo de
  estado, con modo 0600.
- La base del IDE se abre **en sólo lectura**: `readOnly`,
  `PRAGMA query_only=1` y `busy_timeout`. El visor nunca crea la base ni le
  crea índices.
- La CSP del HTML lleva un nonce por respuesta y no lleva `unsafe-inline`.
- El estado vive en la carpeta del SO (`%LOCALAPPDATA%\VisorIA`,
  `~/Library/Application Support/VisorIA`, `$XDG_STATE_HOME/visor-ia`).
  **Nunca** en Documents, Desktop, Dropbox ni iCloud.
- `/api/events` tiene un tope de 24 clientes y los frames tienen tope de bytes.
- El directorio del estado se crea con modo `700` y los archivos con `600`
  (en Windows el modo es un aviso: no hay permisos POSIX que honrar).

## El panel

- Las activas van **siempre arriba** y, cuando el orden cambia, el panel sube
  solo. Si scrolleaste a mano, no te pisa el scroll.
- Las terminadas son **sólo las 5 últimas**: el resto ni entra en el snapshot,
  así que tampoco está en el DOM de nadie.
- En portrait es una sola columna, sin scroll horizontal.
- El nombre del producto y los textos vienen en español, inglés y portugués,
  con autodetección (`navigator.language`), `?lang=` y un selector en la barra.

![El panel en portrait](docs/img/visor-portrait.png)

## Los comandos

```bash
visor serve [--port N] [--host H] [--no-browser] [--lang es|en|pt]
visor url
visor open
visor install-ide [--dry-run]
visor uninstall [--keep-state]
visor autostart [--remove] [--con-navegador]
visor emit [--kind K] [--sid S] [--src X] [--title T] [--tool T] [--step N] [--total N] [--project P]
visor doctor
```

`visor autostart` deja el visor arrancando solo al iniciar sesión: Startup en
Windows, un LaunchAgent en macOS, una unidad de systemd `--user` en Linux.
**Siempre con `--no-browser`**: abrir una pestaña en cada login es una
molestia, y en una máquina compartida es un problema. `visor autostart --remove`
lo da vuelta.

## Rutas

| Ruta | Qué es |
| --- | --- |
| `GET /` | el panel |
| `GET /api/state` | snapshot JSON (con ETag: 304 si no cambió) |
| `GET /api/events` | SSE con el snapshot cuando cambia |
| `POST /api/event` | ingesta de un evento |

Cualquier otra ruta da 404 (el favicon da 204: no existe y no hace falta que
diga nada). El SSE manda el snapshot completo a cada cliente
nuevo y después sólo cuando algo cambió: **en reposo no hay pushes**. Si el
SSE se cae, el panel cae a polling de `/api/state`.

El reloj se acomoda: con actividad lee cada 3 segundos, en reposo cada 30. Un
evento nuevo dispara el refresco a los 120 milisegundos. Los timers van con
`unref` y el JSONL rota a los 5 MB (tres copias) reseteando el offset.

## Test

```bash
node test/visor.test.js
```

Levanta el server con una fixture inventada —nunca con tus datos— y revisa el
token, la allowlist, el snapshot sin paths absolutos, el tope de terminadas,
el orden, el portrait, la i18n, la degradación sin `node:sqlite` y la
frontera de privacidad. Corre en Windows, macOS y Linux.

## Licencia

MIT. [English version](README.en.md).
