// capturas.js — las capturas del README, con datos inventados.
//
// El servidor se levanta contra una fixture en un directorio temporal: ni una
// sesión real, ni un path real, ni una tool real. Después Edge o Chrome
// headless saca las dos fotos: desktop y portrait.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(RAIZ, 'docs', 'img');
const PUERTO = 51998;

const FOTOS = [
  { nombre: 'kraken-desktop.png', ancho: 1600, alto: 1000 },
  { nombre: 'kraken-portrait.png', ancho: 430, alto: 930 },
];

function navegador() {
  const candidatos = [];
  if (process.env.KRAKEN_BROWSER) candidatos.push(process.env.KRAKEN_BROWSER);
  if (process.platform === 'win32') {
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    candidatos.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    candidatos.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    candidatos.push(path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    candidatos.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    candidatos.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  } else {
    candidatos.push('/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  }
  for (const c of candidatos) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* siguiente */ }
  }
  return null;
}

// --- la fixture -------------------------------------------------------------

function fixture() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'kraken-capturas-'));
  const estado = path.join(raiz, 'estado');
  const config = path.join(raiz, 'config');
  const proyecto = path.join(raiz, 'proyectos', 'tienda-web');
  const claude = path.join(raiz, 'claude', 'tienda-web');
  const opencode = path.join(raiz, 'opencode');
  for (const d of [estado, config, path.dirname(proyecto), claude, opencode]) fs.mkdirSync(d, { recursive: true });

  fs.writeFileSync(
    path.join(config, 'permisos.json'),
    `${JSON.stringify({ raices: [path.dirname(proyecto)], dias: 30, nivel: 'metadata' }, null, 2)}\n`,
  );

  const ahora = Date.now();
  const hace = (min) => new Date(ahora - min * 60000).toISOString();
  const lineas = [];
  let seq = 0;
  const agrega = (o) => { seq += 1; lineas.push(JSON.stringify({ v: 1, seq, ...o })); };

  const agentes = [
    { titulo: 'agente-ideas', modelo: 'claude-sonnet', tool: 'read' },
    { titulo: 'agente-devops', modelo: 'gpt-5-codex', tool: 'bash' },
    { titulo: 'agente-ideas', modelo: 'claude-opus', tool: 'edit' },
  ];
  agentes.forEach((a, i) => {
    const sid = `ses-demo-${i + 1}`;
    agrega({ ts: hace(24 - i * 3), kind: 'session.start', sid, src: 'opencode', title: a.titulo, project: proyecto });
    agrega({ ts: hace(23 - i * 3), kind: 'session.step', sid, src: 'opencode', title: a.titulo, tool: a.tool, project: proyecto });
    agrega({ ts: hace(22 - i * 3), kind: 'session.step', sid, src: 'opencode', title: a.titulo, tool: 'grep', project: proyecto });
  });
  // dos sesiones terminadas, para que se vea la sección de terminadas
  for (let i = 1; i <= 2; i++) {
    const sid = `ses-demo-terminada-${i}`;
    agrega({ ts: hace(120 - i), kind: 'session.start', sid, src: 'opencode', title: 'agente-devops', project: proyecto });
    agrega({ ts: hace(118 - i), kind: 'session.step', sid, src: 'opencode', title: 'agente-devops', tool: 'read', project: proyecto });
    agrega({ ts: hace(115 - i), kind: 'session.end', sid, src: 'opencode', title: 'agente-devops', project: proyecto });
  }
  fs.writeFileSync(path.join(estado, 'events.jsonl'), `${lineas.join('\n')}\n`);

  // un transcript de Claude Code, también inventado
  const transcript = [
    { type: 'user', sessionId: 'ses-claude-demo', cwd: proyecto, timestamp: hace(6), message: { role: 'user', content: [{ type: 'text', text: 'fixture' }] } },
    { type: 'assistant', sessionId: 'ses-claude-demo', cwd: proyecto, timestamp: hace(5), message: { role: 'assistant', model: 'claude-sonnet-4', content: [{ type: 'tool_use', id: 't1', name: 'write', input: {} }], usage: { input_tokens: 4200, output_tokens: 810, cache_read_input_tokens: 12000 } } },
  ];
  fs.writeFileSync(
    path.join(claude, 'ses-claude-demo.jsonl'),
    `${transcript.map((l) => JSON.stringify(l)).join('\n')}\n`,
  );

  baseOpencode(opencode, proyecto, ahora);
  return { raiz, estado, config, opencode, claude };
}

// una base de opencode de mentira, con el mismo esquema que la real
function baseOpencode(dir, proyecto, ahora) {
  let sqlite;
  try { sqlite = require('node:sqlite'); } catch { return false; }
  const archivo = path.join(dir, 'opencode.db');
  let db;
  try {
    db = new sqlite.DatabaseSync(archivo);
  } catch {
    return false;
  }
  try {
    db.exec(`create table session (id text primary key, parent_id text, title text, directory text, agent text, model text, cost real, tokens_input integer, tokens_output integer, tokens_reasoning integer, tokens_cache_read integer, tokens_cache_write integer, summary_additions integer, summary_deletions integer, summary_files integer, time_created integer, time_updated integer)`);
    db.exec(`create table message (id text primary key, session_id text, time_created integer)`);
    db.exec(`create table part (id text primary key, message_id text, session_id text, time_created integer, data text)`);
    db.exec(`create table todo (id text primary key, session_id text, content text, status text, priority text, position integer)`);

    const sesion = db.prepare(`insert into session values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const mensaje = db.prepare(`insert into message values (?,?,?)`);
    const parte = db.prepare(`insert into part values (?,?,?,?,?)`);
    const todo = db.prepare(`insert into todo values (?,?,?,?,?,?)`);

    const filas = [
      ['ses-oc-1', 'reformatear el checkout', 'claude', 'anthropic/claude-sonnet-4', 0.0842, 18200, 2400, 900, 41000, 12000, 312, 88, 5],
      ['ses-oc-2', 'migrar la base de datos', 'gpt-5', 'openai/gpt-5-codex', 0.0511, 9900, 1800, 1200, 22000, 6000, 120, 30, 3],
    ];
    filas.forEach((f, i) => {
      const creado = ahora - (60 - i * 20) * 60000;
      const movido = ahora - (i + 1) * 60000;
      sesion.run(f[0], null, f[1], proyecto, f[2], JSON.stringify({ id: f[3], providerID: f[3].split('/')[0] }), f[4], f[5], f[6], f[7], f[8], f[9], f[10], f[11], f[12], creado, movido);
      const mid = `msg-${f[0]}-1`;
      mensaje.run(mid, f[0], movido - 60000);
      parte.run(`part-${f[0]}-1`, mid, f[0], movido - 60000, JSON.stringify({ type: 'tool', tool: 'edit', state: { status: 'completed', time: { start: movido - 60000, end: movido - 30000 } } }));
      parte.run(`part-${f[0]}-2`, mid, f[0], movido - 30000, JSON.stringify({ type: 'patch', files: ['src/checkout.ts', 'src/pay.ts'] }));
      todo.run(`todo-${f[0]}-1`, f[0], 'revisar los tests del checkout', 'completed', 'high', 1);
      todo.run(`todo-${f[0]}-2`, f[0], 'medir el tiempo de respuesta', 'pending', 'medium', 2);
    });
    db.close();
  } catch (e) {
    console.error(`no pude armar la base de la fixture: ${e.message}`);
    return false;
  }
  return true;
}

// --- el server --------------------------------------------------------------

function arrancarServidor(fx) {
  const hijo = spawn(process.execPath, [path.join(RAIZ, 'bin', 'kraken.js'), 'serve', '--port', String(PUERTO), '--no-browser'], {
    env: {
      ...process.env,
      KRAKEN_ESTADO_DIR: fx.estado,
      KRAKEN_CONFIG_DIR: fx.config,
      KRAKEN_OPENCODE_DIR: fx.opencode,
      KRAKEN_CLAUDE_DIR: fx.claude,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let salida = '';
    hijo.stdout.on('data', (t) => {
      salida += t.toString();
      const linea = salida.split('\n').find((l) => l.includes('server-started'));
      if (linea) {
        try { resolve({ hijo, info: JSON.parse(linea) }); } catch { reject(new Error('no pude leer la info del server')); }
      }
    });
    hijo.stderr.on('data', (t) => process.stderr.write(t));
    hijo.on('exit', (code) => reject(new Error(`el server se salió con ${code}`)));
    setTimeout(() => reject(new Error('el server no arrancó')), 15000).unref();
  });
}

// La captura por el protocolo de DevTools: el viewport queda con el tamaño
// exacto pedido, sin que Windows imponga un ancho mínimo a la ventana.
async function capturar(exe, url, destino, ancho, alto) {
  if (typeof WebSocket !== 'function') throw new Error('este Node no tiene WebSocket');
  const port = 9400 + Math.floor(Math.random() * 500);
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'kraken-chrome-'));
  const hijo = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${port}`, `--user-data-dir=${perfil}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const reloj = setTimeout(() => reject(new Error('el navegador no abrió el puerto de depuración')), 20000);
    hijo.stderr.on('data', (t) => {
      buf += t.toString();
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) { clearTimeout(reloj); resolve(m[0]); }
    });
    hijo.on('exit', () => { clearTimeout(reloj); reject(new Error('el navegador se cerró')); });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = () => j(new Error('no pude hablar con el navegador'));
  });

  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  const manda = (method, params, sessionId) => new Promise((resolve) => {
    id += 1;
    pend.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
  });

  try {
    const target = await manda('Target.createTarget', { url: 'about:blank' });
    const attach = await manda('Target.attachToTarget', { targetId: target.result.targetId, flatten: true });
    const sesion = attach.result.sessionId;
    await manda('Emulation.setDeviceMetricsOverride', {
      width: ancho, height: alto, deviceScaleFactor: 1, mobile: false,
    }, sesion);
    await manda('Page.enable', {}, sesion);
    await manda('Page.navigate', { url }, sesion);
    await new Promise((r) => setTimeout(r, 3000));
    const foto = await manda('Page.captureScreenshot', { format: 'png' }, sesion);
    if (!foto.result || !foto.result.data) throw new Error('el navegador no devolvió la imagen');
    fs.writeFileSync(destino, Buffer.from(foto.result.data, 'base64'));
  } finally {
    try { ws.close(); } catch { /* ya cerrada */ }
    hijo.kill();
  }
  return destino;
}

function foto(exe, url, destino, ancho, alto) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--user-data-dir=${path.join(os.tmpdir(), `kraken-chrome-${path.basename(destino)}`)}`,
    `--window-size=${ancho},${alto}`,
    '--virtual-time-budget=6000',
    `--screenshot=${destino}`,
    url,
  ];
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 60000 });
  if (r.error) throw new Error(`el navegador falló: ${r.error.message}`);
  if (!fs.existsSync(destino)) {
    throw new Error(`el navegador no pudo sacar ${path.basename(destino)}`);
  }
  return destino;
}

// --- el main ----------------------------------------------------------------

(async () => {
  const exe = navegador();
  if (!exe) {
    console.error('no encontré Edge ni Chrome: instalá uno o apuntá KRAKEN_BROWSER al ejecutable');
    process.exit(2);
  }
  fs.mkdirSync(SALIDA, { recursive: true });

  const fx = fixture();
  console.log(`fixture en ${fx.raiz}`);
  const { hijo, info } = await arrancarServidor(fx);
  console.log(`server en ${info.url}`);

  const token = fs.readFileSync(path.join(fx.estado, 'token'), 'utf8').trim();
  // foto=1 deja el panel sin stream abierto: el navegador headless espera
  // que la página se quede quieta y el SSE no se queda quieta nunca.
  const url = `http://127.0.0.1:${PUERTO}/?token=${token}&foto=1`;

  let snapshot = '';
  try {
    for (const f of FOTOS) {
      const destino = path.join(SALIDA, f.nombre);
      if (fs.existsSync(destino)) fs.rmSync(destino, { force: true });
      try {
        await capturar(exe, url, destino, f.ancho, f.alto);
      } catch (e) {
        console.warn(`devtools no sirvió (${e.message}), pruebo con --screenshot`);
        foto(exe, url, destino, f.ancho, f.alto);
      }
      const st = fs.statSync(destino);
      console.log(`${f.nombre}  ${f.ancho}x${f.alto}  ${(st.size / 1024).toFixed(0)} kB`);
    }
    // lo que ve el navegador tampoco puede llevar paths
    snapshot = await pedirEstado(token, PUERTO);
  } finally {
    hijo.kill();
  }

  // ni una foto ni el estado pueden llevar un path de la máquina
  const prohibido = [fx.raiz, os.homedir()];
  const infractores = [];
  for (const f of FOTOS) {
    const p = path.join(SALIDA, f.nombre);
    if (!fs.existsSync(p)) infractores.push(`${f.nombre}: no salió`);
  }
  const estado = fs.readFileSync(path.join(fx.estado, 'events.jsonl'), 'utf8');
  for (const mal of prohibido) {
    if (estado.includes(mal)) infractores.push(`events.jsonl → ${mal}`);
  }
  for (const mal of prohibido) {
    if (snapshot.includes(mal)) infractores.push(`snapshot → ${mal}`);
  }
  if (infractores.length) {
    console.error(`las capturas no están limpias: ${infractores.join(' | ')}`);
    process.exit(1);
  }
  console.log('capturas listas, sin paths de la máquina');
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

function pedirEstado(token, puerto) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: '127.0.0.1',
      port: puerto,
      path: '/api/state',
      headers: { 'X-Kraken-Token': token },
    }, (res) => {
      const trozos = [];
      res.on('data', (t) => trozos.push(t));
      res.on('end', () => resolve(Buffer.concat(trozos).toString('utf8')));
    });
    req.on('error', reject);
  });
}
