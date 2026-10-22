// panel.js — el render del HUD.
//
// El snapshot llega por SSE y, si se cae, por polling de /api/state. El token
// entra por la query en la primera carga, se guarda en localStorage y de ahí
// en adelante viaja en el header. Nada de innerHTML: todo es textContent.

(function () {
  'use strict';

  const i18n = globalThis.KrakenI18n;
  const CLAVE_TOKEN = 'kraken.token';
  const CLAVE_LANG = 'kraken.lang';
  const CLAVE_PAUSA = 'kraken.pausa';
  const POLL_MS = 2000;

  let idioma = 'es';
  let token = null;
  let fuente = null;
  let reloj = null;
  let ultimo = null;
  let ultimoEtag = null;
  let scrollManual = false;
  let avisoToken = null;
  let pausado = false;
  let modoFoto = false;
  // el histórico de las sparklines vive en el navegador: el servidor no
  // guarda una segunda de datos para dibujarla
  const HISTORIA_MAX = 30;
  const historia = { activas: [], terminadas: [], agentes: [], tokens: [], costo: [], percent: [] };
  // los veredictos son las transiciones que se ven entre un snapshot y otro
  const veredictos = [];
  const VEREDICTOS_MAX = 20;
  const firmas = new Map();

  const el = (id) => document.getElementById(id);

  function t(clave, params) {
    return i18n.t(idioma, clave, params);
  }

  function guardar(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch { /* modo privado */ }
  }

  function leer(clave) {
    try { return localStorage.getItem(clave); } catch { return null; }
  }

  function borrar(clave) {
    try { localStorage.removeItem(clave); } catch { /* modo privado */ }
  }

  // El aviso del token vive aparte del de las fuentes: si falta el token no
  // lo pisa el "degradado", y al revés.
  function avisarToken(texto) {
    avisoToken = texto;
    const aviso = el('aviso');
    if (aviso) {
      aviso.hidden = false;
      aviso.textContent = texto;
    }
  }

  // El token que manda ya no sirve: se tira y se dice qué hacer.
  function tokenRechazado() {
    token = null;
    borrar(CLAVE_TOKEN);
    avisarToken(t('tokenInvalido'));
  }

  // La primera carga trae el token en la query: se guarda y se saca de la
  // URL, así no queda en el historial del navegador.
  function tomarToken() {
    let deUrl = null;
    try {
      const url = new URL(location.href);
      deUrl = url.searchParams.get('token');
      if (deUrl) {
        url.searchParams.delete('token');
        history.replaceState({}, '', url.toString());
      }
    } catch { /* sin location: el token queda en localStorage */ }
    if (deUrl) guardar(CLAVE_TOKEN, deUrl);
    return deUrl || leer(CLAVE_TOKEN);
  }

  function tomarIdioma() {
    let deUrl = null;
    try {
      deUrl = new URL(location.href).searchParams.get('lang');
    } catch { /* sin location */ }
    // el idioma puede venir en el fragmento: así la URL no lleva dos
    // parámetros pegados con un "&"
    if (!deUrl) {
      try {
        const hash = String(location.hash || '').replace(/^#/, '');
        const m = hash.match(/(?:^|&)lang=([^&]+)/);
        if (m) deUrl = decodeURIComponent(m[1]);
      } catch { /* sin hash */ }
    }
    if (deUrl && i18n.IDIOMAS.includes(deUrl)) {
      guardar(CLAVE_LANG, deUrl);
      return deUrl;
    }
    return leer(CLAVE_LANG) || i18n.detectar(navigator.language, deUrl);
  }

  // --- el estado ------------------------------------------------------------

  function nodo(tag, clase, texto) {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function limpiar(n) {
    while (n.firstChild) n.removeChild(n.firstChild);
  }

  function etiquetaEstado(s) {
    if (s.estado === 'terminado') return t('terminado');
    if (s.estado === 'inactivo' && s.minutos) return t('sinActividad', { n: s.minutos });
    if (s.estado === 'inactivo') return t('inactivo');
    return t('activo');
  }

  function numeroBonito(n) {
    if (n === null || n === undefined) return '0';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  function costoBonito(c) {
    if (!c) return '$0';
    if (c < 0.01) return `$${c.toFixed(4)}`;
    return `$${c.toFixed(2)}`;
  }

  function tarjetaSesion(s) {
    const card = nodo('article', `sesion e-${s.estado || 'activo'}`);

    const f1 = nodo('div', 'fila');
    f1.appendChild(nodo('span', 'titulo', s.titulo || s.id));
    f1.appendChild(nodo('span', `estado es-${s.estado || 'activo'}`, etiquetaEstado(s)));
    card.appendChild(f1);

    const f2 = nodo('div', 'fila tenue');
    if (s.proyecto) f2.appendChild(nodo('span', 'proyecto', s.proyecto));
    f2.appendChild(nodo('span', 'ide', s.ide || 'evento'));
    if (s.modelo) f2.appendChild(nodo('span', 'modelo', s.modelo));
    if (s.agente) f2.appendChild(nodo('span', 'agente', s.agente));
    card.appendChild(f2);

    if (s.barra === 'plan' && s.percent !== null && s.percent !== undefined) {
      const barra = nodo('div', 'medidor');
      const relleno = nodo('div', 'relleno');
      relleno.style.setProperty('--ancho', `${s.percent}%`);
      barra.appendChild(relleno);
      card.appendChild(barra);
      card.appendChild(nodo('div', 'pie', `${s.percent}% ${t('plan')} · ${s.paso || 0}/${s.total || 0}`));
    } else {
      const barra = nodo('div', 'medidor actividad');
      barra.appendChild(nodo('div', 'relleno'));
      card.appendChild(barra);
    }

    const f3 = nodo('div', 'fila tenue');
    if (s.tool && s.tool.nombre) {
      f3.appendChild(nodo('span', 'tool', `${s.tool.nombre} · ${s.tool.estado || ''}`));
    }
    const tok = s.tokens || {};
    if (tok.entrada || tok.salida) f3.appendChild(nodo('span', 'tokens', `${numeroBonito(tok.entrada)}/${numeroBonito(tok.salida)}`));
    if (s.costo) f3.appendChild(nodo('span', 'costo', costoBonito(s.costo)));
    if (s.mensajes) f3.appendChild(nodo('span', 'mensajes', `${s.mensajes} ${t('mensajes')}`));
    card.appendChild(f3);

    if (s.checklist && s.checklist.total) {
      card.appendChild(nodo('div', 'pie', `${s.checklist.hechos || 0}/${s.checklist.total}`));
    }

    return card;
  }

  // --- las secciones nuevas ---------------------------------------------------

  function anotar(id, valor) {
    const h = historia[id];
    if (!h) return;
    h.push(valor === null || valor === undefined ? 0 : valor);
    if (h.length > HISTORIA_MAX) h.shift();
  }

  // La sparkline son barras: sin SVG y sin crear nodos raros. La altura va
  // por una variable de CSS porque la CSP no deja atributos style en el
  // markup.
  function pintarSpark(id, valores) {
    const cont = el(id);
    if (!cont) return;
    limpiar(cont);
    if (!valores || !valores.length) return;
    let max = 0;
    for (const v of valores) if (v > max) max = v;
    if (max <= 0) max = 1;
    for (const v of valores) {
      const barra = nodo('i');
      barra.style.setProperty('--h', `${Math.max(6, Math.round((v / max) * 100))}%`);
      cont.appendChild(barra);
    }
  }

  // La cinta: números reales del snapshot, sin títulos ni texto de prompts.
  // El singular no es un detalle: con un solo proyecto, "1 proyectos" se lee
  // como un error del panel.
  function plural(n, singular, varios) {
    return `${n} ${t(n === 1 ? singular : varios)}`;
  }

  function textoCinta(snap) {
    const r = snap.resumen || {};
    const tok = r.tokens || {};
    return [
      plural(r.activas || 0, 'sesionViva', 'sesionesVivas'),
      `${numeroBonito(tok.entrada || 0)} ${t('tokensTotal')}`,
      plural(contarHerramientas(snap), 'herramienta', 'herramientas'),
      plural((snap.proyectos || []).length, 'proyecto', 'proyectosMenu'),
    ].join('  ·  ');
  }

  function contarHerramientas(snap) {
    let n = 0;
    for (const s of snap.sesiones || []) if (s.tool && s.tool.nombre) n += 1;
    return n;
  }

  // La órbita: cada nodo es una sesión viva. La etiqueta lleva el proyecto
  // (el nombre corto, nunca el path), la tool y el estado.
  function pintarOrbita(snap) {
    const cont = el('orbita-nodos');
    if (!cont) return;
    limpiar(cont);
    const vivas = (snap.sesiones || [])
      .filter((s) => s.estado !== 'terminado')
      .slice(0, 24);
    const vacio = el('orbita-vacia');
    if (vacio) {
      vacio.hidden = vivas.length > 0;
      if (!vivas.length) vacio.textContent = t('sinSesiones');
    }
    vivas.forEach((s, i) => {
      const clases = `nodo p${(i % 8) + 1}`;
      const n = nodo('div', `${clases}${i === 0 ? ' nodo-foco' : ''}${s.viva ? ' nodo-vivo' : ''}`);
      n.appendChild(nodo('span', 'nodo-nombre', s.proyectoCorto || s.proyecto || t('sesion')));
      const datos = [s.tool && s.tool.nombre, etiquetaEstado(s)].filter(Boolean).join(' · ');
      n.appendChild(nodo('span', 'nodo-dato', datos));
      cont.appendChild(n);
    });
  }

  // Los veredictos: lo que cambió entre un snapshot y el siguiente. Nunca el
  // título de la sesión ni el texto de una tarea: sólo la tool, el estado y
  // el avance del checklist.
  function recogerVeredictos(snap) {
    const nuevos = [];
    for (const s of snap.sesiones || []) {
      const check = s.checklist && s.checklist.total ? s.checklist : null;
      const avance = check ? `${check.hechos || 0}/${check.total || 0}` : '';
      const firma = `${s.tool && s.tool.nombre ? s.tool.nombre : '-'}|${s.estado}|${avance}|${s.pasos || 0}`;
      const antes = firmas.get(s.id);
      firmas.set(s.id, firma);
      if (antes === undefined || antes === firma) continue;
      let tipo = 'verTool';
      let texto = s.tool && s.tool.nombre ? s.tool.nombre : t('sesion');
      if (s.estado === 'terminado') { tipo = 'verFin'; texto = t('terminado'); }
      else if (avance) { tipo = 'verPlan'; texto = `${texto} · ${avance}`; }
      nuevos.push({ tipo, texto });
    }
    for (const v of nuevos.reverse()) veredictos.unshift(v);
    while (veredictos.length > VEREDICTOS_MAX) veredictos.pop();
    return nuevos.length;
  }

  function pintarVeredictos(snap) {
    const cont = el('veredictos');
    if (!cont) return;
    limpiar(cont);
    if (!veredictos.length) {
      cont.appendChild(nodo('p', 'vacio', t('sinVeredictos')));
    }
    for (const v of veredictos) {
      const fila = nodo('div', `veredicto v-${v.tipo}`);
      fila.appendChild(nodo('b', null, t(v.tipo)));
      fila.appendChild(nodo('span', null, v.texto));
      cont.appendChild(fila);
    }
    const conteo = el('conteo-veredictos');
    if (conteo) conteo.textContent = `${veredictos.length} ${t('judged')}`;
  }

  // Dónde cae el número: el reparto de las tools con su denominador real.
  function pintarReparto(snap) {
    const cont = el('reparto');
    if (!cont) return;
    limpiar(cont);
    const cuenta = new Map();
    let total = 0;
    for (const s of snap.sesiones || []) {
      const nombre = s.tool && s.tool.nombre;
      if (!nombre) continue;
      cuenta.set(nombre, (cuenta.get(nombre) || 0) + 1);
      total += 1;
    }
    const nota = el('nota-reparto');
    if (nota) nota.textContent = total ? t('porHerramienta') : '';
    if (!total) {
      cont.appendChild(nodo('p', 'vacio', t('sinHerramientas')));
      return;
    }
    const filas = [...cuenta.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [nombre, n] of filas) {
      const pct = Math.round((n / total) * 100);
      const fila = nodo('div', 'reparto-fila');
      const cab = nodo('div', 'reparto-cab');
      cab.appendChild(nodo('b', null, nombre));
      cab.appendChild(nodo('i', null, `${pct}%`));
      fila.appendChild(cab);
      const pista = nodo('div', 'pista');
      const relleno = nodo('i');
      relleno.style.setProperty('--ancho', `${pct}%`);
      pista.appendChild(relleno);
      fila.appendChild(pista);
      cont.appendChild(fila);
    }
  }

  function pintar(snap) {
    if (pausado) { ultimo = snap; return; }
    ultimo = snap;
    const r = snap.resumen || {};

    const st = (id, valor) => { const n = el(id); if (n) n.textContent = valor; };
    st('st-activas', r.activas || 0);
    st('st-terminadas', r.terminadas || 0);
    st('st-agentes', r.agentesVivos || 0);
    st('st-tokens', numeroBonito((r.tokens || {}).entrada));
    st('st-costo', costoBonito(r.costo));
    st('st-percent', r.percent === null || r.percent === undefined ? '—' : `${r.percent}%`);

    // la cinta y las chispas: los números del snapshot, nunca el texto
    const cinta = textoCinta(snap);
    st('cinta-texto', cinta);
    st('cinta-texto-2', cinta);
    st('cinta-vivo', t('vivo'));

    anotar('activas', r.activas || 0);
    anotar('terminadas', r.terminadas || 0);
    anotar('agentes', r.agentesVivos || 0);
    anotar('tokens', (r.tokens || {}).entrada || 0);
    anotar('costo', r.costo || 0);
    anotar('percent', r.percent === null || r.percent === undefined ? 0 : r.percent);
    pintarSpark('sp-activas', historia.activas);
    pintarSpark('sp-terminadas', historia.terminadas);
    pintarSpark('sp-agentes', historia.agentes);
    pintarSpark('sp-tokens', historia.tokens);
    pintarSpark('sp-costo', historia.costo);
    pintarSpark('sp-percent', historia.percent);

    pintarOrbita(snap);
    recogerVeredictos(snap);
    pintarVeredictos(snap);
    pintarReparto(snap);

    const reloj = el('reloj');
    if (reloj) reloj.textContent = snap.lectura ? new Date(snap.lectura).toLocaleTimeString() : '';

    const luz = el('luz');
    if (luz) {
      luz.className = `luz l-${snap.estado || 'vivo'}`;
      luz.textContent = snap.estado || 'vivo';
    }

    const listaActivas = el('lista-activas');
    const listaTerminadas = el('lista-terminadas');
    if (listaActivas) {
      limpiar(listaActivas);
      const activas = (snap.sesiones || []).filter((s) => s.estado !== 'terminado');
      for (const s of activas) listaActivas.appendChild(tarjetaSesion(s));
    }
    if (listaTerminadas) {
      limpiar(listaTerminadas);
      const terminadas = (snap.sesiones || []).filter((s) => s.estado === 'terminado');
      for (const s of terminadas) listaTerminadas.appendChild(tarjetaSesion(s));
    }

    const vacio = el('vacio');
    if (vacio) {
      const sinNada = !(snap.sesiones || []).length;
      vacio.hidden = !sinNada;
      vacio.textContent = sinNada ? `${t('vacio')} ${t('vacioAyuda')}` : '';
    }

    const proyectos = el('proyectos');
    if (proyectos) {
      limpiar(proyectos);
      for (const p of snap.proyectos || []) {
        const li = nodo('li', 'proyecto');
        li.appendChild(nodo('span', 'pnombre', p.nombre));
        li.appendChild(nodo('span', 'pcuenta', `${p.sesiones}`));
        proyectos.appendChild(li);
      }
    }

    const aviso = el('aviso');
    if (aviso) {
      const malos = ['opencode', 'claude']
        .map((k) => snap.fuentes && snap.fuentes[k])
        .filter((f) => f && !f.ok);
      const textos = [];
      if (avisoToken) textos.push(avisoToken);
      for (const f of malos) {
        textos.push((f.codigo && i18n.TRADUCCIONES[idioma][f.codigo]) || f.aviso);
      }
      aviso.hidden = textos.length === 0;
      aviso.textContent = textos.join(' · ');
    }

    // El panel sube solo cuando el orden cambió, salvo que el humano haya
    // scrolleado a mano: ahí no se le pisa el scroll.
    if (!scrollManual) {
      try { window.scrollTo(0, 0); } catch { /* sin scroll */ }
    }
  }

  // --- los textos -----------------------------------------------------------

  function pintarTextos() {
    const put = (id, texto) => { const n = el(id); if (n) n.textContent = texto; };
    put('titulo', t('nombre'));
    put('subtitulo', t('subtitulo'));
    put('titulo-activas', t('activas'));
    put('titulo-terminadas', `${t('terminadas')} · ${t('terminadasNota')}`);
    put('titulo-proyectos', t('proyecto'));
    put('et-activas', t('activas'));
    put('et-terminadas', t('terminadas'));
    put('et-agentes', t('agentes'));
    put('et-tokens', t('tokens'));
    put('et-costo', t('costo'));
    put('et-plan', t('plan'));
    put('et-idioma', t('idioma'));
    put('titulo-veredictos', t('veredictos'));
    put('titulo-reparto', t('dondeCae'));
    put('cinta-vivo', t('vivo'));
    put('pausa', pausado ? t('reanudar') : t('pausa'));

    const menu = el('menu');
    if (menu && typeof menu.setAttribute === 'function') menu.setAttribute('aria-label', t('proyectosMenu'));

    const sel = el('idioma');
    if (sel) {
      sel.value = idioma;
      if (!sel.options || !sel.options.length) {
        for (const id of i18n.IDIOMAS) {
          const o = nodo('option', null, id.toUpperCase());
          o.value = id;
          sel.appendChild(o);
        }
      }
    }
  }

  // --- el transporte --------------------------------------------------------

  function pedirEstado() {
    // sin token no se pide nada, pero tampoco se queda mudo: se avisa
    if (!token) {
      avisarToken(t('faltaToken'));
      return;
    }
    // con el ETag el polling repetido no descarga el snapshot entero: el
    // servidor contesta 304 y el panel sigue con lo que tiene. En modo foto
    // no: ahí cada pedido tiene que repintar para que la chispa tenga datos.
    const cabeceras = { 'X-Kraken-Token': token };
    if (ultimoEtag && !modoFoto) cabeceras['If-None-Match'] = ultimoEtag;
    fetch('/api/state', { headers: cabeceras })
      .then((r) => {
        if (r.status === 304) return null;
        if (r.status === 200) {
          const et = r.headers && typeof r.headers.get === 'function' ? r.headers.get('ETag') : null;
          if (et) ultimoEtag = et;
          return r.json();
        }
        // el token viejo ya no sirve: se tira y se dice qué hacer
        if (r.status === 401) tokenRechazado();
        return null;
      })
      .then((snap) => { if (snap) pintar(snap); })
      .catch(() => { /* el panel sigue con lo que tiene */ });
  }

  function abrirSse() {
    if (!token) return;
    if (fuente) { try { fuente.close(); } catch { /* ya estaba */ } }
    fuente = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    fuente.onmessage = (ev) => {
      try { pintar(JSON.parse(ev.data)); } catch { /* frame roto */ }
    };
    fuente.onerror = () => {
      // se cae el SSE: el panel pasa a polling y reintenta el stream
      try { fuente.close(); } catch { /* ya estaba */ }
      fuente = null;
      if (!reloj) {
        reloj = setInterval(pedirEstado, POLL_MS);
        reloj.unref && reloj.unref();
      }
      // sin token no hay stream que reintentar: el polling va a avisar
      if (token) setTimeout(abrirSse, 5000);
    };
  }

  function arrancar() {
    token = tomarToken();
    idioma = tomarIdioma();
    pausado = leer(CLAVE_PAUSA) === '1';
    pintarTextos();
    // sin token el panel queda mudo: mejor un aviso que una pantalla vacía
    if (!token) avisarToken(t('faltaToken'));

    const sel = el('idioma');
    if (sel) {
      sel.addEventListener('change', () => {
        idioma = sel.value;
        guardar(CLAVE_LANG, idioma);
        pintarTextos();
        if (ultimo) pintar(ultimo);
      });
    }

    // Pausa: congela el render sin cortar el stream. El estado vive en el
    // navegador y no sale a ningún lado.
    const botonPausa = el('pausa');
    if (botonPausa) {
      botonPausa.addEventListener('click', () => {
        pausado = !pausado;
        guardar(CLAVE_PAUSA, pausado ? '1' : '0');
        if (typeof botonPausa.setAttribute === 'function') {
          botonPausa.setAttribute('aria-pressed', pausado ? 'true' : 'false');
        }
        pintarTextos();
        if (!pausado && ultimo) pintar(ultimo);
      });
    }

    // El menú abre la columna de proyectos (que en portrait viene cerrada).
    const botonMenu = el('menu');
    const columna = el('columna-proyectos');
    if (botonMenu && columna) {
      botonMenu.addEventListener('click', () => {
        const abierta = columna.classList.contains('mostrar');
        columna.classList.toggle('mostrar', !abierta);
        if (typeof botonMenu.setAttribute === 'function') {
          botonMenu.setAttribute('aria-expanded', abierta ? 'false' : 'true');
        }
      });
    }

    try {
      window.addEventListener('scroll', () => {
        scrollManual = (window.scrollY || 0) > 8;
      }, { passive: true });
    } catch { /* sin scroll */ }

    // en modo foto no queda ningún stream abierto: el navegador headless
    // espera que la página quede quieta y el SSE no se queda quieta nunca.
    if (/[?&]foto=1/.test(location.href)) {
      modoFoto = true;
      try { if (document.body && document.body.classList) document.body.classList.add('foto'); } catch { /* sin body */ }
      pedirEstado();
      for (let i = 1; i <= 3; i++) setTimeout(pedirEstado, 200 * i);
      // el navegador headless a veces queda scrolleado unos píxeles: la
      // foto tiene que salir desde arriba
      setTimeout(() => { try { window.scrollTo(0, 0); } catch { /* sin scroll */ } }, 900);
      return;
    }

    pedirEstado();
    abrirSse();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }

  globalThis.VisorPanel = { pintar, etiquetaEstado, t };
}());
