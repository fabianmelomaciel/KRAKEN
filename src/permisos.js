// permisos.js — la frontera: qué se puede leer y con qué token se entra.
//
// Tres cosas viven acá: la allowlist de carpetas, el token de 128 bits y el
// nombre corto de cada proyecto. El snapshot nunca lleva paths absolutos:
// sale el basename y un hash corto del path, que sirve para agrupar sin
// contar en qué Carpeta vive el usuario.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rutas = require('./rutas.js');

const DIAS_POR_DEFECTO = 30;

function archivoConfig() {
  return path.join(rutas.config(), 'permisos.json');
}

function archivoToken() {
  return path.join(rutas.estado(), 'token');
}

// Sin archivo de configuración el kraken entra en modo automático: se ven los
// proyectos que los propios IDEs ya conocen, y nada más. Con archivo, el
// modo es restringido: "raices": [] deniega todo, y con raíces, sólo esas.
//
// El archivo se cachea por mtime y tamaño: se lo relee sólo cuando cambia,
// para no leerlo una vez por sesión y por tick. El tamaño va con el mtime
// porque dos escrituras en el mismo milisegundo comparten mtime: con sólo
// el mtime, el kraken se podía quedar con la allowlist vieja.
let cacheConfig = null;

function config() {
  const archivo = archivoConfig();
  let mtime = 0;
  let tamano = -1;
  try {
    const st = fs.statSync(archivo);
    mtime = st.mtimeMs;
    tamano = st.size;
  } catch {
    mtime = 0;
    tamano = -1;
  }
  if (cacheConfig && cacheConfig.mtime === mtime && cacheConfig.tamano === tamano) return cacheConfig.valor;
  let crudo = null;
  try {
    crudo = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch {
    crudo = null;
  }
  let valor;
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) {
    valor = { raices: null, modo: 'auto', dias: DIAS_POR_DEFECTO, nivel: 'metadata' };
  } else {
    const raices = Array.isArray(crudo.raices)
      ? crudo.raices.filter((r) => typeof r === 'string' && r.trim())
      : [];
    valor = {
      raices,
      modo: 'restringido',
      dias: Number.isFinite(crudo.dias) ? crudo.dias : DIAS_POR_DEFECTO,
      nivel: typeof crudo.nivel === 'string' ? crudo.nivel : 'metadata',
    };
  }
  cacheConfig = { mtime, tamano, valor };
  return valor;
}


function normalizar(ruta) {
  return String(ruta || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function permitido(ruta) {
  if (!ruta) return false;
  const { raices } = config();
  // Modo automático: lo que el IDE trae es, por definición, un proyecto del
  // usuario. El filtro fino lo hace el archivo de configuración.
  if (raices === null) return true;
  const n = normalizar(ruta);
  return raices.some((raiz) => {
    const r = normalizar(raiz);
    if (!r) return false;
    return n === r || n.startsWith(`${r}/`);
  });
}

// El nombre del proyecto es el último pedazo del path y un hash de 8
// caracteres: dos sesiones del mismo proyecto comparten id, dos proyectos
// con el mismo nombre no se mezclan.
function proyectoDe(ruta) {
  if (!ruta) return { proyecto: null, proyectoId: null };
  const partes = String(ruta).split(/[\\/]/).filter(Boolean);
  const proyecto = partes.length ? partes[partes.length - 1] : null;
  const proyectoId = crypto.createHash('sha1').update(normalizar(ruta)).digest('hex').slice(0, 8);
  return { proyecto, proyectoId };
}

// 128 bits en hex. El archivo sale con 0600: en Unix es de solo el usuario,
// en Windows el modo no aplica pero el folder del estado tampoco lo comparte.
function token() {
  const archivo = archivoToken();
  try {
    const guardado = fs.readFileSync(archivo, 'utf8').trim();
    if (/^[0-9a-f]{32}$/.test(guardado)) return guardado;
  } catch {
    // no está: lo creamos
  }
  const nuevo = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.dirname(archivo), { recursive: true, mode: 0o700 });
  fs.writeFileSync(archivo, `${nuevo}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(archivo, 0o600); } catch { /* en Windows no aplica */ }
  return nuevo;
}

function tokenValido(candidato) {
  if (typeof candidato !== 'string' || candidato.length !== 32) return false;
  return /^[0-9a-f]{32}$/.test(candidato);
}

// La comparación del token es en tiempo constante: que el 401 tarde lo mismo
// que el 200 no le regala nada a quien está adivinando.
function mismoToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  config,
  permitido,
  proyectoDe,
  token,
  tokenValido,
  mismoToken,
  archivoConfig,
  archivoToken,
  normalizar,
};
