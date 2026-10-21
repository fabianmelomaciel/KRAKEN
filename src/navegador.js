// navegador.js — abrir el panel en el navegador del sistema.
//
// La URL se valida antes de tocar nada: sólo se abre una del panel
// (localhost o 127.0.0.1, puerto numérico) y nunca hay un carácter de
// control ni un "&" que se pueda colar.
//
// En Windows no se usa "cmd /c start": "start" es un builtin de cmd, así que
// la URL terminaría pasando por un intérprete de comandos. Se usa rundll32
// con el FileProtocolHandler del protocolo http, que abre el navegador por
// defecto sin shell.

const { spawn } = require('child_process');

const URL_PANEL = /^http:\/\/(?:localhost|127\.0\.0\.1):(\d{1,5})(\/[^\s]*)?$/;

function urlValida(url) {
  if (typeof url !== 'string' || url === '') return false;
  if (/[\u0000-\u001F\u007F]/.test(url)) return false;
  if (url.includes('&')) return false;
  const m = URL_PANEL.exec(url);
  if (!m) return false;
  const puerto = Number(m[1]);
  return puerto >= 1 && puerto <= 65535;
}

// En Linux sin display no hay navegador: el humano lee la URL que queda
// impresa y la abre cuando quiere.
function sinDisplay() {
  return process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
}

function comandoDeApertura(url) {
  if (process.platform === 'win32') {
    return { bin: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  }
  if (process.platform === 'darwin') {
    return { bin: 'open', args: [url] };
  }
  return { bin: 'xdg-open', args: [url] };
}

// Devuelve { abierto, motivo, url }. Nunca tira: si no hay navegador, dice
// por qué y el que llama decide qué hacer.
function abrir(url) {
  return new Promise((resolve) => {
    if (!urlValida(url)) {
      resolve({ abierto: false, motivo: 'la URL no es del panel', url });
      return;
    }
    if (sinDisplay()) {
      resolve({ abierto: false, motivo: 'no hay display', url });
      return;
    }
    const { bin, args } = comandoDeApertura(url);
    let hijo;
    try {
      hijo = spawn(bin, args, { detached: true, stdio: 'ignore' });
    } catch (e) {
      resolve({ abierto: false, motivo: e.message, url });
      return;
    }
    let listo = false;
    const cerrar = (r) => { if (!listo) { listo = true; resolve(r); } };
    hijo.on('error', (e) => cerrar({ abierto: false, motivo: e.message, url }));
    try { hijo.unref(); } catch { /* ya estaba */ }
    // si el binario no existe, el error llega en el tick siguiente: damos un
    // instante antes de dar el alta por bueno
    setTimeout(() => cerrar({ abierto: true, motivo: null, url }), 250);
  });
}

module.exports = { abrir, urlValida, sinDisplay };
