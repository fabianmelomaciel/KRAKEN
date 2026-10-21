// i18n.js — la tabla de textos. Plana y de a tres: es, en y pt.
//
// El mismo archivo lo usan el servidor (para el nombre del producto en los
// logs) y el panel (que lo carga como script suelto), así que va en formato
// UMD y no depende de nada.

const TRADUCCIONES = {
  es: {
    nombre: 'Visor IA',
    subtitulo: 'qué están haciendo tus agentes',
    activas: 'Activas',
    terminadas: 'Terminadas',
    terminadasNota: 'las 5 últimas',
    agentes: 'Agentes',
    tokens: 'Tokens',
    costo: 'Costo',
    plan: 'Plan',
    activo: 'activo',
    inactivo: 'inactivo',
    terminado: 'terminado',
    sinActividad: 'sin actividad hace {n}m',
    vacio: 'No hay sesiones todavía.',
    vacioAyuda: 'Abrí opencode o Claude Code, o mandá un evento con visor emit.',
    proyecto: 'proyecto',
    sesion: 'sesión',
    mensajes: 'mensajes',
    pasos: 'pasos',
    fuenteOpencode: 'opencode',
    fuenteClaude: 'Claude Code',
    fuenteEventos: 'eventos',
    degradado: 'degradado',
    sinFuentes: 'sin fuentes',
    viva: 'con actividad',
    idioma: 'Idioma',
    abierto: 'panel abierto',
    sinBase: 'no está la base de opencode en esta máquina',
    sinTranscripts: 'no está la carpeta de transcripts de Claude Code',
    baseLectura: 'no pude abrir la base de opencode en sólo lectura',
    faltaToken: 'Falta el token. Corré `visor open`',
    tokenInvalido: 'El token no vale. Corré `visor open`',
  },
  en: {
    nombre: 'AI Monitor',
    subtitulo: 'what your agents are up to',
    activas: 'Active',
    terminadas: 'Finished',
    terminadasNota: 'the last 5',
    agentes: 'Agents',
    tokens: 'Tokens',
    costo: 'Cost',
    plan: 'Plan',
    activo: 'active',
    inactivo: 'idle',
    terminado: 'finished',
    sinActividad: 'idle for {n}m',
    vacio: 'No sessions yet.',
    vacioAyuda: 'Open opencode or Claude Code, or push an event with visor emit.',
    proyecto: 'project',
    sesion: 'session',
    mensajes: 'messages',
    pasos: 'steps',
    fuenteOpencode: 'opencode',
    fuenteClaude: 'Claude Code',
    fuenteEventos: 'events',
    degradado: 'degraded',
    sinFuentes: 'no sources',
    viva: 'with activity',
    idioma: 'Language',
    abierto: 'panel open',
    sinBase: 'the opencode database is not on this machine',
    sinTranscripts: 'the Claude Code transcripts folder is not on this machine',
    baseLectura: 'could not open the opencode database read-only',
    faltaToken: 'Missing token. Run `visor open`',
    tokenInvalido: 'The token is not valid. Run `visor open`',
  },
  pt: {
    nombre: 'Monitor IA',
    subtitulo: 'o que os seus agentes estão fazendo',
    activas: 'Ativas',
    terminadas: 'Terminadas',
    terminadasNota: 'as 5 últimas',
    agentes: 'Agentes',
    tokens: 'Tokens',
    costo: 'Custo',
    plan: 'Plano',
    activo: 'ativo',
    inactivo: 'ocioso',
    terminado: 'terminado',
    sinActividad: 'sem atividade há {n}m',
    vacio: 'Nenhuma sessão ainda.',
    vacioAyuda: 'Abra o opencode ou o Claude Code, ou envie um evento com visor emit.',
    proyecto: 'projeto',
    sesion: 'sessão',
    mensajes: 'mensagens',
    pasos: 'passos',
    fuenteOpencode: 'opencode',
    fuenteClaude: 'Claude Code',
    fuenteEventos: 'eventos',
    degradado: 'degradado',
    sinFuentes: 'sem fontes',
    viva: 'com atividade',
    idioma: 'Idioma',
    abierto: 'painel aberto',
    sinBase: 'a base do opencode não está nesta máquina',
    sinTranscripts: 'a pasta de transcripts do Claude Code não está nesta máquina',
    baseLectura: 'não consegui abrir a base do opencode em somente leitura',
    faltaToken: 'Falta o token. Rode `visor open`',
    tokenInvalido: 'O token não vale. Rode `visor open`',
  },
};

const IDIOMAS = Object.keys(TRADUCCIONES);

// El idioma sale del ?lang= si está, si no del navegador, si no español.
function detectar(idiomaNavegador, paramUrl) {
  const pedido = String(paramUrl || '').toLowerCase();
  if (IDIOMAS.includes(pedido)) return pedido;
  const nav = String(idiomaNavegador || '').toLowerCase();
  for (const id of IDIOMAS) {
    if (nav === id || nav.startsWith(`${id}-`) || nav.startsWith(`${id}_`)) return id;
  }
  return 'es';
}

function t(idioma, clave, params) {
  const tabla = TRADUCCIONES[idioma] || TRADUCCIONES.es;
  let salida = tabla[clave];
  if (salida === undefined) salida = TRADUCCIONES.es[clave];
  if (salida === undefined) return clave;
  if (!params) return salida;
  return salida.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : params[k]));
}

const API = { TRADUCCIONES, IDIOMAS, detectar, t };

if (typeof module === 'object' && module.exports) {
  module.exports = API;
} else if (typeof globalThis !== 'undefined') {
  globalThis.VisorI18n = API;
}
