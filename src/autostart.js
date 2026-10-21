// autostart.js — que el kraken arranque solo al iniciar sesión, en los tres
// sistemas. Sin navegador por defecto: abrir una pestaña en cada login es
// una molestia, y en una máquina compartida es un problema. Con
// --con-navegador sí se abre.
//
// Instalar no es sólo escribir el archivo: en macOS y Linux hay que ACTIVAR
// el servicio (launchctl bootstrap, systemctl --user enable --now). Si el
// comando del sistema falla, se avisa por consola y se sigue: el archivo
// quedó escrito y el humano puede activarlo a mano.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const KRAKEN_JS = path.resolve(__dirname, '..', 'bin', 'kraken.js');
const ETIQUETA = 'io.kraken';

// El mismo puerto que usa el servidor.
function puertoPorDefecto() {
  return require('./servidor.js').PUERTO_POR_DEFECTO;
}

function carpetaInicio() {
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function archivoWindows() {
  return path.join(carpetaInicio(), 'Kraken.cmd');
}

function archivoMac() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${ETIQUETA}.plist`);
}

function archivoLinux() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'systemd', 'user', `${ETIQUETA}.service`);
}

function archivo() {
  if (process.platform === 'win32') return archivoWindows();
  if (process.platform === 'darwin') return archivoMac();
  return archivoLinux();
}

// --- los archivos que deja el sistema operativo ----------------------------

// En Windows la carpeta Startup no muestra nada: si el arranque falla tiene
// que quedar escrito en un archivo, o el error se lo come la carpeta.
function cmdWindows({ navegador }) {
  const puerto = puertoPorDefecto();
  const estado = require('./rutas.js').estado();
  const lineas = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    `set "KRAKEN_DIR=${estado}"`,
    'set "KRAKEN_LOG=%KRAKEN_DIR%\\autostart.log"',
    'if not exist "%KRAKEN_DIR%" mkdir "%KRAKEN_DIR%"',
    'echo [%DATE% %TIME%] kraken arranca >> "%KRAKEN_LOG%"',
    `start "" /min "${process.execPath}" "${KRAKEN_JS}" serve --port ${puerto} --no-browser >> "%KRAKEN_LOG%" 2>&1`,
  ];
  if (navegador) {
    // el panel se abre sólo cuando el servidor ya está escuchando
    lineas.push(
      'ping -n 4 127.0.0.1 >nul',
      `start "" /min "${process.execPath}" "${KRAKEN_JS}" open >> "%KRAKEN_LOG%" 2>&1`,
    );
  }
  lineas.push('endlocal', '');
  return lineas.join('\r\n');
}

// KeepAlive por fallo: si el proceso se cae, launchd lo vuelve a levantar. Si
// termina bien, no lo hace. ThrottleInterval frena los reintentos.
function plistMac({ navegador }) {
  const puerto = puertoPorDefecto();
  const argumentos = [
    `    <string>${process.execPath}</string>`,
    `    <string>${KRAKEN_JS}</string>`,
    '    <string>serve</string>',
    '    <string>--port</string>',
    `    <string>${puerto}</string>`,
  ];
  if (!navegador) argumentos.push('    <string>--no-browser</string>');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${ETIQUETA}</string>
  <key>ProgramArguments</key>
  <array>
${argumentos.join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

// Restart=on-failure y RestartSec=5: si se cae, vuelve a los cinco segundos.
function unidadLinux({ navegador }) {
  const puerto = puertoPorDefecto();
  const flags = navegador ? '' : ' --no-browser';
  return `[Unit]
Description=Kraken

[Service]
ExecStart="${process.execPath}" "${KRAKEN_JS}" serve --port ${puerto}${flags}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

// --- los comandos del sistema operativo ------------------------------------

// Un comando del sistema puede fallar (permisos, systemd que no está): se
// avisa por consola y se sigue, porque el archivo ya quedó escrito.
function correr(comando, args) {
  try {
    const r = spawnSync(comando, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.error) return { ok: false, motivo: r.error.message };
    if (r.status !== 0) {
      const lineas = String(r.stderr || '').trim().split('\n').filter(Boolean);
      return { ok: false, motivo: lineas[lineas.length - 1] || `código ${r.status}` };
    }
    return { ok: true, motivo: null };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}

function objetivoMac() {
  return `gui/${typeof process.getuid === 'function' ? process.getuid() : 0}/${ETIQUETA}`;
}

function activarMac(destino) {
  // si ya estaba cargado, se saca primero: el archivo nuevo no entra si no
  correr('launchctl', ['bootout', objetivoMac()]);
  const r = correr('launchctl', ['bootstrap', `gui/${typeof process.getuid === 'function' ? process.getuid() : 0}`, destino]);
  if (!r.ok) {
    console.warn(`kraken: no pude activar el LaunchAgent (${r.motivo}). A mano: launchctl bootstrap ${objetivoMac()} "${destino}"`);
  }
  return r.ok;
}

function desactivarMac() {
  return correr('launchctl', ['bootout', objetivoMac()]).ok;
}

function activarLinux() {
  const unidad = `${ETIQUETA}.service`;
  const recarga = correr('systemctl', ['--user', 'daemon-reload']);
  const activa = correr('systemctl', ['--user', 'enable', '--now', unidad]);
  if (!recarga.ok || !activa.ok) {
    console.warn(`kraken: no pude activar la unidad de systemd (${recarga.motivo || activa.motivo}). A mano: systemctl --user enable --now ${unidad}`);
  }
  return recarga.ok && activa.ok;
}

function desactivarLinux() {
  const unidad = `${ETIQUETA}.service`;
  const r = correr('systemctl', ['--user', 'disable', '--now', unidad]);
  if (r.ok) return true;
  return correr('systemctl', ['--user', 'disable', unidad]).ok;
}

// ¿Está activo de verdad en este SO? En Windows la carpeta Startup es la
// activación: si el archivo está, arranca en el próximo login.
function activo() {
  if (!fs.existsSync(archivo())) return false;
  if (process.platform === 'win32') return true;
  if (process.platform === 'darwin') return correr('launchctl', ['print', objetivoMac()]).ok;
  return correr('systemctl', ['--user', 'is-active', `${ETIQUETA}.service`]).ok;
}

// --- instalar y desinstalar ------------------------------------------------

function instalar({ navegador } = {}) {
  const destino = archivo();
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  if (process.platform === 'win32') fs.writeFileSync(destino, cmdWindows({ navegador }), 'utf8');
  else if (process.platform === 'darwin') fs.writeFileSync(destino, plistMac({ navegador }), 'utf8');
  else fs.writeFileSync(destino, unidadLinux({ navegador }), 'utf8');
  // el archivo solo no alcanza: en macOS y Linux hay que activar el servicio
  if (process.platform === 'darwin') activarMac(destino);
  else if (process.platform !== 'win32') activarLinux();
  return destino;
}

function desinstalar() {
  const destino = archivo();
  const estaba = fs.existsSync(destino);
  if (process.platform === 'darwin') desactivarMac();
  else if (process.platform !== 'win32') desactivarLinux();
  try { fs.rmSync(destino, { force: true }); } catch { /* no estaba o no se puede borrar */ }
  return { destino, estaba };
}

function instalado() {
  return fs.existsSync(archivo());
}

function estado() {
  const destino = archivo();
  const puesto = fs.existsSync(destino);
  let andando = false;
  if (puesto) {
    try { andando = activo(); } catch { andando = false; }
  }
  return { destino, instalado: puesto, activo: andando };
}

module.exports = {
  instalar, desinstalar, instalado, activo, estado, archivo, ETIQUETA,
};
