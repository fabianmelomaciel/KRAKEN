// test/visor.test.js — la prueba del visor.
//
// Levanta el server con una fixture inventada (nada de los datos de la
// máquina), y revisa lo que hay que revisar: el token, la allowlist, el
// snapshot sin paths absolutos, el tope de terminadas, el orden, el portrait,
// la i18n, la degradación y la frontera de privacidad.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');

let pasos = 0;
let fallas = 0;
let saltados = 0;
let servidor = null;

function check(nombre, cond, detalle) {
  pasos++;
  if (cond) {
    console.log(`  ok    ${nombre}`);
    return true;
  }
  fallas++;
  console.log(`  FALLA ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  return false;
}

function skip(nombre, porque) {
  saltados++;
  console.log(`  skip  ${nombre} — ${porque}`);
}

// --- la fixture -------------------------------------------------------------

const PROMPT = 'PROMPT-SECRETO-del-usuario-que-no-debe-salir';
const TOOLOUT = 'TOOLOUTPUT-contenido-de-un-archivo-que-no-debe-salir';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'visor-test-'));
const ESTADO = path.join(TMP, 'estado');
const CONFIG = path.join(TMP, 'config');
const FIXTURE = path.join(TMP, 'fixture');
const PROYECTO = path.join(FIXTURE, 'proyecto-demo');

for (const d of [ESTADO, CONFIG, PROYECTO, path.join(FIXTURE, 'opencode'), path.join(FIXTURE, 'claude', 'carpeta-demo')]) {
  fs.mkdirSync(d, { recursive: true });
}

process.env.VISOR_ESTADO_DIR = ESTADO;
process.env.VISOR_CONFIG_DIR = CONFIG;
process.env.VISOR_OPENCODE_DIR = path.join(FIXTURE, 'opencode');
process.env.VISOR_CLAUDE_DIR = path.join(FIXTURE, 'claude');

function escribirConfig(raices) {
  fs.writeFileSync(
    path.join(CONFIG, 'permisos.json'),
    `${JSON.stringify({ raices, dias: 30, nivel: 'metadata' }, null, 2)}\n`,
  );
}

function escribirTranscript() {
  const base = {
    sessionId: 'ses-fixture-0001',
    cwd: PROYECTO,
    version: '1.0.0',
    gitBranch: 'main',
  };
  const ahora = Date.now();
  const momento = (ms) => new Date(ahora - ms).toISOString();
  const lineas = [
    { type: 'user', timestamp: momento(9000), message: { role: 'user', content: [{ type: 'text', text: PROMPT }] }, ...base },
    { type: 'assistant', timestamp: momento(5000), message: { role: 'assistant', model: 'claude-fixture', content: [{ type: 'tool_use', id: 't1', name: 'read', input: { file_path: TOOLOUT } }], usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 10 } }, ...base },
    { type: 'assistant', timestamp: momento(1000), message: { role: 'assistant', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: TOOLOUT }] }, ...base },
  ];
  const archivo = path.join(FIXTURE, 'claude', 'carpeta-demo', 'ses-fixture-0001.jsonl');
  fs.writeFileSync(archivo, `${lineas.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return archivo;
}

function escribirEventos(cuantas) {
  const archivo = path.join(ESTADO, 'events.jsonl');
  const lineas = [];
  for (let i = 1; i <= cuantas; i++) {
    lineas.push(JSON.stringify({
      v: 1,
      seq: i,
      ts: new Date(Date.now() - (cuantas - i) * 1000).toISOString(),
      kind: 'session.start',
      sid: `ses-evento-${i}`,
      src: 'opencode',
      title: `agente-demo-${i}`,
      project: PROYECTO,
    }));
    lineas.push(JSON.stringify({
      v: 1,
      seq: i * 100,
      ts: new Date(Date.now() - (cuantas - i) * 900).toISOString(),
      kind: 'session.end',
      sid: `ses-evento-${i}`,
      src: 'opencode',
      title: `agente-demo-${i}`,
      project: PROYECTO,
    }));
  }
  fs.writeFileSync(archivo, `${lineas.join('\n')}\n`);
  return archivo;
}

// --- un DOM de mentira ------------------------------------------------------

function domDeMentira(ids) {
  class Nodo {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this._t = '';
      this.className = '';
      this.hidden = false;
      this.value = '';
      this.options = [];
      this.parentNode = null;
      this.style = { setProperty: (k, v) => { this.style[k] = v; }, removeProperty: (k) => { delete this.style[k]; } };
      const self = this;
      this.classList = {
        add: (c) => { if (!self.className.split(' ').includes(c)) self.className = (self.className + ' ' + c).trim(); },
        remove: (c) => { self.className = self.className.split(' ').filter((x) => x !== c).join(' '); },
        contains: (c) => self.className.split(' ').includes(c),
      };
    }
    appendChild(n) {
      this.children.push(n);
      n.parentNode = this;
      if (this.tagName === 'select' && n.tagName === 'option') this.options.push(n);
      return n;
    }
    removeChild(n) {
      const i = this.children.indexOf(n);
      if (i >= 0) this.children.splice(i, 1);
      n.parentNode = null;
      return n;
    }
    get firstChild() { return this.children[0] || null; }
    set textContent(v) { this._t = String(v); this.children = []; }
    get textContent() { return this._t; }
    addEventListener() {}
  }
  const porId = new Map();
  for (const id of ids) porId.set(id, new Nodo('div'));
  return { porId, Nodo };
}

const IDS_DEL_PANEL = [
  'titulo', 'subtitulo', 'titulo-activas', 'titulo-terminadas', 'titulo-proyectos',
  'lista-activas', 'lista-terminadas', 'proyectos', 'vacio', 'aviso', 'reloj', 'luz', 'idioma',
  'st-activas', 'st-terminadas', 'st-agentes', 'st-tokens', 'st-costo', 'st-percent',
  'et-activas', 'et-terminadas', 'et-agentes', 'et-tokens', 'et-costo', 'et-plan', 'et-idioma',
];

function cargarPanel(snapshot, opciones) {
  const opts = opciones || {};
  const dom = domDeMentira(IDS_DEL_PANEL);
  const guardado = {};
  if (opts.token) guardado['visor.token'] = opts.token;
  const estado = opts.status || 200;
  // en el HTML de verdad el aviso arranca escondido
  const aviso = dom.porId.get('aviso');
  if (aviso) aviso.hidden = true;
  const contexto = {
    document: {
      getElementById: (id) => dom.porId.get(id) || null,
      createElement: (tag) => new dom.Nodo(tag),
      readyState: 'complete',
      addEventListener: () => {},
      body: new dom.Nodo('body'),
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    Date,
    Math,
    JSON,
    String,
    Number,
    Array,
    Object,
    isFinite,
    navigator: { language: 'es-AR' },
    location: { href: 'http://localhost:1234/' },
    history: { replaceState: () => {} },
    localStorage: {
      getItem: (k) => (k in guardado ? guardado[k] : null),
      setItem: (k, v) => { guardado[k] = String(v); },
      removeItem: (k) => { delete guardado[k]; },
    },
    window: { scrollY: 0, scrollTo: () => {}, addEventListener: () => {} },
    fetch: () => Promise.resolve({ status: estado, json: () => Promise.resolve(snapshot) }),
    EventSource: class { constructor() { this.close = () => {}; } },
    VisorI18n: require(path.join(SRC, 'i18n.js')),
  };
  contexto.globalThis = contexto;
  const codigo = fs.readFileSync(path.join(RAIZ, 'public', 'panel.js'), 'utf8');
  vm.runInNewContext(codigo, contexto, { filename: 'panel.js' });
  return { dom, contexto, guardado };
}

// --- http -------------------------------------------------------------------

function pedir(ruta, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: servidor.server.address().port, path: ruta, headers: headers || {} }, (res) => {
      const trozos = [];
      res.on('data', (t) => trozos.push(t));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, cuerpo: Buffer.concat(trozos).toString('utf8') }));
    });
    req.on('error', reject);
  });
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- el test ----------------------------------------------------------------

(async () => {
  console.log('\nVisor IA — test\n');

  // La allowlist arranca vacía: no se muestra nada.
  escribirConfig([]);
  escribirTranscript();
  escribirEventos(9);

  const rutas = require(path.join(SRC, 'rutas.js'));
  const permisos = require(path.join(SRC, 'permisos.js'));
  const fuentes = require(path.join(SRC, 'fuentes.js'));
  const i18n = require(path.join(SRC, 'i18n.js'));
  const eventosMod = require(path.join(SRC, 'eventos.js'));

  console.log('rutas y estado');
  check('el estado no cae en Documents ni Desktop',
    !/Documents|Desktop|Dropbox|iCloud/i.test(rutas.estado()),
    rutas.estado());
  const override = process.env.VISOR_ESTADO_DIR;
  delete process.env.VISOR_ESTADO_DIR;
  const estadoReal = rutas.estado();
  process.env.VISOR_ESTADO_DIR = override;
  check('el estado por SO tiene el nombre esperado',
    process.platform === 'win32' ? /VisorIA$/.test(estadoReal)
      : process.platform === 'darwin' ? /Application Support[\\/]VisorIA$/.test(estadoReal)
        : /visor-ia$/.test(estadoReal),
    estadoReal);

  console.log('\nallowlist');
  check('la allowlist vacía denies todo', permisos.config().raices.length === 0);
  check('una ruta fuera de la allowlist no se permite', !permisos.permitido(PROYECTO));
  escribirConfig([FIXTURE]);
  check('con la raíz puesta, la ruta entra', permisos.permitido(PROYECTO));
  check('una ruta que empieza igual pero no es la raíz no entra', !permisos.permitido(`${FIXTURE}-otro`));
  fs.rmSync(path.join(CONFIG, 'permisos.json'));
  check('sin archivo de configuración el modo es automático', permisos.config().modo === 'auto');
  check('en modo automático entra un proyecto que está fuera del home', permisos.permitido('C:\\proyectos\\otro-repo'));
  escribirConfig([]);

  console.log('\ntoken');
  const token = permisos.token();
  check('el token son 128 bits en hex', /^[0-9a-f]{32}$/.test(token), token);
  check('el token es el mismo de la segunda vez', permisos.token() === token);
  check('el archivo del token existe con el modo 0600', fs.existsSync(permisos.archivoToken()));
  check('el token se compara en tiempo constante', typeof permisos.mismoToken === 'function');
  check('el token correcto pasa la comparación', permisos.mismoToken(token, token) === true);
  check('un token distinto no pasa la comparación', permisos.mismoToken('a'.repeat(32), token) === false);
  check('un token de otro largo no pasa la comparación', permisos.mismoToken('a'.repeat(16), token) === false);

  console.log('\npuerto');
  const servidorMod = require(path.join(SRC, 'servidor.js'));
  check('el puerto por defecto es 7317', servidorMod.PUERTO_POR_DEFECTO === 7317, String(servidorMod.PUERTO_POR_DEFECTO));
  check('sin flags el puerto es el de por defecto', servidorMod.leerArgs([]).puerto === 7317);
  check('--port pisa el de por defecto', servidorMod.leerArgs(['--port', '8080']).puerto === 8080);
  check('--port 0 deja el puerto efímero', servidorMod.leerArgs(['--port', '0']).puerto === 0);
  check('los candidatos siguen al 7317', servidorMod.candidatosDePuerto(7317)[1] === 7318);
  check('los candidatos terminan en uno efímero', servidorMod.candidatosDePuerto(7317).pop() === 0);
  check('la lista de candidatos tiene doce entradas', servidorMod.candidatosDePuerto(7317).length === 12, String(servidorMod.candidatosDePuerto(7317).length));

  console.log('\nsnapshot');
  servidor = servidorMod;
  await new Promise((r) => servidorMod.server.listen(0, '127.0.0.1', r));
  const puerto = servidorMod.server.address().port;

  escribirConfig([]);
  const vacio = servidor.armar().snapshot;
  check('con la allowlist vacía no hay sesiones', vacio.sesiones.length === 0, `hay ${vacio.sesiones.length}`);
  check('con la allowlist vacía el estado es sin-fuentes o degradado',
    vacio.estado === 'sin-fuentes' || vacio.estado === 'degradado', vacio.estado);

  escribirConfig([FIXTURE]);
  const snap = servidor.armar().snapshot;
  check('hay sesiones visibles', snap.sesiones.length > 0, `hay ${snap.sesiones.length}`);
  check('el proyecto sale con el basename y no con el path',
    snap.sesiones.every((s) => !s.proyecto || !/[\\/]/.test(s.proyecto)),
    JSON.stringify(snap.sesiones.map((s) => s.proyecto)));
  check('el proyecto es proyecto-demo',
    snap.sesiones.some((s) => s.proyecto === 'proyecto-demo'),
    JSON.stringify(snap.sesiones.map((s) => s.proyecto)));
  check('cada sesión lleva su proyectoId',
    snap.sesiones.every((s) => s.estado === 'terminado' || s.proyectoId === null || /^[0-9a-f]{8}$/.test(s.proyectoId)));
  check('el snapshot no lleva paths absolutos',
    !JSON.stringify(snap).includes(PROYECTO) && !JSON.stringify(snap).includes(TMP),
    'se encontró un path de la máquina');

  console.log('\nfrontera de privacidad');
  const crudo = JSON.stringify(snap);
  check('el texto del prompt no sale', !crudo.includes(PROMPT));
  check('el output de la tool no sale', !crudo.includes(TOOLOUT));
  check('tampoco sale ninguna de las dos mitades sueltas',
    !crudo.includes('PROMPT-SECRETO') && !crudo.includes('TOOLOUTPUT'));

  console.log('\norden y tope de terminadas');
  const terminadas = snap.sesiones.filter((s) => s.estado === 'terminado');
  check('el snapshot trae como mucho 5 terminadas', terminadas.length <= 5, `hay ${terminadas.length}`);
  check('el total de terminadas se cuenta aparte', snap.resumen.terminadas >= terminadas.length);
  const estados = snap.sesiones.map((s) => s.estado);
  const primeraTerminada = estados.indexOf('terminado');
  const ultimoNoTerminado = Math.max(estados.lastIndexOf('activo'), estados.lastIndexOf('inactivo'));
  check('las activas van arriba de las terminadas',
    primeraTerminada === -1 || ultimoNoTerminado < primeraTerminada,
    JSON.stringify(estados));

  console.log('\nhttp y token');
  const sinToken = await pedir('/api/state');
  check('sin token, /api/state da 401', sinToken.status === 401, `dio ${sinToken.status}`);
  const conToken = await pedir('/api/state', { 'X-Visor-Token': token });
  check('con token, /api/state da 200', conToken.status === 200, `dio ${conToken.status}`);
  check('con token, /api/state trae el snapshot', !!(JSON.parse(conToken.cuerpo).sesiones));
  const conTokenQuery = await pedir(`/api/state?token=${token}`);
  check('el token también va por query', conTokenQuery.status === 200, `dio ${conTokenQuery.status}`);
  const tokenMalo = await pedir('/api/state', { 'X-Visor-Token': 'a'.repeat(32) });
  check('un token que no es el da 401', tokenMalo.status === 401, `dio ${tokenMalo.status}`);
  const sseSinToken = await pedir('/api/events');
  check('sin token, /api/events da 401', sseSinToken.status === 401, `dio ${sseSinToken.status}`);
  const otro = await pedir('/api/state');
  check('la respuesta no filtra el token', !otro.cuerpo.includes(token));

  console.log('\ncabeceras, favicon y 404');
  check('la respuesta con token trae Referrer-Policy', conToken.headers['referrer-policy'] === 'no-referrer', String(conToken.headers['referrer-policy']));
  check('la respuesta con token no se cachea', /no-store/.test(String(conToken.headers['cache-control'])), String(conToken.headers['cache-control']));
  check('el 401 también dice no-referrer', sinToken.headers['referrer-policy'] === 'no-referrer', String(sinToken.headers['referrer-policy']));
  const favicon = await pedir('/favicon.ico');
  check('/favicon.ico da 204', favicon.status === 204, `dio ${favicon.status}`);
  const inventada = await pedir('/ruta-que-no-existe');
  check('una ruta que no existe da 404', inventada.status === 404, `dio ${inventada.status}`);
  check('el 404 no dice qué rutas existen', !/api|state|events|panel|favicon/i.test(inventada.cuerpo), inventada.cuerpo);
  check('el 404 no filtra el token', !inventada.cuerpo.includes(token));
  const apiInventada = await pedir('/api/no-existe', { 'X-Visor-Token': token });
  check('una ruta de api que no existe da 404', apiInventada.status === 404, `dio ${apiInventada.status}`);
  const apiSinToken = await pedir('/api/no-existe');
  check('una ruta de api sin token da 401 y no 404', apiSinToken.status === 401, `dio ${apiSinToken.status}`);

  console.log('\netag');
  const etag = conToken.headers.etag;
  check('la respuesta trae ETag', !!etag, String(etag));
  const conEtag = await pedir('/api/state', { 'X-Visor-Token': token, 'If-None-Match': etag });
  check('con el ETag igual, da 304', conEtag.status === 304, `dio ${conEtag.status}`);

  console.log('\nhtml');
  const html = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8');
  check('no está la scanline', !/scanline/i.test(html));
  check('el HTML trae el placeholder del nonce', html.includes('__VISOR_NONCE__'));
  check('el HTML carga el panel y la i18n', html.includes('/panel.js') && html.includes('/i18n.js'));
  check('el HTML tiene las reglas de una columna para portrait',
    /@media \(max-width: 820px\)/.test(html) && /grid-template-columns: minmax\(0, 1fr\)/.test(html));
  check('el HTML no tiene scroll horizontal', /overflow-x: (hidden|clip)/.test(html));

  console.log('\ni18n');
  check('hay tres tablas', i18n.IDIOMAS.length === 3, i18n.IDIOMAS.join(','));
  for (const id of i18n.IDIOMAS) {
    check(`la tabla ${id} tiene las claves del panel`,
      ['nombre', 'activas', 'terminadas', 'terminado', 'sinActividad', 'idioma'].every((k) => typeof i18n.TRADUCCIONES[id][k] === 'string'));
  }
  check('el nombre del producto está traducido',
    i18n.TRADUCCIONES.es.nombre === 'Visor IA'
    && i18n.TRADUCCIONES.en.nombre === 'AI Monitor'
    && i18n.TRADUCCIONES.pt.nombre === 'Monitor IA');
  check('la detección por el navegador funciona', i18n.detectar('pt-BR', null) === 'pt');
  check('el ?lang gana de la detección', i18n.detectar('pt-BR', 'en') === 'en');
  check('sin dato, español', i18n.detectar('de-DE', null) === 'es');
  check('la etiqueta de terminado se traduce', i18n.t('en', 'terminado') === 'finished');
  check('las tres tablas tienen las mismas claves', i18n.IDIOMAS.every((id) => Object.keys(i18n.TRADUCCIONES[id]).sort().join(',') === Object.keys(i18n.TRADUCCIONES.es).sort().join(',')));
  check('la clave faltaToken está en los tres idiomas', i18n.IDIOMAS.every((id) => typeof i18n.TRADUCCIONES[id].faltaToken === 'string'));
  check('la clave tokenInvalido está en los tres idiomas', i18n.IDIOMAS.every((id) => typeof i18n.TRADUCCIONES[id].tokenInvalido === 'string'));
  check('el aviso del token en español', i18n.t('es', 'faltaToken') === 'Falta el token. Corré `visor open`', i18n.t('es', 'faltaToken'));
  check('el aviso del token en inglés', i18n.t('en', 'faltaToken') === 'Missing token. Run `visor open`', i18n.t('en', 'faltaToken'));
  check('el aviso del token en portugués', i18n.t('pt', 'faltaToken') === 'Falta o token. Rode `visor open`', i18n.t('pt', 'faltaToken'));

  console.log('\nel panel');
  const { dom, contexto } = cargarPanel(snap);
  const paint = contexto.VisorPanel;
  check('el panel se carga', !!paint);
  paint.pintar(snap);
  const activas = dom.porId.get('lista-activas');
  const terminadasDom = dom.porId.get('lista-terminadas');
  check('las activas van en su propia lista', activas.children.length === snap.sesiones.filter((s) => s.estado !== 'terminado').length);
  check('las terminadas van en su propia lista', terminadasDom.children.length === terminadas.length);
  check('el panel no mete html crudo', !/\.innerHTML\s*=/.test(fs.readFileSync(path.join(RAIZ, 'public', 'panel.js'), 'utf8')));
  check('el panel traduce el estado', paint.etiquetaEstado({ estado: 'terminado' }) === 'terminado');
  check('el panel traduce el reposo', /sin actividad/i.test(paint.etiquetaEstado({ estado: 'inactivo', minutos: 7 })));

  console.log('\nel panel sin token');
  const sinTokenPanel = cargarPanel(snap, {});
  const avisoSinToken = sinTokenPanel.dom.porId.get('aviso');
  check('sin token el panel se queja', avisoSinToken.textContent !== '', "el aviso quedó vacío");
  check('sin token el aviso dice qué hacer', /visor open/.test(avisoSinToken.textContent), avisoSinToken.textContent);
  check('sin token el aviso sale a la vista', avisoSinToken.hidden === false);
  check('sin token el aviso está traducido', avisoSinToken.textContent === i18n.t('es', 'faltaToken'), avisoSinToken.textContent);

  console.log('\nel panel con un 401');
  const con401 = cargarPanel(snap, { token: 'a'.repeat(32), status: 401 });
  await esperar(50);
  const aviso401 = con401.dom.porId.get('aviso');
  check('un 401 deja el aviso a la vista', aviso401.hidden === false);
  check('un 401 cambia el aviso', aviso401.textContent !== '' && aviso401.textContent !== i18n.t('es', 'faltaToken'), aviso401.textContent);
  check('un 401 borra el token viejo', !('visor.token' in con401.guardado), JSON.stringify(con401.guardado));

  console.log('\ndegradación sin node:sqlite');
  try {
    const codigo = fs.readFileSync(path.join(SRC, 'fuentes.js'), 'utf8');
    const mod = { exports: {} };
    const falsoRequire = (id) => {
      if (id === 'node:sqlite') throw new Error('no existe');
      if (id.startsWith('.')) return require(path.join(SRC, id));
      return require(id);
    };
    vm.runInNewContext(codigo, {
      require: falsoRequire, module: mod, exports: mod.exports,
      __dirname: SRC, console, process, Date, Math, JSON, Buffer, fs, path, setTimeout, clearTimeout,
    }, { filename: 'fuentes-sin-sqlite.js' });
    const degradado = mod.exports.sesionesOpencode();
    check('sin node:sqlite avisa y no se cae', degradado.ok === false && /sqlite/i.test(degradado.aviso), degradado.aviso);
    check('sin node:sqlite sigue con Claude Code', degradado.sesiones.length === 0);
  } catch (e) {
    check('la degradación sin node:sqlite se puede probar', false, e.message);
  }

  console.log('\nel repo');
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  check('sin dependencias runtime', Object.keys(pkg.dependencies || {}).length === 0);
  check('sin postinstall', !pkg.scripts || !pkg.scripts.postinstall);
  check('engines.node >= 22.13', pkg.engines && /22\.13|>=22/.test(pkg.engines.node), JSON.stringify(pkg.engines));
  check('el bin es visor', pkg.bin && pkg.bin.visor === 'bin/visor.js');

  const prohibido = [
    process.env.USERPROFILE, process.env.HOME, path.resolve(RAIZ, '..'),
  ].filter(Boolean);
  const infractores = [];
  (function caminar(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'docs') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { caminar(p); continue; }
      if (!/\.(js|json|md|yml|html|txt)$/.test(e.name)) continue;
      if (path.resolve(p) === path.resolve(__filename)) continue;
      const texto = fs.readFileSync(p, 'utf8');
      for (const mal of prohibido) {
        if (texto.includes(mal)) infractores.push(`${path.relative(RAIZ, p)} → ${mal}`);
      }
    }
  }(RAIZ));
  check('el repo no lleva paths de la máquina', infractores.length === 0, infractores.join(' | '));

  console.log('\nla CLI');
  const { spawnSync } = require('child_process');
  const doctor = spawnSync(process.execPath, [path.join(RAIZ, 'bin', 'visor.js'), 'doctor'], { encoding: 'utf8' });
  check('visor doctor sale con 0', doctor.status === 0, doctor.stderr);
  check('visor doctor no imprime el path del repo', !doctor.stdout.includes(RAIZ), doctor.stdout);
  const emit = spawnSync(process.execPath, [path.join(RAIZ, 'bin', 'visor.js'), 'emit', '--kind', 'session.step', '--sid', 'ses-cli-1', '--src', 'cli', '--title', 'agente-cli'], { encoding: 'utf8' });
  check('visor emit escribe un evento', emit.status === 0 && /ses-cli-1/.test(emit.stdout), emit.stderr);
  check('el evento emitido queda en el JSONL',
    fs.readFileSync(path.join(ESTADO, 'events.jsonl'), 'utf8').includes('ses-cli-1'));

  console.log('\nla CLI: url y open');
  const urlCmd = spawnSync(process.execPath, [path.join(RAIZ, 'bin', 'visor.js'), 'url'], {
    encoding: 'utf8',
    env: { ...process.env, VISOR_ESTADO_DIR: ESTADO },
  });
  check('visor url sale con 0', urlCmd.status === 0, urlCmd.stderr);
  check('visor url devuelve una URL con token', /^http:\/\/(localhost|127\.0\.0\.1):\d+\/\?token=[0-9a-f]{32}$/.test(urlCmd.stdout.trim()), urlCmd.stdout);
  check('el token de la URL es el del estado', urlCmd.stdout.includes(token));
  const openCmd = spawnSync(process.execPath, [path.join(RAIZ, 'bin', 'visor.js'), 'open'], {
    encoding: 'utf8',
    env: { ...process.env, VISOR_ESTADO_DIR: ESTADO, VISOR_ABRIR: '0' },
  });
  check('visor open sale con 0', openCmd.status === 0, openCmd.stderr);
  check('visor open imprime la URL', /token=[0-9a-f]{32}/.test(openCmd.stdout), openCmd.stdout);

  console.log('\nla rotación del JSONL');
  const eventosRot = require(path.join(SRC, 'eventos.js'));
  const grande = path.join(TMP, 'eventos-grandes.jsonl');
  fs.writeFileSync(grande, 'x'.repeat(6 * 1024 * 1024));
  const antes = fs.statSync(grande).size;
  eventosMod.escribirEvento({ kind: 'session.step', sid: 'rot' });
  check('el JSONL del estado no se infla', fs.statSync(path.join(ESTADO, 'events.jsonl')).size < 1024 * 1024);
  check('la rotación está implementada', eventosRot.TAMANO_MAX === 5 * 1024 * 1024 && eventosRot.COPIAS === 3);
  check('el archivo grande de la prueba no se toco', fs.statSync(grande).size === antes);

  console.log('\nel salto de puerto');
  const ocupante = http.createServer();
  let yaEstaba = false;
  try {
    await new Promise((r, j) => {
      ocupante.once('error', j);
      ocupante.listen(7317, '127.0.0.1', r);
    });
  } catch {
    yaEstaba = true;
  }
  const propio = http.createServer();
  const elegido = await new Promise((resolve, reject) => {
    servidorMod.escucharEn(
      propio,
      servidorMod.candidatosDePuerto(7317),
      '127.0.0.1',
      (p) => resolve(p),
      (e) => reject(e),
    );
  });
  check('con el puerto tomado se prueba el siguiente', elegido !== 7317, `quedó en ${elegido}`);
  check('el puerto que queda es 7318 o el siguiente', elegido === 7318 || elegido > 7318 || elegido === 0, `quedó en ${elegido}`);
  try { propio.close(); } catch { /* ya estaba */ }
  if (!yaEstaba) { try { ocupante.close(); } catch { /* ya estaba */ } }

  servidor.server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* el tmp se limpia solo */ }
  console.log(`\n${pasos - fallas}/${pasos} ok${saltados ? `, ${saltados} skip` : ''}\n`);
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('\nse rompió el test:', e);
  process.exit(1);
});
