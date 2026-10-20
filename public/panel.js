// panel.js — el render del HUD.
//
// El snapshot llega por SSE y, si se cae, por polling de /api/state. El token
// entra por la query en la primera carga, se guarda en localStorage y de ahí
// en adelante viaja en el header. Nada de innerHTML: todo es textContent.

(function () {
  'use strict';

  const i18n = globalThis.VisorI18n;
  const CLAVE_TOKEN = 'visor.token';
  const CLAVE_LANG = 'visor.lang';
  const POLL_MS = 2000;

  let idioma = 'es';
  let token = null;
  let fuente = null;
  let reloj = null;
  let ultimo = null;
  let scrollManual = false;

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
      const barra = nodo('div', 'barra');
      const relleno = nodo('div', 'relleno');
      relleno.style.setProperty('ancho', `${s.percent}%`);
      barra.appendChild(relleno);
      card.appendChild(barra);
      card.appendChild(nodo('div', 'pie', `${s.percent}% ${t('plan')} · ${s.paso || 0}/${s.total || 0}`));
    } else {
      const barra = nodo('div', 'barra actividad');
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

  function pintar(snap) {
    ultimo = snap;
    const r = snap.resumen || {};

    const st = (id, valor) => { const n = el(id); if (n) n.textContent = valor; };
    st('st-activas', r.activas || 0);
    st('st-terminadas', r.terminadas || 0);
    st('st-agentes', r.agentesVivos || 0);
    st('st-tokens', numeroBonito((r.tokens || {}).entrada));
    st('st-costo', costoBonito(r.costo));
    st('st-percent', r.percent === null || r.percent === undefined ? '—' : `${r.percent}%`);

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
      if (malos.length) {
        aviso.hidden = false;
        aviso.textContent = malos.map((f) => (f.codigo && i18n.TRADUCCIONES[idioma][f.codigo]) || f.aviso).join(' · ');
      } else {
        aviso.hidden = true;
        aviso.textContent = '';
      }
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
    if (!token) return;
    fetch('/api/state', { headers: { 'X-Visor-Token': token } })
      .then((r) => (r.status === 200 ? r.json() : null))
      .then((snap) => { if (snap) pintar(snap); })
      .catch(() => { /* el panel sigue con lo que tiene */ });
  }

  function abrirSse() {
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
      setTimeout(abrirSse, 5000);
    };
  }

  function arrancar() {
    token = tomarToken();
    idioma = tomarIdioma();
    pintarTextos();

    const sel = el('idioma');
    if (sel) {
      sel.addEventListener('change', () => {
        idioma = sel.value;
        guardar(CLAVE_LANG, idioma);
        pintarTextos();
        if (ultimo) pintar(ultimo);
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
