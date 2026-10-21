// eventos.js — el formato que comparten el kraken, el plugin de opencode, el
// hook de Claude Code y el Ralph Loop. Una línea JSON por evento y append-only:
// varios procesos escriben a la vez sin pisarse.
//
// El payload es mínimo a propósito: metadatos y nada más. Nunca el prompt,
// nunca el cuerpo de un mensaje, nunca el contenido de un archivo del repo
// (ahí puede haber secretos del proyecto del usuario).

const fs = require('fs');
const path = require('path');
const rutas = require('./rutas.js');

const ARCHIVO = 'events.jsonl';
const TAMANO_MAX = 5 * 1024 * 1024;
const COPIAS = 3;

// El estado vive en la carpeta del SO: el panel sirve para cualquier proyecto
// de la máquina y el JSONL nunca está en un repo que se pueda subir a un nube.
function directorioEstado() {
  return rutas.estado();
}

function archivoEventos() {
  return path.join(directorioEstado(), ARCHIVO);
}

// El número de línea se cuenta sobre el archivo, no con un contador en disco:
// entre dos procesos puede quedar repetido, pero el kraken ordena por el orden
// del archivo, así que no molesta.
let cuenta = { archivo: null, bytes: 0, lineas: 0 };

function lineasEscritas(archivo) {
  let st;
  try { st = fs.statSync(archivo); } catch { return 0; }
  if (cuenta.archivo !== archivo || st.size < cuenta.bytes) cuenta = { archivo, bytes: 0, lineas: 0 };
  if (st.size === cuenta.bytes) return cuenta.lineas;
  const fd = fs.openSync(archivo, 'r');
  try {
    const cola = Buffer.alloc(st.size - cuenta.bytes);
    fs.readSync(fd, cola, 0, cola.length, cuenta.bytes);
    cuenta.lineas += cola.toString('utf8').split('\n').length - 1;
    cuenta.bytes = st.size;
  } finally {
    fs.closeSync(fd);
  }
  return cuenta.lineas;
}

const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const texto = (v) => (typeof v === 'string' && v !== '' ? v : null);

// Cuando el JSONL llega a 5 MB se rota: quedan tres copias y el archivo
// arranca de cero. El servidor detecta el cambio de archivo y resetea el
// offset, así que no lee basura del que se fue.
function rotar(archivo) {
  let st;
  try { st = fs.statSync(archivo); } catch { return false; }
  if (st.size < TAMANO_MAX) return false;
  try { fs.rmSync(`${archivo}.${COPIAS}`, { force: true }); } catch { /* no había */ }
  for (let i = COPIAS - 1; i >= 1; i--) {
    try { fs.renameSync(`${archivo}.${i}`, `${archivo}.${i + 1}`); } catch { /* no había */ }
  }
  try { fs.renameSync(archivo, `${archivo}.1`); } catch { /* alguien lo movió */ }
  return true;
}

function escribirEvento(ev) {
  const dir = directorioEstado();
  // el directorio del estado y el archivo quedan sólo para el usuario de la
  // máquina: en Windows el modo es un aviso, pero en Unix manda.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const archivo = path.join(dir, ARCHIVO);
  rotar(archivo);
  const registro = {
    v: 1,
    seq: lineasEscritas(archivo) + 1,
    ts: new Date().toISOString(),
    kind: ev.kind,
    sid: texto(ev.sid),
    src: texto(ev.src),
    title: texto(ev.title),
    tool: texto(ev.tool),
    step: numero(ev.step),
    total: numero(ev.total),
    project: texto(ev.project),
  };
  fs.appendFileSync(archivo, JSON.stringify(registro) + '\n', { encoding: 'utf8', mode: 0o600 });
  return registro;
}

// El % del plan sale de un denominador real: los checkboxes del archivo de
// tareas. Sin denominator la barra del kraken es de actividad, no un número
// inventado.
function contarChecks(archivo) {
  let contenido = '';
  try { contenido = fs.readFileSync(archivo, 'utf8'); } catch { return { hechos: 0, total: 0 }; }
  const todos = contenido.match(/^[ \t]*[-*][ \t]*\[[ xX]\]/gm) || [];
  const hechos = contenido.match(/^[ \t]*[-*][ \t]*\[[xX]\]/gm) || [];
  return { hechos: hechos.length, total: todos.length };
}

// Nombre corto de la sesión: el origen y las últimas letras del id. Es el
// plan B, para cuando no hay un nombre más legible.
function tituloCorto(src, sid) {
  const base = src || 'ses';
  const cola = typeof sid === 'string' ? sid.slice(-4) : '';
  return cola ? `${base}-${cola}` : base;
}

// El nombre real de la pestaña. En opencode sale del primer mensaje del
// usuario, así que va recortado y con los espacios aplastados: alcanza para
// reconocer la pestaña y no para leer el prompt entero. Se apaga con
// KRAKEN_TITULOS=0.
function titulosPermitidos() {
  const v = process.env.KRAKEN_TITULOS;
  return !(v === '0' || v === 'false' || v === 'no');
}

function tituloSesion(valor) {
  if (!titulosPermitidos()) return null;
  const t = typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '';
  if (!t) return null;
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
}

module.exports = {
  directorioEstado,
  archivoEventos,
  escribirEvento,
  contarChecks,
  tituloCorto,
  tituloSesion,
  titulosPermitidos,
  ARCHIVO,
  TAMANO_MAX,
  COPIAS,
};

