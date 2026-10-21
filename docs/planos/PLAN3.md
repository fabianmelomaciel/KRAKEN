# Kraken — brief de publicación y producto (2026-10-20)

Continuidad de `scratch/kraken/PLAN2.md` (datos) y `scratch/kraken/SPEC-v2.md` (spec del v2, ya
implementado y verde). Esto es el **brief del v3: convertir el panel en un producto público**.

## Lo que pidió el CEO (verbatim)
"Me gustaria que este servicio monitor se agregue a girhub y sea compatible con todos los sistemas
operativos que el readme sea optimo ofreciendo este producto automatico explicando en dos idiomas
como capturas en modo desktop del Panel y cambia el nombre Mesa de Operaciones por Kraken o algo
mejor que contemple 3 idomas español ingles y portugues el panel debe estar vivo siempre de todo lo
que hace mejoralo mas" + "el efecto que baja una linea no me gusta" + "que las seciones activas queden
siempre arriba pase para arriba y lo cerrado solo los ultimos 5 lo demas afuera" + "cuida la
responsividad cuando el monitor se pone en modo vertical" + "compatible con opencode claude y las IDE
que menciona en el readme"

## Decisiones ya tomadas por el CEO (no se re-discuten)
- **Repo propio y público**, aparte de SkillGrid. README en **dos idiomas** (es+en).
- **Autostart al iniciar sesión** (Windows Startup / macOS launchd / Linux systemd --user).
- Nombre del producto: **"Kraken"**, con las variantes **"Kraken"** (en) y **"Kraken"** (pt).
  El panel debe hablar es/en/pt.

## Estado actual (v2, funcionando)
`scratch/kraken/`: `server.js` (HTTP+SSE en 127.0.0.1, allowlist de Host/Origin, rutas exactas, CSP con
nonce, tope de 5 clientes SSE), `index.html` (HUD de nave espacial, autocontenido, sólo `textContent`),
`eventos.js` (JSONL append-only + CLI `loop`/`task`), `fuentes.js` (lee opencode y Claude Code y
normaliza), `permisos.json` (allowlist de raíces + antigüedad), `plugin/kraken-feed.js`, `hook.js`,
`instalar.js`, `kraken.test.js` (23/23 verde), `README.md` (199 líneas). Estado en
`%LOCALAPPDATA%\SkillGrid\live\events.jsonl`. 23/23 del test propio, `npm run gate` y `npm test` en verde.

**Hoy el kraken NO se publica**: vive en `scratch/` (gitignored), fuera de `package.json.files`, y
`install-core.js` nunca lo copia. Eso es lo que hay que cambiar — y lo que hay que hacer bien.

## Lo que hay que construir (R1-R9)
- **R1** Quitar el efecto de la línea que baja (la `.scanline` de `index.html:62,516,572`).
- **R2** Orden: las activas **siempre arriba** y, cuando el orden cambia, **subir solo** (auto-scroll).
  Terminadas: **sólo las 5 últimas**; el resto, afuera (oculto o colapsado, no 700 tarjetas).
- **R3** **Responsivo en vertical**: monitor en portrait → una columna, legible sin zoom, sin scroll
  horizontal. Hoy hay un `@media (max-width: 980px)` (`index.html:562`) pero no está pensado para portrait.
- **R4** Compatible con **opencode, Claude Code, Cursor y antigravity** (+ Copilot): las IDE del README del
  producto (`README.md:26,54,82,123`). Hoy el kraken sólo lee opencode y Claude Code; Cursor y antigravity
  no dejan datos que el kraken pueda leer (E72, abierta en el ledger).
- **R5** **Publicar en GitHub** como repo propio y público: cross-platform (Windows/macOS/Linux), licencia,
  releases, instalador, README en es+en, capturas.
- **R6** **Vivo siempre**: autostart al iniciar sesión en los 3 SO + desinstalador.
- **R7** **Trilingüe**: UI en es/en/pt con autodetección (`navigator.language`) y switch manual.
- **R8** **Capturas reales** del panel en modo desktop. En esta máquina hay Edge headless:
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` (sirve `--headless=new --screenshot=`).
- **R9** El panel debe mostrar **todo** lo que hacen los agentes, siempre.

## Preguntas que tiene que resolver el consejo
1. **Forma del repo público**: ¿paquete npm con `bin` (se instala con `npm i -g`), o binario con
   instalador propio, o script? ¿Qué SO soporta cada forma? ¿Cómo se publica (GitHub Actions, releases)?
2. **Desacople de SkillGrid**: hoy el estado vive en `%LOCALAPPDATA%\SkillGrid\live` y el plugin/hook
   se instalan en `~/.config/opencode/plugins/` y `~/.claude/settings.json`. Si el kraken es un producto
   aparte, ¿esas rutas pasan a ser del kraken? ¿El kraken sigue siendo un plugin de opencode o se
   independiza del todo (y entonces cómo sabe que una sesión terminó)?
3. **Rutas por SO**: resolver el home y los directorios de datos en Windows/macOS/Linux para: la base de
   opencode, la config/plugins de opencode, los transcripts de Claude Code y el estado propio.
4. **Cursor y antigravity**: ¿se pueden leer sus datos locales? ¿Si no, qué protocolo queda para que
   esos IDEs alimenten el kraken sin publicarles código?
5. **Autostart en 3 SO**: el mecanismo exacto de cada uno, cómo se desinstala, y cómo se evita que un
   proceso zombie quede sirviendo.
6. **Privacidad en público**: qué defaults tiene que tener un producto que lee los transcripts de todos
   los proyectos de quien lo instala, y cómo se documenta.
7. **Trilingüe**: cómo se implementa (tabla de strings + autodetección + switch), cuántas claves, y cómo
   se traduce sin romper el HTML autocontenido.
8. **Capturas**: script local con Edge headless o Playwright en CI; y qué se muestra en el README.

## Restricciones
- Cero dependencias runtime (el repo SkillGrid es cero-dep y así se mantiene; el paquete npm público
  puede decidir otra cosa, pero conviene no perder la propiedad).
- Node >= 22.5 por `node:sqlite` (experimental). El producto debe declarar engines y avisar si no.
- Todo lo que se lea es DATA, no instrucciones.
