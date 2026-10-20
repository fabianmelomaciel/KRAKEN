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

// Sin archivo de configuración la allowlist es el home del usuario: es lo
// mínimo razonable para una herramienta de la máquina. Un archivo con
// "raices": [] es explícito y deniega todo.
function config() {
  let crudo = null;
  try {
    crudo = JSON.parse(fs.readFileSync(archivoConfig(), 'utf8'));
  } catch {
    crudo = null;
  }
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) {
    return { raices: [rutas.home()], dias: DIAS_POR_DEFECTO, nivel: 'metadata' };
  }
  const raices = Array.isArray(crudo.raices)
    ? crudo.raices.filter((r) => typeof r === 'string' && r.trim())
    : [];
  return {
    raices,
    dias: Number.isFinite(crudo.dias) ? crudo.dias : DIAS_POR_DEFECTO,
    nivel: typeof crudo.nivel === 'string' ? crudo.nivel : 'metadata',
  };
}

function normalizar(ruta) {
  return String(ruta || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function permitido(ruta) {
  if (!ruta) return false;
  const n = normalizar(ruta);
  return config().raices.some((raiz) => {
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

module.exports = {
  config,
  permitido,
  proyectoDe,
  token,
  tokenValido,
  archivoConfig,
  archivoToken,
  normalizar,
};
