#!/usr/bin/env node
// kraken.js — la CLI del kraken.
//
//   kraken serve [--port N] [--host H] [--no-browser] [--lang es|en|pt]
//   kraken url
//   kraken open
//   kraken install-ide [--dry-run]
//   kraken uninstall [--keep-state]
//   kraken autostart [--remove] [--con-navegador]
//   kraken emit [--kind K] [--sid S] [--src X] [--title T] [--tool T] [--step N --total N] [--project P]
//   kraken doctor

const path = require('path');
const fs = require('fs');

const COMANDOS = ['serve', 'url', 'open', 'install-ide', 'uninstall', 'autostart', 'emit', 'doctor', 'help'];

function uso() {
  console.log(`kraken — panel local de agentes

  kraken serve [--port N] [--host H] [--no-browser] [--lang es|en|pt] [--dir RUTA]
  kraken url                       imprime la URL del panel con el token
  kraken open                      abre el panel en el navegador
  kraken install-ide [--dry-run]      plugin de opencode + hooks de Claude Code (opt-in)
  kraken uninstall [--keep-state]      revierte autostart, plugin, hooks y estado
  kraken autostart [--remove]          arranca solo al iniciar sesión
                [--con-navegador]     y abre el panel al entrar
  kraken emit [--kind K] [--sid S] [--src X] [--title T] [--tool T] [--step N] [--total N] [--project P]
  kraken doctor                        estado de la máquina

  El panel vive en http://localhost:7317. Si ese puerto está tomado se prueban
  los diez siguientes y, al final, uno efímero.

  Las rutas /api/* piden un token de 128 bits. Vive en el archivo de estado
  y la primera carga del navegador lo recibe por ?token=.`);
}

function banderas(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const clave = a.slice(2);
    if (clave === 'no-browser' || clave === 'sin-navegador' || clave === 'dry-run'
      || clave === 'remove' || clave === 'keep-state' || clave === 'con-navegador'
      || clave === 'con-browser') {
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

// La URL con token: se arma con el puerto que quedó y el token del archivo
// del estado. Es la que el humano necesita para abrir el panel a mano.
function comandoUrl() {
  const servidor = require('../src/servidor.js');
  console.log(servidor.urlConToken());
}

async function comandoOpen() {
  const servidor = require('../src/servidor.js');
  const navegador = require('../src/navegador.js');
  const url = servidor.urlConToken();
  // KRAKEN_ABRIR=0 no abre nada: sólo imprime la URL
  if (process.env.KRAKEN_ABRIR === '0') {
    console.log(url);
    return;
  }
  const r = await navegador.abrir(url);
  if (r.abierto) {
    console.log(`kraken: panel abierto en ${url.split('?')[0]}`);
    return;
  }
  // si no hay navegador la cosa sigue: la URL queda a mano
  console.log(url);
  console.error(`kraken: no pude abrir el navegador (${r.motivo}). Abrí la URL de arriba a mano.`);
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
  const servidor = require('../src/servidor.js');

  const dir = rutas.estado();
  console.log(`node            ${process.version}`);
  console.log(`estado         ${dir}${fs.existsSync(dir) ? '' : ' (no existe todavía)'}`);
  console.log(`config         ${permisos.archivoConfig()}`);
  console.log(`eventos        ${eventos.archivoEventos()}`);
  console.log(`opencode       ${rutas.baseOpencode()}${fs.existsSync(rutas.baseOpencode()) ? '' : ' (no está)'}`);
  console.log(`claude code    ${rutas.proyectosClaude()}${fs.existsSync(rutas.proyectosClaude()) ? '' : ' (no está)'}`);

  const aut = autostart.estado();
  console.log(`autostart      ${aut.instalado ? aut.destino : 'no instalado'}${aut.instalado ? ` — ${aut.activo ? 'activo' : 'instalado pero inactivo'}` : ''}`);

  const conf = permisos.config();
  // sin archivo de configuración la allowlist va en modo automático y no hay
  // lista que mostrar
  const lista = conf.raices || [];
  console.log(`allowlist      ${conf.raices === null ? 'modo automático: lo que los IDEs ya conocen' : (lista.length ? lista.join(', ') : 'vacía: no se muestra nada')}`);
  console.log(`dias           ${conf.dias}`);

  const token = permisos.token();
  console.log(`token          ${token.slice(0, 6)}… (${token.length} hex, 128 bits)`);
  console.log(`puerto         ${servidor.puertoEfectivo()}`);
  console.log(`url            ${servidor.urlConToken()}`);

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
    case 'url':
      return comandoUrl(resto);
    case 'open':
      return comandoOpen(resto);
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
      const flags = banderas(resto);
      if (flags.remove) {
        const r = autostart.desinstalar();
        console.log(r.estaba ? `autostart deshecho: ${r.destino}` : 'no había autostart');
        return undefined;
      }
      const conNavegador = flags['con-navegador'] === true || flags['con-browser'] === true;
      const destino = autostart.instalar({ navegador: conNavegador });
      console.log(`autostart listo: ${destino}`);
      console.log(conNavegador
        ? 'arranca al iniciar sesión y abre el panel'
        : 'arranca con --no-browser: no abre pestañas al iniciar sesión');
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
      console.error(`kraken: no conozco el comando "${cmd}"`);
      uso();
      process.exitCode = 2;
      return undefined;
  }
}

main();
