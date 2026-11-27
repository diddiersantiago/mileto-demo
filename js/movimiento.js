/* movimiento.js — todo lo que se mueve en la página.
   Reglas: solo transform, opacity y clip-path; los valores se acotan; nada corre
   en bucle cuando no hay scroll ni puntero; con «reducir movimiento» no se anima
   nada (los estilos ya muestran todo en su sitio). */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const acotar = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fino = matchMedia("(hover: hover) and (pointer: fine)").matches;
const escritorio = () => innerWidth > 900;
const raiz = document.documentElement;

// ============================================================ precarga y entrada
// La hoja de Google Fonts carga sin bloquear; la precarga espera a que llegue y a que
// la letra de los títulos esté lista, para que «MILETO» no aparezca con otra fuente.
function fuentesListas() {
  if (!document.fonts) return Promise.resolve();
  const hoja = document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis"]');
  const cargar = () => document.fonts.load('300 100px "Cormorant Garamond"').catch(() => {});
  if (!hoja || hoja.sheet && hoja.media === "all") return cargar();
  return new Promise((ok) => { hoja.addEventListener("load", ok, { once: true }); hoja.addEventListener("error", ok, { once: true }); }).then(cargar);
}
function entrada() {
  const pre = $(".precarga");
  const listo = () => {
    document.body.classList.add("entrada-lista");
    try { sessionStorage.setItem("mileto-visto", "1"); } catch (e) { /* modo privado */ }
  };
  if (quieto || raiz.classList.contains("visto-antes") || !pre) { requestAnimationFrame(listo); pre && pre.remove(); return; }
  const cifra = $("[data-precarga]", pre), linea = $(".precarga-linea", pre);
  const hero = $(".inicio-img");
  const esperas = [
    fuentesListas(),
    hero && !hero.complete ? new Promise((ok) => { hero.addEventListener("load", ok, { once: true }); hero.addEventListener("error", ok, { once: true }); }) : Promise.resolve(),
    new Promise((ok) => setTimeout(ok, 1000)),               // lo justo para ver el trazo
  ];
  let real = 0, mostrado = 0, hechas = 0, fin = false;
  esperas.forEach((p) => p.then(() => { hechas++; real = hechas / esperas.length; }));
  const terminar = () => {
    if (fin) return;
    fin = true; clearTimeout(tope);
    cifra.textContent = "100"; linea.style.setProperty("--p", "1");
    setTimeout(() => { pre.classList.add("fuera"); listo(); }, 180);
    setTimeout(() => pre.remove(), 1400);
  };
  const tope = setTimeout(terminar, 4500);                     // nunca bloquea más de 4,5 s, aunque la pestaña vaya lenta
  let t0 = performance.now();
  const paso = (t = performance.now()) => {
    const dt = Math.min(250, t - t0); t0 = t;                  // por tiempo, no por cuadros: igual en un celular lento
    mostrado += (Math.max(real, mostrado + 0.004 * dt / 16.7) - mostrado) * (1 - Math.pow(0.88, dt / 16.7));
    if (real >= 1 && mostrado > 0.985) mostrado = 1;
    const p = Math.min(mostrado, real >= 1 ? 1 : 0.94);
    cifra.textContent = Math.round(p * 100);
    linea.style.setProperty("--p", p.toFixed(3));
    if (fin) return;
    if (p >= 1) { terminar(); return; }
    requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

// ============================================================ títulos palabra por palabra
function partirTitulos() {
  let k = 0;
  for (const h of $$("[data-lineas]")) {
    k = 0;
    const partir = (nodo) => {
      for (const n of [...nodo.childNodes]) {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((t) => {
            if (!t) return;
            if (/^\s+$/.test(t)) { frag.append(" "); return; }
            const pal = document.createElement("span"), dentro = document.createElement("span");
            pal.className = "pal"; dentro.textContent = t; dentro.style.setProperty("--k", k++);
            pal.append(dentro); frag.append(pal);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && !n.classList.contains("pal")) partir(n);
      }
    };
    if (!h.getAttribute("aria-label")) h.setAttribute("aria-label", h.textContent.trim());
    partir(h);
    $$(".pal", h).forEach((p) => p.setAttribute("aria-hidden", "true"));
  }
}

// ============================================================ revelados al entrar en pantalla
function revelados() {
  // Un elemento recortado del todo con clip-path no cuenta como visible para el observador:
  // las imágenes con cortina se vigilan a través de su contenedor.
  const destino = new Map();
  const ver = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) {
      for (const el of destino.get(e.target) || []) { el.classList.add("visto"); if (el.matches("[data-contar]")) contar(el); }
      ver.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -10% 0px", threshold: 0.12 });
  for (const el of $$("[data-revela], [data-revela-img], [data-lineas], [data-pie], [data-contar]")) {
    const testigo = el.matches("[data-revela-img]") ? el.parentElement : el;
    if (!destino.has(testigo)) destino.set(testigo, []);
    destino.get(testigo).push(el);
    ver.observe(testigo);
  }
}
function contar(el) {
  const fin = parseFloat(el.dataset.contar);
  if (!Number.isFinite(fin) || quieto) return;
  const texto = el.textContent, m = texto.match(/[\d.,]+/);
  if (!m) return;
  const decimales = (m[0].split(/[.,]/)[1] || "").length;
  const antes = texto.slice(0, m.index), despues = texto.slice(m.index + m[0].length);
  const desde = fin >= 1000 ? fin - 28 : 0, t0 = performance.now(), dur = 1800;
  const paso = (t) => {
    const p = acotar((t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
    const v = desde + (fin - desde) * e;
    el.textContent = antes + v.toLocaleString("es-CO", { minimumFractionDigits: decimales, maximumFractionDigits: decimales, useGrouping: fin >= 10000 }) + despues;
    if (p < 1) requestAnimationFrame(paso); else el.textContent = texto;
  };
  requestAnimationFrame(paso);
}

// ============================================================ escenas atadas al scroll
// Cada escena lee su caja y escribe variables CSS; solo corren las que están en pantalla.
const escenas = [];
const enPantalla = new Set();
const vigia = new IntersectionObserver((es) => { for (const e of es) e.isIntersecting ? enPantalla.add(e.target) : enPantalla.delete(e.target); pedir(); }, { rootMargin: "20% 0px" });
function escena(el, fn) { if (!el) return; escenas.push([el, fn]); vigia.observe(el); }
let pedido = false;
function pedir() { if (!pedido) { pedido = true; requestAnimationFrame(correr); } }
function correr() {
  pedido = false;
  const alto = innerHeight;
  for (const [el, fn] of escenas) if (enPantalla.has(el)) fn(el.getBoundingClientRect(), alto, el);
}
const progresoFijo = (caja, alto) => acotar(-caja.top / Math.max(1, caja.height - alto));   // 0…1 mientras la sección está fijada

function escenasDeScroll() {
  // portada: la fachada se acerca y el texto se va
  const inicio = $("#inicio"), texto = $(".inicio-texto");
  let tocado = false;
  escena(inicio, (c, alto) => {
    const p = acotar(-c.top / alto);
    if (!tocado && p > 0.01) { tocado = true; document.body.classList.add("scrolleando"); }
    inicio.style.setProperty("--zoom", (1.04 + p * 0.16).toFixed(4));
    texto.style.opacity = (1 - p * 1.5).toFixed(3);
    texto.style.transform = `translate3d(0, ${(-p * 90).toFixed(1)}px, 0)`;
  });

  // manifiesto: las palabras se encienden al leer
  const mani = $("[data-encender]");
  if (mani) {
    const palabras = $$(".w", mani);
    escena(mani, (c, alto) => {
      const p = acotar((alto * 0.86 - c.top) / (c.height + alto * 0.36));
      const n = Math.round(p * palabras.length);
      palabras.forEach((w, i) => w.classList.toggle("on", i < n));
    });
  }

  // showroom: el marco se abre hasta ocupar la pantalla
  const banda = $(".banda-showroom");
  escena(banda, (c, alto) => {
    const p = progresoFijo(c, alto), e = 1 - Math.pow(1 - acotar(p / 0.55), 3);
    const s = banda.style;
    s.setProperty("--cy", (22 * (1 - e)).toFixed(2) + "%");
    s.setProperty("--cx", ((escritorio() ? 30 : 8) * (1 - e)).toFixed(2) + "%");
    s.setProperty("--cr", (6 * (1 - e)).toFixed(1) + "px");
    s.setProperty("--cs", (1.25 - 0.25 * e).toFixed(4));
    s.setProperty("--cv", acotar((p - 0.35) / 0.25).toFixed(3));
    s.setProperty("--ct", acotar((p - 0.45) / 0.3).toFixed(3));
  });

  // galería: en escritorio avanza de lado
  const gal = $(".galeria-seccion"), pista = $(".galeria-pista"), barra = $(".galeria-progreso");
  if (gal && pista) {
    let recorrido = 0;
    const medir = () => {
      const si = escritorio() && !quieto;
      gal.classList.toggle("galeria-horizontal", si);
      if (!si) { gal.style.height = ""; pista.style.removeProperty("--gx"); return; }
      recorrido = Math.max(0, pista.scrollWidth - innerWidth);
      gal.style.height = `${innerHeight + recorrido}px`;
    };
    medir(); addEventListener("resize", () => { medir(); pedir(); });
    addEventListener("load", medir);
    pista.addEventListener("scroll", () => barra.style.setProperty("--gp", (pista.scrollLeft / Math.max(1, pista.scrollWidth - pista.clientWidth)).toFixed(3)), { passive: true });
    escena(gal, (c, alto) => {
      if (!gal.classList.contains("galeria-horizontal")) return;
      const p = progresoFijo(c, alto);
      pista.style.setProperty("--gx", `${(-p * recorrido).toFixed(1)}px`);
      barra.style.setProperty("--gp", p.toFixed(4));
    });
  }

  // línea de tiempo del avance
  const linea = $(".linea-tiempo");
  escena(linea, (c, alto) => linea.style.setProperty("--lp", acotar((alto * 0.62 - c.top) / c.height).toFixed(3)));

  addEventListener("scroll", pedir, { passive: true });
  addEventListener("resize", pedir);
  pedir();
}

// ============================================================ cabecera: se esconde al bajar y cambia de tono
function cabecera() {
  const cab = $("#cabecera"), alto = () => cab.offsetHeight;
  const secciones = $$("main > section[data-tono], footer[data-tono]");
  let ultimo = scrollY, pendiente = false;
  const mirar = () => {
    pendiente = false;
    const y = scrollY, abierto = document.body.classList.contains("menu-abierto");
    if (!abierto) cab.classList.toggle("escondida", y > ultimo && y > innerHeight * 0.9 && y - ultimo > 2);
    if (y < ultimo - 2 || y < 80) cab.classList.remove("escondida");
    ultimo = y;
    const bajo = secciones.find((s) => { const c = s.getBoundingClientRect(); return c.top <= alto() / 2 && c.bottom > alto() / 2; });
    if (bajo && cab.dataset.tono !== bajo.dataset.tono) cab.dataset.tono = bajo.dataset.tono;
    const portada = bajo && (bajo.id === "inicio" || bajo.id === "showroom-entrada");
    cab.classList.toggle("con-fondo", !portada && y > 40);
  };
  addEventListener("scroll", () => { if (!pendiente) { pendiente = true; requestAnimationFrame(mirar); } }, { passive: true });
  mirar();
}

// ============================================================ menú a pantalla completa
export function prepararMenu() {
  const boton = $(".abre-menu"), menu = $("#menu");
  let temporizador = 0;
  const poner = (abrir) => {
    clearTimeout(temporizador);
    boton.setAttribute("aria-expanded", String(abrir));
    boton.setAttribute("aria-label", abrir ? "Cerrar menú" : "Abrir menú");
    $(".abre-menu-t", boton).textContent = abrir ? "Cerrar" : "Menú";
    document.body.classList.toggle("menu-abierto", abrir);
    document.body.classList.toggle("bloqueado", abrir);
    $("main").inert = abrir;
    if (abrir) {
      menu.hidden = false;
      void menu.offsetWidth;                 // fija el estado cerrado antes de abrir: así la cortina sí transiciona
      menu.classList.add("abierto");
      setTimeout(() => { const a = $("a", menu); a && a.focus({ preventScroll: true }); }, quieto ? 0 : 450);
    } else {
      menu.classList.remove("abierto");
      temporizador = setTimeout(() => { menu.hidden = true; }, quieto ? 0 : 900);
    }
  };
  boton.addEventListener("click", () => poner(boton.getAttribute("aria-expanded") !== "true"));
  $$("a", menu).forEach((a) => a.addEventListener("click", () => poner(false)));
  addEventListener("keydown", (ev) => { if (ev.key === "Escape" && document.body.classList.contains("menu-abierto")) { poner(false); boton.focus(); } });
  return poner;
}

// ============================================================ cursor con etiqueta y botones magnéticos
function cursor() {
  if (!fino || quieto) return;
  const c = $(".cursor"), txt = $(".cursor-texto", c);
  raiz.classList.add("cursor-on");
  c.classList.add("oculto");   // hasta que se mueva el ratón
  let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y, vivo = false;
  const paso = () => {
    cx += (x - cx) * 0.2; cy += (y - cy) * 0.2;
    c.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
    if (Math.abs(x - cx) + Math.abs(y - cy) > 0.3) requestAnimationFrame(paso); else vivo = false;
  };
  addEventListener("pointermove", (ev) => {
    if (ev.pointerType !== "mouse") return;
    x = ev.clientX; y = ev.clientY;
    c.classList.remove("oculto");
    if (!vivo) { vivo = true; requestAnimationFrame(paso); }
  }, { passive: true });
  document.addEventListener("pointerover", (ev) => {
    const el = ev.target.closest("[data-cursor]");
    c.classList.toggle("grande", !!el);
    if (el) txt.textContent = el.dataset.cursor;
    c.classList.toggle("oculto", !!ev.target.closest("dialog, iframe, input, select, textarea"));
  });
  document.addEventListener("pointerleave", () => c.classList.add("oculto"));
  document.addEventListener("mouseleave", () => c.classList.add("oculto"));
}
function magneticos() {
  if (!fino || quieto) return;
  for (const el of $$("[data-magnetico]")) {
    el.addEventListener("pointermove", (ev) => {
      const r = el.getBoundingClientRect();
      const dx = acotar((ev.clientX - r.left - r.width / 2) * 0.25, -12, 12), dy = acotar((ev.clientY - r.top - r.height / 2) * 0.35, -8, 8);
      el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
    });
    el.addEventListener("pointerleave", () => { el.style.transform = ""; });
  }
}

// ============================================================ scroll suave con la rueda (solo escritorio)
function scrollSuave() {
  if (!fino || quieto) return;
  let meta = scrollY, actual = scrollY, corriendo = false, t0 = 0;
  const tope = () => document.documentElement.scrollHeight - innerHeight;
  const bloqueado = () => document.body.classList.contains("bloqueado") || document.querySelector("dialog[open]");
  addEventListener("wheel", (ev) => {
    if (ev.ctrlKey || ev.defaultPrevented || bloqueado() || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
    if (ev.target.closest && ev.target.closest("select, textarea, .menu, [data-sin-suave]")) return;
    ev.preventDefault();
    const d = ev.deltaMode === 1 ? ev.deltaY * 40 : ev.deltaMode === 2 ? ev.deltaY * innerHeight : ev.deltaY;
    if (!corriendo) { meta = actual = scrollY; }
    meta = acotar(meta + d, 0, tope());
    if (!corriendo) { corriendo = true; t0 = performance.now(); requestAnimationFrame(paso); }
  }, { passive: false });
  function paso(t) {
    const dt = Math.min(64, t - t0); t0 = t;
    actual += (meta - actual) * (1 - Math.pow(1 - 0.11, dt / 16.7));
    if (Math.abs(meta - actual) < 0.5) actual = meta;
    window.scrollTo(0, actual);
    if (actual !== meta) requestAnimationFrame(paso); else corriendo = false;
  }
  // teclado, barra o un enlace: se toma la posición nueva como punto de partida
  addEventListener("scroll", () => { if (!corriendo) meta = actual = scrollY; }, { passive: true });
  document.addEventListener("click", (ev) => { if (ev.target.closest("a[href^='#']")) { corriendo = false; } }, true);
}

// ============================================================ preguntas: abren y cierran con su altura
function acordeon() {
  for (const d of $$(".acordeon details")) {
    const s = $("summary", d);
    s.addEventListener("click", (ev) => {
      if (quieto) return;
      ev.preventDefault();
      if (d.open) {
        d.classList.add("cerrando");
        setTimeout(() => { d.open = false; d.classList.remove("cerrando"); }, 650);
      } else {
        d.classList.add("cerrando"); d.open = true;
        void d.offsetHeight;
        requestAnimationFrame(() => d.classList.remove("cerrando"));
      }
    });
  }
}

export function iniciarMovimiento() {
  partirTitulos();
  entrada();
  revelados();
  escenasDeScroll();
  cabecera();
  cursor();
  magneticos();
  scrollSuave();
  acordeon();
  if (quieto) $$("[data-revela], [data-revela-img], [data-lineas], [data-pie]").forEach((el) => el.classList.add("visto"));
}
