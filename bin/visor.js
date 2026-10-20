#!/usr/bin/env node
// visor.js — la CLI del visor.
//
//   visor serve [--port N] [--host H] [--no-browser] [--lang es|en|pt]
//   visor install-ide [--dry-run]
//   visor uninstall [--keep-state]
//   visor autostart [--remove]
//   visor emit [--kind K] [--sid S] [--src X] [--title T] [--tool T] [--step N --total N] [--project P]
//   visor doctor

const path = require('path');
const fs = require('fs');

const COMANDOS = ['serve', 'install-ide', 'uninstall', 'autostart', 'emit', 'doctor', 'help'];

function uso() {
  console.log(`visor — panel local de agentes

  visor serve [--port N] [--host H] [--no-browser] [--lang es|en|pt] [--dir RUTA]
  visor install-ide [--dry-run]      plugin de opencode + hooks de Claude Code (opt-in)
  visor uninstall [--keep-state]      revierte autostart, plugin, hooks y estado
  visor autostart [--remove]          arranca solo al iniciar sesión (siempre --no-browser)
  visor emit [--kind K] [--sid S] [--src X] [--title T] [--tool T] [--step N] [--total N] [--project P]
  visor doctor                        estado de la máquina

  Las rutas /api/* piden un token de 128 bits. Vive en el archivo de estado
  y la primera carga del navegador lo recibe por ?token=.`);
}

function banderas(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const clave = a.slice(2);
    if (clave === 'no-browser' || clave === 'sin-navegador' || clave === 'dry-run' || clave === 'remove' || clave === 'keep-state') {
      out[clave] = true;
      continue;
    }
    out[clave] = argv[++i];
  }
  return out;
}

function comandoServe() {
  // servidor.js lee los flags del argv al requerirse
  const servidor = require('../src/servidor.js');
  servidor.arrancar();
}

function comandoEmit(resto) {
  const flags = banderas(resto);
  const eventos = require('../src/eventos.js');
  const registro = eventos.escribirEvento({
    kind: flags.kind || 'session.step',
    sid: flags.sid || 'emit',
    src: flags.src || 'cli',
    title: flags.title || null,
    tool: flags.tool || null,
    step: flags.step === undefined ? null : Number(flags.step),
    total: flags.total === undefined ? null : Number(flags.total),
    project: flags.project || null,
  });
  console.log(JSON.stringify(registro));
}

function comandoDoctor() {
  const rutas = require('../src/rutas.js');
  const permisos = require('../src/permisos.js');
  const eventos = require('../src/eventos.js');
  const autostart = require('../src/autostart.js');
  const fuentes = require('../src/fuentes.js');

  const dir = rutas.estado();
  console.log(`node            ${process.version}`);
  console.log(`estado         ${dir}${fs.existsSync(dir) ? '' : ' (no existe todavía)'}`);
  console.log(`config         ${permisos.archivoConfig()}`);
  console.log(`eventos        ${eventos.archivoEventos()}`);
  console.log(`opencode       ${rutas.baseOpencode()}${fs.existsSync(rutas.baseOpencode()) ? '' : ' (no está)'}`);
  console.log(`claude code    ${rutas.proyectosClaude()}${fs.existsSync(rutas.proyectosClaude()) ? '' : ' (no está)'}`);
  console.log(`autostart      ${autostart.instalado() ? autostart.archivo() : 'no instalado'}`);

  const conf = permisos.config();
  console.log(`allowlist      ${conf.raices.length ? conf.raices.join(', ') : 'vacía: no se muestra nada'}`);
  console.log(`dias           ${conf.dias}`);

  const token = permisos.token();
  console.log(`token          ${token.slice(0, 6)}… (${token.length} hex, 128 bits)`);

  const oc = fuentes.sesionesOpencode();
  const cc = fuentes.sesionesClaude();
  console.log(`opencode       ${oc.ok ? `${oc.sesiones.length} sesiones` : `degradado: ${oc.aviso}`}`);
  console.log(`claude code    ${cc.ok ? `${cc.sesiones.length} sesiones` : `degradado: ${cc.aviso}`}`);
}

function main() {
  const [cmd, ...resto] = process.argv.slice(2);
  switch (cmd) {
    case 'serve':
      return comandoServe(resto);
    case 'install-ide': {
      const instalar = require('../src/instalar.js');
      return instalar.instalar({ dryRun: banderas(resto)['dry-run'] === true });
    }
    case 'uninstall': {
      const instalar = require('../src/instalar.js');
      return instalar.desinstalar({ keepState: banderas(resto)['keep-state'] === true });
    }
    case 'autostart': {
      const autostart = require('../src/autostart.js');
      if (banderas(resto).remove) {
        const r = autostart.desinstalar();
        console.log(r.estaba ? `autostart deshecho: ${r.destino}` : 'no había autostart');
        return undefined;
      }
      const destino = autostart.instalar();
      console.log(`autostart listo: ${destino}`);
      console.log('arranca con --no-browser: no abre pestañas al iniciar sesión');
      return undefined;
    }
    case 'emit':
      return comandoEmit(resto);
    case 'doctor':
      return comandoDoctor();
    case 'help':
    case undefined:
      return uso();
    default:
      console.error(`visor: no conozco el comando "${cmd}"`);
      uso();
      process.exitCode = 2;
      return undefined;
  }
}

main();
