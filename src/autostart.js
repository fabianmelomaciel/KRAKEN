// autostart.js — que el visor arranque solo al iniciar sesión, en los tres
// sistemas. Siempre con --no-browser: abrir una pestaña en cada login es
// una molestia, y en una máquina compartida es un problema.

const fs = require('fs');
const os = require('os');
const path = require('path');

const VISOR_JS = path.resolve(__dirname, '..', 'bin', 'visor.js');
const ETIQUETA = 'io.visor-ia';

function carpetaInicio() {
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function archivoWindows() {
  return path.join(carpetaInicio(), 'VisorIA.cmd');
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

function cmdWindows() {
  return [
    '@echo off',
    `start "" /min "${process.execPath}" "${VISOR_JS}" serve --no-browser`,
    '',
  ].join('\r\n');
}

function plistMac() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${ETIQUETA}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${VISOR_JS}</string>
    <string>serve</string>
    <string>--no-browser</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

function unidadLinux() {
  return `[Unit]
Description=Visor IA

[Service]
ExecStart=${process.execPath} ${VISOR_JS} serve --no-browser
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

function instalar() {
  const destino = archivo();
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  if (process.platform === 'win32') fs.writeFileSync(destino, cmdWindows(), 'utf8');
  else if (process.platform === 'darwin') fs.writeFileSync(destino, plistMac(), 'utf8');
  else fs.writeFileSync(destino, unidadLinux(), 'utf8');
  return destino;
}

function desinstalar() {
  const destino = archivo();
  const estaba = fs.existsSync(destino);
  try { fs.rmSync(destino, { force: true }); } catch { /* no estaba o no se puede borrar */ }
  return { destino, estaba };
}

function instalado() {
  return fs.existsSync(archivo());
}

module.exports = { instalar, desinstalar, instalado, archivo, ETIQUETA };
