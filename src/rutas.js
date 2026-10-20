// rutas.js — dónde vive cada cosa según el SO. El estado nunca cae en
// Documents, Desktop, Dropbox ni iCloud: esas carpetas se sincronizan y el
// token de 128 bits no viaja a la nube.

const os = require('os');
const path = require('path');

function home() {
  return os.homedir();
}

// El estado del visor: la base del token, el JSONL de eventos y el pidfile.
function estado() {
  const override = process.env.VISOR_ESTADO_DIR;
  if (override) return path.resolve(override);
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home(), 'AppData', 'Local');
    return path.join(local, 'VisorIA');
  }
  if (process.platform === 'darwin') {
    return path.join(home(), 'Library', 'Application Support', 'VisorIA');
  }
  const xdg = process.env.XDG_STATE_HOME;
  if (xdg) return path.join(xdg, 'visor-ia');
  return path.join(home(), '.local', 'state', 'visor-ia');
}

// La configuración del usuario: la allowlist y los días de historial.
function config() {
  const override = process.env.VISOR_CONFIG_DIR;
  if (override) return path.resolve(override);
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home(), 'AppData', 'Roaming');
    return path.join(appdata, 'VisorIA');
  }
  if (process.platform === 'darwin') {
    return path.join(home(), 'Library', 'Application Support', 'VisorIA');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, 'visor-ia');
  return path.join(home(), '.config', 'visor-ia');
}

// Los datos de los IDEs: no son nuestros, los leemos donde ya están.
function datos() {
  return process.env.VISOR_OPENCODE_DIR
    || path.join(home(), '.local', 'share', 'opencode');
}

function baseOpencode() {
  return path.join(datos(), 'opencode.db');
}

function proyectosClaude() {
  return process.env.VISOR_CLAUDE_DIR
    || path.join(home(), '.claude', 'projects');
}

module.exports = { home, estado, config, datos, baseOpencode, proyectosClaude };
