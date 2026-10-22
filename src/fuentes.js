// fuentes.js — lee las dos fuentes de los IDEs y las deja en el mismo shape:
// el kraken no sabe de dónde salió cada sesión.
//
// opencode: el SQLite de ~/.local/share/opencode/opencode.db, en sólo lectura.
// Claude Code: los transcripts JSONL de ~/.claude/projects/*/.
//
// La redacción vive acá, en la frontera: acá es el último lugar donde el dato
// todavía es texto. Si algo sale de este archivo, sale sin prompt, sin
// tool.input y sin tool.output.

const fs = require('fs');
const path = require('path');
const rutas = require('./rutas.js');
const permisosModulo = require('./permisos.js');

const LIMITE_TEXTO = 200;
const TOP_OPENCODE = 80;
const TOP_CLAUDE = 40;
const TTL_CACHE = 24 * 60 * 60 * 1000;
// techo de memoria para las caches de transcripts: se cae lo más viejo primero
const MAX_BYTES_CACHE = 48 * 1024 * 1024;

// --- secretos ---------------------------------------------------------------
// Lo que salga de acá pasa por un filtro: si aparece algo con pinta de
// credencial, sale tachado.

const SECRETOS = [
  // sk-, sk-ant-, sk-proj-: el guion parte el patrón corto, así que la
  // clase [A-Za-z0-9] no alcanzaba a las claves de Anthropic ni de OpenAI
  /sk-[A-Za-z0-9_\-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /glpat-[A-Za-z0-9_\-]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_\-]{35}/g,
  /hf_[A-Za-z0-9]{20,}/g,
  /(sk|pk)_(live|test)_[A-Za-z0-9]{16,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY/g,
  /Bearer\s+\S{10,}/g,
  /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,
  /npm_[A-Za-z0-9]{20,}/g,
];

function redactar(v) {
  if (typeof v !== 'string') return null;
  const limpio = v.replace(/\s+/g, ' ').trim();
  if (!limpio) return null;
  let salida = limpio;
  for (const re of SECRETOS) salida = salida.replace(re, '«redactado»');
  return salida.length > LIMITE_TEXTO ? `${salida.slice(0, LIMITE_TEXTO - 1)}…` : salida;
}

function numero(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// --- allowlist --------------------------------------------------------------
// La lista de carpetas permitidas y el token viven en src/permisos.js. La
// allowlist compara con el path completo; de acá para afuera sale sólo el
// nombre del proyecto y un hash corto.

function permisos() {
  return permisosModulo.config();
}

function permitido(ruta) {
  return permisosModulo.permitido(ruta);
}

// --- node:sqlite ------------------------------------------------------------

let sqlite = null;
let sqliteProbado = false;

function moduloSqlite() {
  if (!sqliteProbado) {
    sqliteProbado = true;
    try {
      sqlite = require('node:sqlite');
    } catch {
      sqlite = null;
    }
  }
  return sqlite;
}

let base = null;

function abrirBase() {
  if (base) return { ok: true, aviso: null };
  const mod = moduloSqlite();
  if (!mod) return { ok: false, aviso: 'node:sqlite no existe en este Node: hace falta 22.5 o más. Sigo con Claude Code y los eventos.', codigo: 'sin-sqlite' };
  const ruta = rutas.baseOpencode();
  try {
    if (!fs.existsSync(ruta)) {
      return { ok: false, aviso: 'no está la base de opencode en esta máquina. Sigo con Claude Code y los eventos.', codigo: 'sinBase' };
    }
    const db = new mod.DatabaseSync(ruta, { readOnly: true });
    db.exec('PRAGMA query_only=1');
    db.exec('PRAGMA busy_timeout=2000');
    base = db;
    return { ok: true, aviso: null, codigo: null };
  } catch (e) {
    return { ok: false, aviso: `no pude abrir la base de opencode en sólo lectura: ${e.message}. Sigo con Claude Code y los eventos.`, codigo: 'baseLectura' };
  }
}

// --- opencode ---------------------------------------------------------------

// Nunca `select * from part`: son 140 mil filas y 87 MB de heap por llamada.
// Acá van agregados con la marca de tiempo y columnas sueltas.

const SQL_SESIONES = `select id, parent_id, title, directory, agent, model, cost,
  tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
  summary_additions, summary_deletions, summary_files, time_created, time_updated
  from session order by time_updated desc limit ?`;

// `part` no tiene índice por tiempo: filtrar por `time_created` obliga a
// barrer las 140 mil filas. La vuelta corta es por el índice de `message`
// (session_id, time_created, id): los últimos mensajes de la sesión y, con
// el índice de message_id, los parts de esos mensajes. Todo por índice.
const SQL_ULTIMOS_MENSAJES = 'select id from message where session_id = ? order by time_created desc limit ?';

const SQL_PARTS_DE_MENSAJES = `select session_id, message_id, time_created, length(data) as bytes,
  json_extract(data,'$.tool') as tool,
  json_extract(data,'$.type') as tipo,
  json_extract(data,'$.files') as archivos,
  json_extract(data,'$.state.status') as estado,
  json_extract(data,'$.state.time.start') as inicio,
  json_extract(data,'$.state.time.end') as fin
  from part where message_id in (%s)`;

const ULTIMOS_MENSAJES = 12;

const SQL_MENSAJES = 'select session_id, count(*) as c from message where session_id in (%s) group by session_id';
const SQL_TODOS = 'select session_id, content, status, priority, position from todo where session_id in (%s) order by session_id, position';

const cachePartes = new Map();   // session_id -> { tool, estado, bytes, ts, tocados, timeSesion }

// Las caches se podran: una ficha que hace un día no se tocó no sirve más
// y la memoria del kraken no tiene por qué crecer con el histórico.
//
// El TTL sigue a la ventana de lectura (conf.dias): si la lista mira 30 días
// y la poda tira a las 24 h, cada transcript viejo se relee entero en cada
// tick. Y encima hay un techo de bytes: se cae lo más viejo primero.
function ttlCache() {
  const dias = Number(permisos().dias) || 0;
  return Math.max(TTL_CACHE, dias * 24 * 60 * 60 * 1000);
}

function podar(cache) {
  const limite = Date.now() - ttlCache();
  let bytes = 0;
  for (const [k, v] of cache) {
    const t = v.timeSesion || v.mtime || 0;
    if (t && t < limite) { cache.delete(k); continue; }
    bytes += v.tamano || v.bytes || 0;
  }
  if (bytes <= MAX_BYTES_CACHE) return;
  const items = [...cache.entries()]
    .sort((a, b) => (a[1].mtime || a[1].timeSesion || 0) - (b[1].mtime || b[1].timeSesion || 0));
  for (const [k, v] of items) {
    if (bytes <= MAX_BYTES_CACHE) break;
    cache.delete(k);
    bytes -= v.tamano || v.bytes || 0;
  }
}

function modeloDe(texto) {
  if (typeof texto !== 'string' || !texto) return { modelo: null, provider: null };
  try {
    const m = JSON.parse(texto);
    return { modelo: redactar(m.id), provider: redactar(m.providerID) };
  } catch {
    return { modelo: redactar(texto), provider: null };
  }
}

function ultimosSegmentos(ruta) {
  const partes = String(ruta || '').split(/[\\/]/).filter(Boolean);
  return partes.length ? partes[partes.length - 1] : null;
}

function sesionOpencode(fila, extra) {
  const { modelo, provider } = modeloDe(fila.model);
  const proyecto = permisosModulo.proyectoDe(fila.directory);
  return {
    id: fila.id,
    ide: 'opencode',
    titulo: redactar(fila.title) || fila.id,
    proyecto: proyecto.proyecto,
    proyectoId: proyecto.proyectoId,
    proyectoCorto: proyecto.proyecto,
    agente: redactar(fila.agent),
    modelo,
    provider,
    padre: fila.parent_id || null,
    lateral: Boolean(fila.parent_id),
    estado: 'activo',
    inicio: numero(fila.time_created),
    fin: null,
    ultimaActividad: numero(fila.time_updated),
    duracion: numero(fila.time_created) && numero(fila.time_updated)
      ? Math.max(0, fila.time_updated - fila.time_created) : null,
    tokens: {
      entrada: numero(fila.tokens_input) || 0,
      salida: numero(fila.tokens_output) || 0,
      razonamiento: numero(fila.tokens_reasoning) || 0,
      cacheLectura: numero(fila.tokens_cache_read) || 0,
      cacheEscritura: numero(fila.tokens_cache_write) || 0,
    },
    costo: numero(fila.cost) || 0,
    tool: extra.tool || null,
    toolBytes: extra.bytes || null,
    diff: fila.summary_files || fila.summary_additions || fila.summary_deletions
      ? {
        agregados: numero(fila.summary_additions) || 0,
        borrados: numero(fila.summary_deletions) || 0,
        archivos: numero(fila.summary_files) || 0,
      }
      : null,
    mensajes: extra.mensajes || 0,
    checklist: extra.checklist || null,
    subagentes: [],
  };
}

function leerPartes(db, sesiones) {
  // sólo se vuelve a preguntar por las sesiones que se movieron
  const cambiadas = sesiones.filter((s) => {
    const previo = cachePartes.get(s.id);
    return !previo || (s.ultimaActividad || 0) > previo.timeSesion;
  });
  if (!cambiadas.length) return;

  for (const s of cambiadas) {
    const previo = cachePartes.get(s.id) || { tool: null, estado: null, bytes: 0, ts: 0, tocados: new Set() };

    // los últimos mensajes de la sesión, por índice, y los parts de esos
    // mensajes: nunca un barrido de las 140 mil filas de `part`
    let mids = [];
    try {
      mids = db.prepare(SQL_ULTIMOS_MENSAJES).all(s.id, ULTIMOS_MENSAJES).map((r) => r.id);
    } catch {
      mids = [];
    }

    if (mids.length) {
      const huecos = mids.map(() => '?').join(',');
      let filas = [];
      try {
        filas = db.prepare(SQL_PARTS_DE_MENSAJES.replace('%s', huecos)).all(...mids);
      } catch {
        filas = [];
      }
      filas.sort((a, b) => (a.time_created || 0) - (b.time_created || 0));

      for (const f of filas) {
        if (f.tipo === 'patch' && f.archivos) {
          // los parches traen los archivos que se tocaron, no cuántas líneas
          try {
            const lista = JSON.parse(f.archivos);
            if (Array.isArray(lista)) for (const x of lista) previo.tocados.add(x);
          } catch { /* el campo no vino como lista */ }
          continue;
        }
        if (!f.tool) continue;
        if (!previo.tool || (f.time_created || 0) >= previo.ts) {
          previo.tool = redactar(f.tool);
          previo.estado = redactar(f.estado);
          previo.bytes = numero(f.bytes) || 0;
          previo.ts = f.time_created || 0;
          previo.inicio = numero(f.inicio);
          previo.fin = numero(f.fin);
        }
      }
    }

    previo.timeSesion = s.ultimaActividad || 0;
    cachePartes.set(s.id, previo);
  }
}

function sesionesOpencode() {
  podar(cachePartes);
  const estado = abrirBase();
  if (!estado.ok) return { ok: false, aviso: estado.aviso, sesiones: [] };
  const db = base;
  let filas = [];
  try {
    filas = db.prepare(SQL_SESIONES).all(TOP_OPENCODE);
  } catch (e) {
    return { ok: false, aviso: `la base de opencode no respondió: ${e.message}. Sigo con Claude Code y los eventos.`, codigo: 'baseLectura', sesiones: [] };
  }

  const permitidas = filas.filter((f) => permitido(f.directory));
  if (!permitidas.length) {
    return { ok: true, aviso: null, sesiones: [] };
  }

  const ids = permitidas.map((f) => f.id);
  const huecos = ids.map(() => '?').join(',');

  let conteos = new Map();
  try {
    for (const r of db.prepare(SQL_MENSAJES.replace('%s', huecos)).all(...ids)) {
      conteos.set(r.session_id, r.c || 0);
    }
  } catch {
    conteos = new Map();
  }

  const checklists = new Map();
  try {
    for (const r of db.prepare(SQL_TODOS.replace('%s', huecos)).all(...ids)) {
      if (!checklists.has(r.session_id)) checklists.set(r.session_id, []);
      checklists.get(r.session_id).push({
        texto: redactar(r.content) || '(sin texto)',
        estado: redactar(r.status) || 'pending',
        prioridad: redactar(r.priority),
      });
    }
  } catch {
    checklists = new Map();
  }

  const baseSesiones = permitidas.map((f) => sesionOpencode(f, { mensajes: conteos.get(f.id) || 0 }));

  leerPartes(db, baseSesiones);

  for (const s of baseSesiones) {
    const p = cachePartes.get(s.id);
    if (p) {
      s.tool = p.tool ? { nombre: p.tool, estado: p.estado || 'desconocido' } : null;
      s.toolBytes = p.bytes;
      s.archivos = p.tocados ? p.tocados.size : 0;
    }
    const items = checklists.get(s.id);
    if (items && items.length) {
      s.checklist = {
        total: items.length,
        hechos: items.filter((i) => i.estado === 'completed').length,
        items,
      };
    }
  }

  // los subagentes cuelgan del padre
  const porId = new Map(baseSesiones.map((s) => [s.id, s]));
  for (const s of baseSesiones) {
    if (!s.padre) continue;
    const padre = porId.get(s.padre);
    if (!padre) continue;
    padre.subagentes.push({
      id: s.id,
      titulo: s.titulo,
      estado: s.estado,
      agente: s.agente,
      modelo: s.modelo,
      tool: s.tool,
      ultimaActividad: s.ultimaActividad,
      tokens: s.tokens,
      checklist: s.checklist,
    });
  }

  return { ok: true, aviso: null, sesiones: baseSesiones };
}

// --- Claude Code ------------------------------------------------------------

const cacheClaude = new Map();   // ruta -> ficha

function raizClaude() {
  return rutas.proyectosClaude();
}

function listarTranscripts(raiz, dias) {
  const salida = [];
  const limite = Date.now() - dias * 86400000;
  let dirs = [];
  try {
    dirs = fs.readdirSync(raiz, { withFileTypes: true });
  } catch {
    return salida;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const proyecto = path.join(raiz, d.name);
    let entradas = [];
    try {
      entradas = fs.readdirSync(proyecto, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      const p = path.join(proyecto, e.name);
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        salida.push({ ruta: p, proyecto: d.name, sesion: e.name.replace(/\.jsonl$/, ''), lateral: false });
      } else if (e.isDirectory()) {
        // los subagentes viven en <proyecto>/<sesion>/subagents/*.jsonl
        let sub = [];
        try {
          sub = fs.readdirSync(p, { withFileTypes: true });
        } catch {
          continue;
        }
        const subDir = path.join(p, 'subagents');
        let archivos = [];
        try {
          archivos = fs.readdirSync(subDir);
        } catch {
          archivos = [];
        }
        for (const a of archivos) {
          if (!a.endsWith('.jsonl')) continue;
          salida.push({
            ruta: path.join(subDir, a),
            proyecto: d.name,
            sesion: e.name,
            lateral: true,
            subId: a.replace(/\.jsonl$/, ''),
          });
        }
      }
    }
  }
  const conMtime = [];
  for (const t of salida) {
    let st;
    try { st = fs.statSync(t.ruta); } catch { continue; }
    if (st.mtimeMs < limite) continue;   // transcript viejo: ni lo toco
    t.mtime = st.mtimeMs;
    t.tamano = st.size;
    conMtime.push(t);
  }
  conMtime.sort((a, b) => b.mtime - a.mtime);
  return conMtime;
}

function lineaVacia(o) {
  return {
    sesionId: null, cwd: null, gitBranch: null, version: null,
    titulo: null, lateral: false, modelo: null,
    tokens: { entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0 },
    mensajes: 0, tool: null, toolPendiente: null, ultimo: null, primero: null,
  };
}

// Lee un tramo del transcript y saca sólo metadatos: cuenta mensajes, suma
// tokens, mira el nombre de la última tool. El texto de los prompts y el
// output de las tools no se tocan.
function leerLinea(linea, ficha) {
  if (!linea || !linea.trim()) return;

  const completa = linea.includes('"usage"') || linea.includes('"tool_use"') || linea.includes('"tool_result"')
    || linea.includes('"custom-title"') || linea.includes('"isSidechain":true')
    || (!ficha.sesionId && linea.includes('"cwd"'));
  if (!completa) return;

  let ev = null;
  try {
    ev = JSON.parse(linea);
  } catch {
    return;
  }

  if (!ficha.sesionId) {
    ficha.sesionId = ev.sessionId || null;
    ficha.cwd = (ev.cwd && typeof ev.cwd === 'string') ? ev.cwd : null;
    ficha.gitBranch = ev.gitBranch || null;
    ficha.version = ev.version || null;
  }
  if (ev.type === 'custom-title' && ev.customTitle) {
    ficha.titulo = redactar(ev.customTitle);
    return;
  }
  if (ev.isSidechain === true) ficha.lateral = true;
  if (ev.timestamp) {
    const t = Date.parse(ev.timestamp);
    if (Number.isFinite(t)) {
      if (!ficha.primero || t < ficha.primero) ficha.primero = t;
      if (!ficha.ultimo || t > ficha.ultimo) ficha.ultimo = t;
    }
  }

  const msg = ev.message;
  if (!msg || typeof msg !== 'object') return;

  if (msg.model && !ficha.modelo) ficha.modelo = redactar(msg.model);

  const uso = msg.usage;
  if (uso && typeof uso === 'object') {
    ficha.tokens.entrada += Number(uso.input_tokens) || 0;
    ficha.tokens.salida += Number(uso.output_tokens) || 0;
    ficha.tokens.cacheLectura += Number(uso.cache_read_input_tokens) || 0;
    ficha.tokens.cacheEscritura += Number(uso.cache_creation_input_tokens) || 0;
  }

  const contenido = Array.isArray(msg.content) ? msg.content : null;
  if (!contenido) return;

  for (const bloque of contenido) {
    if (!bloque || typeof bloque !== 'object') continue;
    if (bloque.type === 'tool_use') {
      ficha.tool = { nombre: redactar(bloque.name) || 'tool', estado: 'running' };
      ficha.toolPendiente = bloque.id || null;
    } else if (bloque.type === 'tool_result') {
      if (!ficha.tool || (bloque.tool_use_id && ficha.toolPendiente !== bloque.tool_use_id)) {
        ficha.tool = { nombre: ficha.tool ? ficha.tool.nombre : 'tool', estado: bloque.is_error ? 'error' : 'completed' };
      } else {
        ficha.tool.estado = bloque.is_error ? 'error' : 'completed';
      }
      ficha.toolPendiente = null;
    }
  }
}

function contarMensajes(linea) {
  if (linea.includes('"role":"assistant"')) return 1;
  if (linea.includes('"role":"user"')) return 1;
  return 0;
}

function leerTranscript(ruta, desde) {
  // desde = byte en el que dejamos de leer la última vez
  let st;
  try {
    st = fs.statSync(ruta);
  } catch {
    return null;
  }
  let fd;
  try {
    fd = fs.openSync(ruta, 'r');
  } catch {
    return null;
  }
  const trozos = [];
  let leidos = 0;
  try {
    const tamano = Math.max(0, st.size - desde);
    if (tamano > 0) {
      const buf = Buffer.alloc(tamano);
      leidos = fs.readSync(fd, buf, 0, tamano, desde);
      trozos.push(buf.subarray(0, leidos));
    }
  } catch {
    leidos = 0;
  } finally {
    fs.closeSync(fd);
  }
  if (!leidos) return { texto: '', leidos: 0, total: st.size };
  return { texto: Buffer.concat(trozos).toString('utf8'), leidos, total: st.size };
}

function sesionesClaude() {
  podar(cacheClaude);
  const raiz = raizClaude();
  if (!fs.existsSync(raiz)) {
    return { ok: false, aviso: 'no está la carpeta de transcripts de Claude Code en esta máquina. Sigo con opencode y los eventos.', codigo: 'sinTranscripts', sesiones: [] };
  }
  const conf = permisos();
  const lista = listarTranscripts(raiz, conf.dias);
  const porId = new Map();

  for (const t of lista.slice(0, TOP_CLAUDE)) {
    const previo = cacheClaude.get(t.ruta);
    let texto = '';
    let leidos = 0;
    if (previo && previo.tamano <= t.tamano) {
      const trozo = leerTranscript(t.ruta, previo.tamano);
      texto = trozo ? trozo.texto : '';
      leidos = previo.tamano;
    } else {
      const trozo = leerTranscript(t.ruta, 0);
      texto = trozo ? trozo.texto : '';
      leidos = 0;
    }

    const ficha = previo && previo.tamano <= t.tamano
      ? { ...previo.ficha, tokens: { ...previo.ficha.tokens } }
      : lineaVacia();

    const lineas = texto.split('\n');
    for (const linea of lineas) {
      if (!linea.trim()) continue;
      ficha.mensajes += contarMensajes(linea);
      leerLinea(linea, ficha);
    }

    const nuevo = {
      ficha,
      tamano: t.tamano,
      mtime: t.mtime,
      lateral: t.lateral,
      padre: t.lateral ? t.sesion : null,
      subId: t.subId || null,
      proyecto: t.proyecto,
    };
    cacheClaude.set(t.ruta, nuevo);

    if (!ficha.cwd || !permitido(ficha.cwd)) continue;
    if (!ficha.sesionId) continue;

    const id = `claude:${ficha.sesionId}${t.lateral ? `:${t.subId}` : ''}`;
    const proyecto = permisosModulo.proyectoDe(ficha.cwd);
    const sesion = {
      id,
      ide: 'claude',
      titulo: ficha.titulo || (t.lateral ? `subagente ${t.subId}` : `sesión ${ficha.sesionId.slice(0, 8)}`),
      proyecto: proyecto.proyecto,
      proyectoId: proyecto.proyectoId,
      proyectoCorto: proyecto.proyecto,
      agente: t.lateral ? 'subagente' : 'claude',
      modelo: ficha.modelo,
      provider: 'anthropic',
      padre: t.lateral ? `claude:${t.sesion}` : null,
      lateral: Boolean(t.lateral),
      estado: 'activo',
      inicio: ficha.primero,
      fin: null,
      ultimaActividad: ficha.ultimo,
      duracion: ficha.primero && ficha.ultimo ? Math.max(0, ficha.ultimo - ficha.primero) : null,
      tokens: {
        entrada: ficha.tokens.entrada,
        salida: ficha.tokens.salida,
        razonamiento: 0,
        cacheLectura: ficha.tokens.cacheLectura,
        cacheEscritura: ficha.tokens.cacheEscritura,
      },
      costo: 0,
      tool: ficha.tool,
      toolBytes: null,
      diff: null,
      mensajes: ficha.mensajes,
      checklist: null,
      subagentes: [],
      rama: ficha.gitBranch,
    };

    // la misma sesión puede aparecer en dos carpetas de proyecto: gana la
    // que se movió más tarde
    const previa = porId.get(id);
    if (!previa || (sesion.ultimaActividad || 0) > (previa.ultimaActividad || 0)) porId.set(id, sesion);
  }

  const hoy = [...porId.values()];

  // los subagentes cuelgan de su sesión
  const porPadre = new Map(hoy.map((s) => [s.id, s]));
  for (const s of hoy) {
    if (!s.padre) continue;
    const padre = porPadre.get(s.padre);
    if (!padre) continue;
    padre.subagentes.push({
      id: s.id,
      titulo: s.titulo,
      estado: s.estado,
      agente: s.agente,
      modelo: s.modelo,
      tool: s.tool,
      ultimaActividad: s.ultimaActividad,
      tokens: s.tokens,
      checklist: s.checklist,
    });
  }

  return { ok: true, aviso: null, sesiones: hoy };
}

module.exports = { sesionesOpencode, sesionesClaude, permitido, redactar, permisos, podar };
