/**
 * kraken-feed.js — el plugin de opencode que alimenta el kraken. Traduce los
 * eventos del IDE a líneas del JSONL: sólo metadatos, nunca el prompt ni el
 * contenido de los archivos leídos.
 *
 * Va en try/catch en todos lados: un error del kraken no puede romper el IDE.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// En el repo el módulo vive un nivel arriba; instalado global queda al lado
// del plugin con otro nombre (lo copia instalar.js).
function cargarEventos() {
  const candidatos = ['./kraken-eventos.js', '../eventos.js'];
  for (const c of candidatos) {
    try {
      return require(c);
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

const eventos = cargarEventos();

function sidDe(evento) {
  const props = (evento && evento.properties) || {};
  const info = props.info || {};
  const candidatos = [
    evento && evento.sessionID,
    props.sessionID,
    props.sessionId,
    info.id,
  ];
  for (const c of candidatos) {
    if (typeof c === 'string' && c !== '') return c;
  }
  return null;
}

export const VisorFeed = async ({ directory, worktree }) => {
  const raiz = worktree || directory || process.cwd();
  const cerradas = new Set();
  // El nombre real de la pestaña, cuando el IDE lo manda. En opencode llega
  // en session.updated, después del session.created.
  const titulos = new Map();

  const avisar = (evento) => {
    if (!eventos) return;
    try {
      eventos.escribirEvento(evento);
    } catch {
      // el kraken es un extra: si falla, el IDE sigue igual
    }
  };

  const nombre = (sid) => {
    const guardado = titulos.get(sid);
    if (guardado) return guardado;
    return eventos ? eventos.tituloCorto('opencode', sid) : 'opencode';
  };

  // El título de la sesión es el nombre de la pestaña en el TUI. Viene del
  // primer mensaje del usuario, así que entra recortado. Devuelve el título
  // sólo cuando cambió, para no escribir un evento por cada update.
  function recordarTitulo(sid, evento) {
    if (!eventos || !eventos.tituloSesion) return null;
    const props = (evento && evento.properties) || {};
    const info = props.info || {};
    const crudo = props.title || info.title || null;
    const t = eventos.tituloSesion(crudo);
    if (!t || t === titulos.get(sid)) return null;
    titulos.set(sid, t);
    return t;
  }

  return {
    event: async ({ event }) => {
      try {
        if (!event) return;
        const tipo = event.type;
        const sid = sidDe(event);
        if (!sid) return;

        const nuevoTitulo = recordarTitulo(sid, event);
        if (nuevoTitulo) {
          // el nombre de la pestaña llegó después del arranque: el panel lo
          // actualiza sin tocar el estado ni el contador de pasos
          avisar({
            kind: 'session.title',
            sid,
            src: 'opencode',
            title: nuevoTitulo,
            project: raiz,
          });
        }

        if (tipo === 'session.created') {
          const reabre = cerradas.has(sid);
          cerradas.delete(sid);
          avisar({
            kind: reabre ? 'session.reopen' : 'session.start',
            sid,
            src: 'opencode',
            title: nombre(sid),
            project: raiz,
          });
          return;
        }

        if (tipo === 'session.idle') {
          cerradas.add(sid);
          avisar({
            kind: 'session.end',
            sid,
            src: 'opencode',
            title: nombre(sid),
            project: raiz,
          });
          return;
        }

        // la sesión terminó y volvió a moverse: el kraken la reactiva
        const revive = tipo === 'session.updated' || tipo === 'message.updated' || tipo === 'session.status';
        if (revive && cerradas.has(sid)) {
          cerradas.delete(sid);
          avisar({
            kind: 'session.reopen',
            sid,
            src: 'opencode',
            title: nombre(sid),
            project: raiz,
          });
        }
      } catch {
        // un evento raro no puede romper el IDE
      }
    },

    'tool.execute.before': async (input) => {
      try {
        if (!input) return;
        const sid = (typeof input.sessionID === 'string' && input.sessionID) || null;
        if (!sid) return;
        avisar({
          kind: 'session.step',
          sid,
          src: 'opencode',
          title: nombre(sid),
          tool: typeof input.tool === 'string' ? input.tool : null,
          project: raiz,
        });
      } catch {
        // idem: nada de lo que escriba el panel rompe una tool
      }
    },
  };
};
