// server.js — el panel. Sirve el HTML y el estado en vivo por SSE, atado
// siempre a 127.0.0.1 y con el Host validado: es una herramienta de la
// máquina, no un servicio para la red.
//
// El JSONL de eventos ya no es la fuente: es el que dispara el tick y el que
// dice qué sesión terminó. Los datos vienen de las fuentes de los IDEs.

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const eventos = require('./eventos.js');
const fuentes = require('./fuentes.js');
const permisos = require('./permisos.js');
const rutas = require('./rutas.js');
const i18n = require('./i18n.js');
const navegador = require('./navegador.js');

const RAIZ = path.join(__dirname, '..');
const PUBLICO = path.join(RAIZ, 'public');
const HTML = path.join(PUBLICO, 'index.html');
const PANEL_JS = path.join(PUBLICO, 'panel.js');
const I18N_JS = path.join(__dirname, 'i18n.js');
const PUERTO_POR_DEFECTO = 7317;
// si el puerto pedido está tomado se prueban estos diez y, al final, uno
// efímero: nunca se queda sin puerto
const PUERTO_FALLBACKS = 10;
const MAX_CLIENTES = 24;
const MAX_BYTES_FRAME = 1572864;
const VIVA_MS = 5 * 60 * 1000;
const TERMINADAS_VISIBLES = 5;
const REPOSO_MS = 30000;
const ACTIVIDAD_MS = 3000;
const TRIGGER_MS = 120;

function leerArgs(argv) {
  const cfg = { puerto: PUERTO_POR_DEFECTO, host: '127.0.0.1', navegador: true, dir: null, lang: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '--puerto') {
      const n = Number(argv[++i]);
      if (Number.isInteger(n) && n >= 0 && n <= 65535) cfg.puerto = n;
    }
    else if (a === '--host') cfg.host = String(argv[++i] || '127.0.0.1');
    else if (a === '--no-browser' || a === '--sin-navegador') cfg.navegador = false;
    else if (a === '--con-navegador' || a === '--con-browser') cfg.navegador = true;
    else if (a === '--lang' || a === '--idioma') cfg.lang = String(argv[++i] || '');
    else if (a === '--dir') cfg.dir = argv[++i];
  }
  return cfg;
}

const cfg = leerArgs(process.argv.slice(2));
if (cfg.dir) process.env.VISOR_ESTADO_DIR = cfg.dir;

const archivo = eventos.archivoEventos();
const dirEstado = path.dirname(archivo);
// El token de 128 bits se lee del archivo del estado: sin él, /api/* es 401.
const TOKEN = permisos.token();

// lo que dijo el plugin y los hooks: el estado vive en RAM, no en un archivo
const estadoEventos = new Map();
const clientes = new Set();

const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const texto = (v) => (typeof v === 'string' && v !== '' ? v : null);

function sesionDe(ev, crear) {
  const sid = texto(ev.sid) || 'desconocida';
  let s = estadoEventos.get(sid);
  if (!s) {
    if (!crear) return null;
    s = {
      sid,
      title: texto(ev.title) || texto(ev.src) || sid,
      src: texto(ev.src),
      project: texto(ev.project),
      estado: 'activo',
      pasos: 0,
      tool: null,
      paso: null,
      total: null,
      inicio: texto(ev.ts),
      fin: null,
      actividad: texto(ev.ts),
    };
    estadoEventos.set(sid, s);
  }
  if (texto(ev.title)) s.title = texto(ev.title);
  if (texto(ev.src)) s.src = texto(ev.src);
  if (texto(ev.project)) s.project = texto(ev.project);
  if (texto(ev.ts)) s.actividad = texto(ev.ts);
  return s;
}

function aplicar(ev) {
  if (!ev || !ev.kind) return;
  const s = sesionDe(ev, true);
  if (!s) return;

  if (ev.kind === 'session.start' || ev.kind === 'session.reopen') {
    s.estado = 'activo';
    s.fin = null;
  } else if (ev.kind === 'session.step') {
    // una sesión cerrada que vuelve a moverse vuelve a estar activa
    if (s.estado === 'terminado') { s.estado = 'activo'; s.fin = null; }
    s.pasos += 1;
    if (texto(ev.tool)) s.tool = texto(ev.tool);
  } else if (ev.kind === 'session.end') {
    s.estado = 'terminado';
    s.fin = texto(ev.ts) || new Date().toISOString();
  } else if (ev.kind === 'loop.iteration') {
    s.paso = numero(ev.step);
    s.total = numero(ev.total);
  }
}

// --- armado del snapshot ----------------------------------------------------

function ultimoSegmento(p) {
  if (!p) return null;
  const partes = String(p).split(/[\\/]/).filter(Boolean);
  return partes.length ? partes[partes.length - 1] : null;
}

function claveDe(s) {
  return s.ide === 'claude' ? s.id.replace(/^claude:/, '') : s.id;
}

function minutosDe(ultima) {
  if (!ultima) return null;
  return Math.max(0, Math.floor((Date.now() - ultima) / 60000));
}

// "Terminado" sólo si el plugin o el hook lo dijo. Si no, la hora del último
// movimiento: nunca inventar el fin.
function estadoDe(s) {
  if (s.estado === 'terminado') return { estado: 'terminado', badge: 'terminado', minutos: null };
  const min = minutosDe(s.ultimaActividad);
  if (min === null) return { estado: 'inactivo', badge: 'sin actividad', minutos: null };
  if (min < 1) return { estado: 'activo', badge: 'activo', minutos: 0 };
  return { estado: 'inactivo', badge: `sin actividad hace ${min}m`, minutos: min };
}

function combinar(ide) {
  const lista = ide.map((s) => {
    const ev = estadoEventos.get(claveDe(s));
    const copia = { ...s };
    if (ev) {
      if (ev.estado === 'terminado') copia.estado = 'terminado';
      if (ev.pasos) copia.pasos = ev.pasos;
      if (ev.paso !== null && ev.paso !== undefined) {
        copia.paso = ev.paso;
        copia.total = ev.total;
      }
      if (!copia.titulo && ev.title) copia.titulo = ev.title;
      if (!copia.proyecto && ev.project) {
        const proyecto = permisos.proyectoDe(ev.project);
        copia.proyecto = proyecto.proyecto;
        copia.proyectoId = proyecto.proyectoId;
        copia.proyectoCorto = proyecto.proyecto;
      }
    }
    if (copia.pasos === undefined) copia.pasos = 0;
    const est = estadoDe(copia);
    copia.estado = est.estado;
    copia.minutos = est.minutos;
    copia.viva = est.estado === 'activo' || (est.estado === 'inactivo' && minutosDe(copia.ultimaActividad) !== null && (Date.now() - copia.ultimaActividad) < VIVA_MS);
    copia.barra = (copia.paso !== null && copia.paso !== undefined && copia.total > 0) ? 'plan' : 'actividad';
    copia.percent = copia.barra === 'plan' ? Math.max(0, Math.min(100, Math.round((copia.paso / copia.total) * 100))) : null;

    // los subagentes tienen su propio estado: viven mientras se mueven
    for (const sub of copia.subagentes || []) {
      const est = estadoDe({ estado: sub.estado === 'terminado' ? 'terminado' : 'activo', ultimaActividad: sub.ultimaActividad });
      sub.estado = est.estado === 'terminado' ? 'terminado' : est.estado;
      sub.badge = est.badge;
      sub.viva = (Date.now() - (sub.ultimaActividad || 0)) < VIVA_MS;
    }
    return copia;
  });

  // las sesiones que sólo existen en el JSONL (un agente externo, por ejemplo)
  for (const [sid, ev] of estadoEventos) {
    if (ide.some((s) => claveDe(s) === sid)) continue;
    if (ev.project && !fuentes.permitido(ev.project)) continue;
    const proyecto = permisos.proyectoDe(ev.project);
    lista.push({
      id: sid,
      ide: ev.src || 'evento',
      titulo: ev.title || sid,
      proyecto: proyecto.proyecto,
      proyectoId: proyecto.proyectoId,
      proyectoCorto: proyecto.proyecto,
      agente: ev.src,
      modelo: null,
      provider: null,
      padre: null,
      lateral: false,
      estado: ev.estado,
      minutos: null,
      viva: ev.estado !== 'terminado',
      pasos: ev.pasos,
      tool: ev.tool ? { nombre: ev.tool, estado: 'completed' } : null,
      toolBytes: null,
      paso: ev.paso,
      total: ev.total,
      percent: ev.paso !== null && ev.paso !== undefined && ev.total > 0
        ? Math.max(0, Math.min(100, Math.round((ev.paso / ev.total) * 100))) : null,
      barra: ev.paso !== null && ev.paso !== undefined && ev.total > 0 ? 'plan' : 'actividad',
      tokens: { entrada: 0, salida: 0, razonamiento: 0, cacheLectura: 0, cacheEscritura: 0 },
      costo: 0,
      diff: null,
      mensajes: ev.pasos,
      checklist: null,
      subagentes: [],
      inicio: ev.inicio ? Date.parse(ev.inicio) || null : null,
      fin: ev.fin ? Date.parse(ev.fin) || null : null,
      ultimaActividad: ev.actividad ? Date.parse(ev.actividad) || null : null,
      duracion: null,
    });
  }

  return lista;
}

function armarBase() {
  const oc = fuentes.sesionesOpencode();
  const cc = fuentes.sesionesClaude();
  const lista = combinar([...oc.sesiones, ...cc.sesiones]);

  // Las activas van siempre arriba y las terminadas al final. De las
  // terminadas sólo salen las 5 últimas: el resto ni entra al snapshot, así
  // que tampoco está en el DOM de nadie.
  const RANGO = { activo: 0, inactivo: 1, terminado: 2 };
  lista.sort((a, b) => {
    const ra = RANGO[a.estado] === undefined ? 1 : RANGO[a.estado];
    const rb = RANGO[b.estado] === undefined ? 1 : RANGO[b.estado];
    if (ra !== rb) return ra - rb;
    return String(b.ultimaActividad || 0).localeCompare(String(a.ultimaActividad || 0));
  });

  const terminadas = lista.filter((s) => s.estado === 'terminado');
  const enPanel = lista
    .filter((s) => s.estado !== 'terminado')
    .concat(terminadas.slice(0, TERMINADAS_VISIBLES));

  const tokens = { entrada: 0, salida: 0, razonamiento: 0, cacheLectura: 0, cacheEscritura: 0 };
  let costo = 0;
  for (const s of lista) {
    for (const k of Object.keys(tokens)) tokens[k] += (s.tokens && s.tokens[k]) || 0;
    costo += s.costo || 0;
  }

  // el % global necesita un denominador real: el loop de Ralph o los
  // checkboxes de un archivo de tareas. Sin eso, no hay número.
  let pasos = 0;
  let totales = 0;
  for (const s of lista) {
    if (s.paso === null || s.paso === undefined || !(s.total > 0)) continue;
    pasos += s.paso;
    totales += s.total;
  }
  const percent = totales > 0 ? Math.max(0, Math.min(100, Math.round((pasos / totales) * 100))) : null;

  const proyectos = new Map();
  for (const s of lista) {
    const nombre = s.proyectoCorto || s.proyecto || 'sin proyecto';
    if (!proyectos.has(nombre)) {
      proyectos.set(nombre, { nombre, proyectoId: s.proyectoId || null, sesiones: 0, activas: 0 });
    }
    const p = proyectos.get(nombre);
    p.sesiones += 1;
    if (s.viva) p.activas += 1;
  }

  let agentes = 0;
  for (const s of lista) {
    if (s.viva) agentes += 1;
    for (const sub of s.subagentes || []) {
      if (sub.viva) agentes += 1;
    }
  }

  const degradado = !oc.ok || !cc.ok;
  const sinFuentes = lista.length === 0 && !oc.ok && !cc.ok && estadoEventos.size === 0;

  return {
    ok: true,
    estado: sinFuentes ? 'sin-fuentes' : (degradado ? 'degradado' : 'vivo'),
    fuentes: {
      opencode: { ok: oc.ok, aviso: oc.aviso, codigo: oc.codigo || null, sesiones: oc.sesiones.length },
      claude: { ok: cc.ok, aviso: cc.aviso, codigo: cc.codigo || null, sesiones: cc.sesiones.length },
      eventos: { ok: true, aviso: null, codigo: null, sesiones: estadoEventos.size },
    },
    resumen: {
      total: lista.length,
      activas: lista.filter((s) => s.viva).length,
      terminadas: terminadas.length,
      terminadasVisibles: enPanel.filter((s) => s.estado === 'terminado').length,
      agentesVivos: agentes,
      tokens,
      costo: Number(costo.toFixed(6)),
      percent,
      plan: { pasos, total: totales },
    },
    proyectos: [...proyectos.values()].sort((a, b) => b.sesiones - a.sesiones),
    sesiones: enPanel,
  };
}

let ultimoHash = null;
let ultimoSnapshot = null;
let ultimoCambio = 0;

// El hash es la firma del snapshot: si no cambia, no hay nada que empujar.
// Los minutos cambian con el reloj y no cuentan como cambio.
function firma(base) {
  const sesiones = base.sesiones.map((s) => {
    const c = { ...s };
    delete c.minutos;
    return c;
  });
  return crypto.createHash('sha1').update(JSON.stringify({ ...base, sesiones })).digest('hex');
}

function armar() {
  const base = armarBase();
  const hash = firma(base);
  const snapshot = { ...base, lectura: new Date().toISOString() };
  if (hash !== ultimoHash) {
    ultimoHash = hash;
    ultimoSnapshot = snapshot;
    ultimoCambio = Date.now();
    return { snapshot, cambio: true };
  }
  if (ultimoSnapshot) {
    ultimoSnapshot.lectura = snapshot.lectura;
    return { snapshot: ultimoSnapshot, cambio: false };
  }
  ultimoSnapshot = snapshot;
  ultimoHash = hash;
  ultimoCambio = Date.now();
  return { snapshot, cambio: true };
}

function snapshot() {
  return ultimoSnapshot || armar().snapshot;
}

function etagActual() {
  if (!ultimoSnapshot) armar();
  return ultimoHash;
}

// --- el archivo de eventos: tail por offset -------------------------------
// fs.watch en Windows coalescea eventos, así que el stat cada medio segundo
// es la red de seguridad: sin ella se pierden líneas.

let offset = 0;
let identidad = null;
let cola = Buffer.alloc(0);
let tickPendiente = null;

function leerDesde() {
  let st;
  try { st = fs.statSync(archivo); } catch { return null; }
  // el JSONL rotó o lo truncaron: el offset vuelve a cero y no se lee
  // basura del archivo que se fue.
  const id = `${st.ino || 0}:${st.birthtimeMs || 0}`;
  if (identidad !== null && id !== identidad) { offset = 0; cola = Buffer.alloc(0); }
  identidad = id;
  if (st.size < offset) { offset = 0; cola = Buffer.alloc(0); }
  if (st.size <= offset) return null;
  const fd = fs.openSync(archivo, 'r');
  try {
    const buf = Buffer.alloc(st.size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function mandar(carga) {
  for (const res of clientes) {
    try { res.write(carga); } catch { clientes.delete(res); }
  }
}

function empujar(snap) {
  let cuerpo = JSON.stringify(snap);
  if (Buffer.byteLength(cuerpo) > MAX_BYTES_FRAME) {
    // si el snapshot no entra en un frame, se recorta la cola de sesiones
    const copia = { ...snap, sesiones: snap.sesiones.slice(0, 40) };
    copia.resumen = { ...snap.resumen, total: copia.sesiones.length };
    cuerpo = JSON.stringify(copia);
  }
  mandar(`data: ${cuerpo}\n\n`);
}

function tick() {
  let r;
  try {
    r = armar();
  } catch {
    return;
  }
  if (r.cambio) empujar(r.snapshot);
}

function pedirTick() {
  if (tickPendiente) return;
  tickPendiente = setTimeout(() => {
    tickPendiente = null;
    tick();
  }, TRIGGER_MS);
  tickPendiente.unref();
}

function bombear() {
  const trozo = leerDesde();
  if (!trozo) return;
  offset += trozo.length;
  cola = Buffer.concat([cola, trozo]);
  const partes = cola.toString('utf8').split('\n');
  cola = Buffer.from(partes.pop(), 'utf8');
  let movido = false;
  for (const linea of partes) {
    if (!linea.trim()) continue;
    let ev;
    try { ev = JSON.parse(linea); } catch { continue; }
    aplicar(ev);
    movido = true;
  }
  if (movido) pedirTick();
}

// --- http -----------------------------------------------------------------

let html = null;

function leerHtml() {
  if (html === null) {
    try { html = fs.readFileSync(HTML, 'utf8'); } catch { html = ''; }
  }
  return html;
}

function nonce() {
  return crypto.randomBytes(16).toString('base64');
}

function plano(res, codigo, texto) {
  res.writeHead(codigo, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  res.end(texto);
}

function puertoActual() {
  const dir = server.address();
  return dir && dir.port ? dir.port : cfg.puerto;
}

// El pidfile es el candado: si no hay un visor vivo no hay puerto especial.
function pidVivo() {
  try {
    const previo = JSON.parse(fs.readFileSync(path.join(dirEstado, 'visor.pid'), 'utf8'));
    if (previo && previo.pid && vivo(previo.pid)) return previo.pid;
  } catch { /* no hay pidfile */ }
  return null;
}

// El puerto que quedó realmente: si hay un visor vivo en esta máquina, el que
// dice el archivo del estado. Si no hay ninguno, el de por defecto.
function puertoEfectivo() {
  if (!pidVivo()) return PUERTO_POR_DEFECTO;
  try {
    const info = JSON.parse(fs.readFileSync(path.join(dirEstado, 'server-info'), 'utf8'));
    if (info && Number.isInteger(info.port) && info.port > 0) return info.port;
  } catch { /* no hay server-info */ }
  return PUERTO_POR_DEFECTO;
}

// La lista de puertos a probar: el pedido, los diez siguientes al de por
// defecto y, al final, uno efímero.
function candidatosDePuerto(puerto) {
  const lista = [];
  if (Number.isInteger(puerto) && puerto > 0) lista.push(puerto);
  for (let p = PUERTO_POR_DEFECTO + 1; p <= PUERTO_POR_DEFECTO + PUERTO_FALLBACKS; p++) {
    if (!lista.includes(p)) lista.push(p);
  }
  lista.push(0);
  return lista;
}

// Escuchar es ir probando: si el puerto está tomado se pasa al siguiente y se
// avisa por consola. Un puerto ocupado nunca es motivo para morirse.
function escucharEn(srv, candidatos, host, alListo, alFallar) {
  let i = 0;
  const intentar = () => {
    const puerto = candidatos[i];
    const alError = (err) => {
      srv.removeListener('error', alError);
      if (err && err.code === 'EADDRINUSE' && i + 1 < candidatos.length) {
        const siguiente = candidatos[i + 1];
        i += 1;
        console.warn(`visor: el puerto ${puerto} está ocupado; pruebo con ${siguiente === 0 ? 'uno efímero' : siguiente}`);
        setImmediate(intentar);
        return;
      }
      if (alFallar) alFallar(err);
    };
    srv.once('error', alError);
    srv.listen(puerto, host, () => {
      srv.removeListener('error', alError);
      if (alListo) alListo(srv.address().port);
    });
  };
  intentar();
}

// DNS rebinding: si el Host no es el del panel, no se contesta.
function hostPermitido(host) {
  const p = puertoActual();
  return host === `127.0.0.1:${p}` || host === `localhost:${p}`;
}

function origenPermitido(origen) {
  const p = puertoActual();
  return origen === `http://127.0.0.1:${p}` || origen === `http://localhost:${p}`;
}

// El token puede ir en el header (lo usan fetch y la CLI) o en la query
// (EventSource no puede mandar headers).
function tokenDe(req, url) {
  const header = req.headers['x-visor-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const q = url.searchParams.get('token');
  return q ? q.trim() : null;
}

function autorizado(req, url, res) {
  const candidato = tokenDe(req, url);
  // la comparación es en tiempo constante: el 401 tarda lo mismo que el 200
  if (permisos.tokenValido(candidato) && permisos.mismoToken(candidato, TOKEN)) return true;
  plano(res, 401, '401');
  return false;
}

function servirArchivo(res, archivo, tipo, csp) {
  let cuerpo;
  try { cuerpo = fs.readFileSync(archivo, 'utf8'); } catch { return plano(res, 404, '404'); }
  const cabeceras = {
    'Content-Type': tipo,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  if (csp) cabeceras['Content-Security-Policy'] = csp;
  res.writeHead(200, cabeceras);
  res.end(cuerpo);
}

function cuerpoDe(req, limite) {
  return new Promise((resolve) => {
    let datos = '';
    let tamano = 0;
    req.on('data', (t) => {
      tamano += t.length;
      if (tamano > limite) { req.destroy(); resolve(null); return; }
      datos += t;
    });
    req.on('end', () => resolve(datos));
    req.on('error', () => resolve(null));
  });
}

async function manejar(req, res) {
  let url;
  try { url = new URL(req.url || '/', 'http://127.0.0.1'); } catch { url = new URL('/', 'http://127.0.0.1'); }
  const ruta = url.pathname;

  if (!hostPermitido(String(req.headers.host || ''))) return plano(res, 403, '403');

  if (ruta.startsWith('/api/')) {
    if (!autorizado(req, url, res)) return undefined;
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    // fuera de /api sólo hay lectura: cualquier otro método tiene que traer
    // un Origin del panel, y aun así no hay nada que hacer con él.
    if (!origenPermitido(String(req.headers.origin || ''))) return plano(res, 403, '403');
    return plano(res, 404, '404');
  }

  if (ruta === '/') {
    const cuerpo = leerHtml();
    if (!cuerpo) return plano(res, 500, 'falta index.html');
    const n = nonce();
    const htmlFinal = cuerpo.replace(/__VISOR_NONCE__/g, n);
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${n}'`,
      `style-src 'nonce-${n}'`,
      "connect-src 'self'",
      "img-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      'nosniff',
    ].join('; ');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': csp,
    });
    if (req.method === 'HEAD') return res.end();
    return res.end(htmlFinal);
  }

  if (ruta === '/panel.js' || ruta === '/i18n.js') {
    const archivo = ruta === '/panel.js' ? PANEL_JS : I18N_JS;
    return servirArchivo(res, archivo, 'text/javascript; charset=utf-8', "default-src 'none'; sandbox");
  }

  if (ruta === '/api/state') {
    const snap = snapshot();
    const cuerpo = JSON.stringify(snap);
    const etag = etagActual();
    const cabeceras = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ETag: `"${etag}"`,
    };
    if (String(req.headers['if-none-match'] || '').replace(/^W\//, '') === `"${etag}"`) {
      res.writeHead(304, cabeceras);
      if (req.method === 'HEAD') return res.end();
      return res.end();
    }
    res.writeHead(200, cabeceras);
    if (req.method === 'HEAD') return res.end();
    return res.end(cuerpo);
  }

  if (ruta === '/api/events') {
    if (clientes.size >= MAX_CLIENTES) return plano(res, 503, 'demasiados clientes');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.write('retry: 2000\n\n');
    clientes.add(res);
    // un cliente nuevo arranca con el snapshot completo
    try { res.write(`data: ${JSON.stringify(snapshot())}\n\n`); } catch { clientes.delete(res); }
    const latido = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clientes.delete(res); }
    }, 15000);
    latido.unref();
    req.on('close', () => { clearInterval(latido); clientes.delete(res); });
    return undefined;
  }

  if (ruta === '/api/event' && req.method === 'POST') {
    const crudo = await cuerpoDe(req, 64 * 1024);
    if (crudo === null) return plano(res, 413, 'evento demasiado grande');
    let ev;
    try { ev = JSON.parse(crudo || '{}'); } catch { return plano(res, 400, 'json inválido'); }
    if (!ev || typeof ev !== 'object' || typeof ev.kind !== 'string') return plano(res, 400, 'falta kind');
    const registro = eventos.escribirEvento(ev);
    aplicar(registro);
    pedirTick();
    res.writeHead(201, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify({ ok: true, seq: registro.seq }));
  }

  // el favicon no existe: se contesta 204 y no se dice nada sobre qué rutas
  // hay
  if (ruta === '/favicon.ico') {
    res.writeHead(204, {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end();
  }

  return plano(res, 404, '404');
}

// --- arranque -------------------------------------------------------------

const server = http.createServer(manejar);
const sockets = new Set();
server.on('connection', (s) => {
  sockets.add(s);
  s.on('close', () => sockets.delete(s));
});
let watcher = null;
let reloj = null;
let escuchando = false;

function abrirNavegador(url) {
  // la URL se valida antes de tocar el sistema y nunca pasa por un shell
  navegador.abrir(url).catch(() => {
    // si no hay navegador, el humano usa la URL que queda impresa
  });
}

function cerrar() {
  for (const nombre of ['server-info', 'visor.pid']) {
    try { fs.rmSync(path.join(dirEstado, nombre), { force: true }); } catch { /* nada */ }
  }
  if (reloj) clearInterval(reloj);
  if (watcher) { try { watcher.close(); } catch { /* nada */ } }
  for (const s of sockets) { try { s.destroy(); } catch { /* nada */ } }
  sockets.clear();
  try { server.close(); } catch { /* nada */ }
  setTimeout(() => process.exit(0), 200).unref();
}

function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// El pidfile hace de lock: si ya hay un visor vivo en esta máquina, el
// segundo no abre ni un puerto.
function tomarPid() {
  const destino = path.join(dirEstado, 'visor.pid');
  try {
    const previo = JSON.parse(fs.readFileSync(destino, 'utf8'));
    if (previo && previo.pid && vivo(previo.pid)) {
      throw new Error(`ya hay un visor corriendo (pid ${previo.pid})`);
    }
  } catch (e) {
    if (e && String(e.message).startsWith('ya hay')) throw e;
  }
  fs.writeFileSync(destino, `${JSON.stringify({ pid: process.pid, inicio: Date.now() })}\n`, { mode: 0o600 });
  return destino;
}

// El reloj se acomoda: con actividad cada 3 segundos, en reposo cada 30.
// En reposo no hay pushes ni lecturas pesadas.
function cadencia() {
  return Date.now() - ultimoCambio < ACTIVIDAD_MS * 4 ? ACTIVIDAD_MS : REPOSO_MS;
}

function relojLoop() {
  try { bombear(); } catch { /* un stat fallido no corta el visor */ }
  try { tick(); } catch { /* una fuente que falla tampoco */ }
  reloj = setTimeout(relojLoop, cadencia());
  reloj.unref();
}

function arrancar() {
  fs.mkdirSync(dirEstado, { recursive: true, mode: 0o700 });
  try {
    tomarPid();
  } catch (e) {
    console.error(`visor: ${e.message}`);
    process.exit(1);
  }
  bombear();
  tick();

  try {
    watcher = fs.watch(dirEstado, () => {
      try { bombear(); } catch { /* un evento raro no corta el visor */ }
    });
  } catch {
    // sin watch: el stat del reloj alcanza
  }

  reloj = setTimeout(relojLoop, cadencia());
  reloj.unref();

  server.on('error', (err) => {
    // los errores del listen los lleva escucharEn, que prueba el siguiente
    // puerto: acá sólo se avisan los que pasan después de escuchar
    if (escuchando) console.error(`visor: error del servidor — ${err.message}`);
  });

  escucharEn(server, candidatosDePuerto(cfg.puerto), cfg.host, (puerto) => {
    escuchando = true;
    const url = `http://localhost:${puerto}`;
    // el token viaja en la query de la primera carga: el panel lo guarda en
    // localStorage y de ahí en adelante va en el header. El idioma va en el
    // fragmento, así la URL no lleva dos parámetros pegados con un "&".
    const urlConToken = `${url}/?token=${TOKEN}${cfg.lang ? `#lang=${encodeURIComponent(cfg.lang)}` : ''}`;
    const info = {
      type: 'server-started',
      pid: process.pid,
      port: puerto,
      host: cfg.host,
      url,
      urlConToken,
      dir: dirEstado,
      archivo,
    };
    try {
      fs.writeFileSync(path.join(dirEstado, 'server-info'), `${JSON.stringify(info)}\n`, { mode: 0o600 });
    } catch { /* nada */ }
    // por consola sale la URL sin token: el token se pide con `visor url`
    const publico = { ...info };
    delete publico.urlConToken;
    console.log(JSON.stringify(publico));
    console.log('visor: la URL con token la da `visor url` (o `visor open` para abrirla)');
    if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
      console.warn(`visor: escuchando en ${cfg.host} — el panel queda expuesto a la red.`);
    }
    if (cfg.navegador) abrirNavegador(urlConToken);
  }, (err) => {
    console.error(`visor: no pude escuchar en ${cfg.host} — ${err.message}`);
    process.exit(1);
  });

  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
}

module.exports = {
  server, snapshot, aplicar, leerArgs, armar, tick, estadoEventos, arrancar,
  TOKEN, etagActual,
  PUERTO_POR_DEFECTO,
  candidatosDePuerto,
  escucharEn,
  puertoEfectivo,
  urlConToken: () => `http://localhost:${puertoEfectivo()}/?token=${TOKEN}`,
};

if (require.main === module) {
  arrancar();
}
