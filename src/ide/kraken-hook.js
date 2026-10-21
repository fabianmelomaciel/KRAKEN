#!/usr/bin/env node
// hook.js — el gancho de Claude Code. Lee el JSON que el IDE manda por stdin y
// anexa una línea al JSONL del kraken.
//
// Va en node y no en bash a propósito: el bash del PATH en esta máquina es WSL
// sin distro, y un hook que no arranca rompe la sesión.
//
// El payload es mínimo: metadatos del IDE, nunca el prompt ni el transcript.

const eventos = require('../eventos.js');

let entrada = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (trozo) => { entrada += trozo; });
process.stdin.on('error', () => { /* stdin cerrado: no hay nada que anotar */ });
process.stdin.on('end', () => {
  try {
    procesar(entrada);
  } catch {
    // un hook roto no puede frenar al IDE
  }
});

process.on('uncaughtException', () => process.exit(0));

function procesar(texto) {
  let datos = null;
  try { datos = JSON.parse(texto || '{}'); } catch { datos = null; }
  if (!datos) return;

  const sid = typeof datos.session_id === 'string' ? datos.session_id : null;
  if (!sid) return;

  const nombreEvento = datos.hook_event_name || '';
  const proyecto = typeof datos.cwd === 'string' ? datos.cwd : null;
  const titulo = eventos.tituloCorto('claude', sid);

  let kind = null;
  let tool = null;

  if (nombreEvento === 'SessionStart') {
    kind = 'session.start';
  } else if (nombreEvento === 'UserPromptSubmit') {
    kind = 'session.reopen';
  } else if (nombreEvento === 'PreToolUse') {
    kind = 'session.step';
    tool = typeof datos.tool_name === 'string' ? datos.tool_name : null;
  } else if (nombreEvento === 'Stop' || nombreEvento === 'SessionEnd') {
    kind = 'session.end';
  }

  if (!kind) return;

  eventos.escribirEvento({
    kind,
    sid,
    src: 'claude',
    title: titulo,
    tool,
    project: proyecto,
  });
}
