// instalar.js — deja (y saca) la instrumentación de los IDEs.
//
// Son dos cosas opt-in: el plugin de opencode y los hooks de Claude Code.
// Sin esto el visor sigue funcionando: lee las bases y los transcripts, pero
// no sabe cuándo terminó una sesión y dice "sin actividad hace Xm".

const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PLUGIN_FUENTE = path.join(__dirname, 'ide', 'opencode-plugin.mjs');
const EVENTOS_FUENTE = path.join(__dirname, 'eventos.js');
const HOOK_FUENTE = path.join(__dirname, 'ide', 'claude-hook.js');

const EVENTOS_HOOK = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop'];
const MARCA_HOOK = 'claude-hook.js';

function log(ok, texto) {
  console.log(`${ok ? 'ok  ' : 'skip'}  ${texto}`);
}

// El directorio global de opencode: el de la doc es ~/.config/opencode y en
// Windows también puede estar en %APPDATA%. Se usa el que ya existe.
function dirOpencode() {
  if (process.env.VISOR_OPENCODE_DIR) return process.env.VISOR_OPENCODE_DIR;
  const candidatas = [];
  if (process.env.XDG_CONFIG_HOME) candidatas.push(path.join(process.env.XDG_CONFIG_HOME, 'opencode'));
  candidatas.push(path.join(os.homedir(), '.config', 'opencode'));
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidatas.push(path.join(process.env.APPDATA, 'opencode'));
  }
  for (const c of candidatas) {
    try { if (fs.existsSync(c)) return c; } catch { /* siguiente */ }
  }
  return candidatas[0];
}

function archivoClaude() {
  if (process.env.VISOR_CLAUDE_SETTINGS) return process.env.VISOR_CLAUDE_SETTINGS;
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function destinoPlugin() {
  return path.join(dirOpencode(), 'plugins');
}

function instalarPlugin(dryRun) {
  if (!fs.existsSync(PLUGIN_FUENTE)) {
    log(false, `no está ${PLUGIN_FUENTE}`);
    return;
  }
  const dir = destinoPlugin();
  const plugin = path.join(dir, 'visor-feed.js');
  const eventos = path.join(dir, 'visor-eventos.js');
  if (dryRun) {
    log(true, `plugin de opencode -> ${plugin}`);
    log(true, `módulo de eventos -> ${eventos}`);
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(PLUGIN_FUENTE, plugin);
  // el plugin lo busca al lado con este nombre
  fs.copyFileSync(EVENTOS_FUENTE, eventos);
  log(true, `plugin de opencode -> ${plugin}`);
  log(true, `módulo de eventos -> ${eventos}`);
}

function mergearHooks(config) {
  const comando = `node "${HOOK_FUENTE.replace(/\\/g, '/')}"`;
  if (!config.hooks || typeof config.hooks !== 'object') config.hooks = {};

  for (const evento of EVENTOS_HOOK) {
    const lista = Array.isArray(config.hooks[evento]) ? config.hooks[evento] : [];
    const yaEsta = lista.some((entrada) => {
      const hooks = Array.isArray(entrada && entrada.hooks) ? entrada.hooks : [];
      return hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(MARCA_HOOK));
    });
    if (yaEsta) {
      log(true, `hook ${evento}: ya estaba`);
      continue;
    }
    lista.push({ hooks: [{ type: 'command', command: comando }] });
    config.hooks[evento] = lista;
    log(true, `hook ${evento}: agregado`);
  }
  return config;
}

function instalarHooks(dryRun) {
  const archivo = archivoClaude();
  let texto = '';
  let existe = false;
  try { texto = fs.readFileSync(archivo, 'utf8'); existe = true; } catch { texto = '{}'; }

  let config;
  try { config = JSON.parse(texto); } catch { config = {}; }
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};

  const antes = JSON.stringify(config, null, 2);
  mergearHooks(config);
  const despues = JSON.stringify(config, null, 2);
  if (antes === despues) {
    log(true, `settings de Claude Code: sin cambios (${archivo})`);
    return;
  }
  if (dryRun) {
    log(true, `settings de Claude Code -> ${archivo} (se escribiría)`);
    return;
  }
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  if (existe) fs.copyFileSync(archivo, `${archivo}.bak`);
  fs.writeFileSync(archivo, `${despues}\n`, 'utf8');
  log(true, `settings de Claude Code -> ${archivo}${existe ? ' (backup en .bak)' : ''}`);
}

function desinstalarPlugin() {
  const dir = destinoPlugin();
  for (const nombre of ['visor-feed.js', 'visor-eventos.js']) {
    const p = path.join(dir, nombre);
    if (!fs.existsSync(p)) continue;
    try { fs.rmSync(p, { force: true }); log(true, `sacado ${p}`); } catch { log(false, `no pude sacar ${p}`); }
  }
}

// Si hay un .bak se restaura tal cual: es lo que el usuario tenía antes de
// que el visor metiera la mano. Si no hay, se sacan sólo nuestras entradas.
function desinstalarHooks() {
  const archivo = archivoClaude();
  const bak = `${archivo}.bak`;
  if (fs.existsSync(bak)) {
    try {
      fs.copyFileSync(bak, archivo);
      fs.rmSync(bak, { force: true });
      log(true, `settings de Claude Code restaurado desde el .bak`);
      return;
    } catch { /* seguimos con la limpieza manual */ }
  }
  if (!fs.existsSync(archivo)) {
    log(true, 'no había settings de Claude Code');
    return;
  }
  let config;
  try { config = JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { config = null; }
  if (!config || typeof config !== 'object' || !config.hooks) {
    log(true, 'no había hooks del visor');
    return;
  }
  for (const evento of Object.keys(config.hooks)) {
    const lista = config.hooks[evento];
    if (!Array.isArray(lista)) continue;
    const limpio = lista.filter((entrada) => {
      const hooks = Array.isArray(entrada && entrada.hooks) ? entrada.hooks : [];
      return !hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(MARCA_HOOK));
    });
    if (limpio.length !== lista.length) log(true, `hook ${evento}: sacado`);
    config.hooks[evento] = limpio;
  }
  fs.writeFileSync(archivo, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function desinstalar({ keepState } = {}) {
  console.log('desinstalando el visor\n');
  desinstalarPlugin();
  desinstalarHooks();

  const autostart = require('./autostart.js');
  const r = autostart.desinstalar();
  log(r.estaba, `autostart: ${r.destino}`);

  if (!keepState) {
    const rutas = require('./rutas.js');
    const dir = rutas.estado();
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        log(true, `estado borrado: ${dir}`);
      } catch {
        log(false, `no pude borrar el estado: ${dir}`);
      }
    } else {
      log(true, 'no había estado que borrar');
    }
  } else {
    log(true, 'el estado se deja donde está');
  }
}

function instalar({ dryRun } = {}) {
  console.log('instalando el visor en los IDEs\n');
  instalarPlugin(dryRun);
  console.log('');
  instalarHooks(dryRun);
  console.log('\nlisto. el panel se levanta con: visor serve');
}

module.exports = { instalar, desinstalar, dirOpencode, archivoClaude, destinoPlugin };
