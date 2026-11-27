/* app.js — comportamiento de la página: datos en vivo, showroom integrado,
   cotizador, formularios, galería, WhatsApp con contexto y animaciones. */
import { crearCrm } from "./crm.js";
import { iniciarMovimiento, prepararMenu } from "./movimiento.js";

const config = JSON.parse(document.getElementById("config").textContent);
const crm = crearCrm(config);
const $ = (s, raiz = document) => raiz.querySelector(s);
const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];
const quieto = matchMedia("(prefers-reduced-motion: reduce)");
const millones = (v) => "$" + Math.round(v / 1e6).toLocaleString("es-CO") + " millones";
const pesos = (v) => "$" + Math.round(v).toLocaleString("es-CO");
const numeroDeEnlace = Object.fromEntries(Object.entries(config.enlaces).map(([n, h]) => [h, n]));
const urlShowroom = (hash, extra = "") => `${config.showroom.url}${extra}${hash ? "#" + hash : ""}`;

let inventario = null;            // lo último que dijo el CRM
let contexto = "la página";       // lo que la persona estaba viendo (para WhatsApp)
let unidadCotizada = null;
const plan = { inicial: 30, meses: 24, anios: 15, tasa: 12, separacion: 10e6 };
let planTocado = false;

// =========================================================== movimiento y menú
iniciarMovimiento();
prepararMenu();

// Sección visible: alimenta el contexto de WhatsApp.
const nombresSeccion = { inicio: "la portada", proyecto: "el proyecto", ubicacion: "la ubicación", tipologias: "los apartamentos",
  amenidades: "las zonas comunes", financiacion: "la financiación", avance: "el avance de obra", galeria: "la galería",
  preguntas: "las preguntas frecuentes", contacto: "el contacto", "showroom-entrada": "el showroom" };
const vistaSeccion = new IntersectionObserver((entradas) => {
  for (const en of entradas) if (en.isIntersecting) {
    contexto = nombresSeccion[en.target.id] || contexto;
    $$("#menu a").forEach((a) => a.toggleAttribute("aria-current", a.hash === "#" + en.target.id));
  }
}, { rootMargin: "-45% 0px -50% 0px" });
$$("main > section").forEach((s) => vistaSeccion.observe(s));

// =========================================================== inventario en vivo
function pintarInventario(inv) {
  inventario = inv;
  const lista = Object.entries(inv.unidades);
  const libres = lista.filter(([, u]) => u.estado === "disponible");
  const escribe = (clave, texto) => $$(`[data-vivo="${clave}"]`).forEach((el) => { if (el.textContent !== texto) el.textContent = texto; });
  escribe("resumen", `${libres.length} apartamentos disponibles de ${lista.length}` + (inv.origen === "referencia" ? " · datos de referencia" : ""));
  document.body.dataset.origen = inv.origen;

  for (const clave of Object.keys(config.tipologias)) {
    const deTipo = lista.filter(([, u]) => u.tipologia === clave);
    const libresTipo = deTipo.filter(([, u]) => u.estado === "disponible");
    const precios = (libresTipo.length ? libresTipo : deTipo).map(([, u]) => u.precio).filter((v) => typeof v === "number");
    const desde = precios.length ? Math.min(...precios) : NaN;   // el CRM solo da precio de las disponibles
    escribe(`desde-${clave}`, Number.isFinite(desde) ? millones(desde) : "Consultar");
    escribe(`libres-${clave}`, libresTipo.length ? `${libresTipo.length} de ${deTipo.length}` : "Agotado");
    const ul = $(`[data-vivo="lista-${clave}"]`);
    if (ul) {
      ul.replaceChildren(...libresTipo.filter(([n]) => config.enlaces[n]).map(([n, u]) => {
        const li = document.createElement("li"), a = document.createElement("a");
        a.className = "chip"; a.href = urlShowroom(config.enlaces[n]);
        a.dataset.showroom = config.enlaces[n]; a.dataset.contexto = `el apartamento ${n}`;
        a.append(n); const s = document.createElement("small"); s.textContent = `piso ${u.piso}`; a.append(s);
        li.append(a); return li;
      }));
    }
    // el botón principal de la tarjeta lleva a una unidad que siga libre
    const tarjeta = $(`#tipo-${clave} .acciones a[data-showroom]`);
    const primera = libresTipo.find(([n]) => config.enlaces[n]);
    if (tarjeta && primera) { tarjeta.dataset.showroom = config.enlaces[primera[0]]; tarjeta.href = urlShowroom(config.enlaces[primera[0]]);
      tarjeta.dataset.contexto = `el ${config.tipologias[clave].nombre.toLowerCase()} ${primera[0]}`; }
  }

  // opciones del cotizador: solo unidades libres, agrupadas por tipología
  const select = $("#q-unidad"), elegida = select.value;
  select.replaceChildren(...Object.entries(config.tipologias).map(([clave, t]) => {
    const g = document.createElement("optgroup"); g.label = t.nombre;
    for (const [n, u] of libres.filter(([, u]) => u.tipologia === clave)) g.append(new Option(`${n} · piso ${u.piso} · ${millones(u.precio)}`, n));
    return g;
  }).filter((g) => g.children.length));
  if (inv.unidades[elegida] && inv.unidades[elegida].estado === "disponible") select.value = elegida;
  if (inv.financiacion && !planTocado) aplicarPlan(inv.financiacion);
  cotizar();

  const vendidas = lista.length - libres.length, pct = Math.round(100 * vendidas / Math.max(1, lista.length));
  for (const n of Object.keys(config.pisos)) {
    const delPiso = lista.filter(([, u]) => String(u.piso) === n);
    if (!delPiso.length) continue;                     // piso 1: zonas comunes
    const l = delPiso.filter(([, u]) => u.estado === "disponible").length;
    escribe(`piso-${n}`, l ? `${l} de ${delPiso.length} libres` : "Agotado");
  }

  $$('[data-vivo="equilibrio"]').forEach((el) => el.style.setProperty("--pct", pct + "%"));
  escribe("equilibrio-num", `${pct} %`);
  escribe("equilibrio-txt", `${pct} % vendido · meta ${config.punto_equilibrio_pct} %`);
}

async function refrescar() {
  try { pintarInventario(await crm.inventario()); } catch (e) { console.error("No se pudo leer el inventario", e); }
}
refrescar();
setInterval(() => { if (!document.hidden) refrescar(); }, Math.max(15, config.crm.refresco_segundos || 60) * 1000);
crm.escuchar(refrescar);   // eventos del CRM en vivo, o el showroom de este navegador en otra pestaña
document.addEventListener("visibilitychange", () => { if (!document.hidden) refrescar(); });

// =========================================================== selector de pisos sobre la fachada
const franjas = $$(".fachada-interactiva .franja"), filas = $$(".piso-fila"), pisoIr = $("#piso-ir");
let pisoActivo = "7";
function activarPiso(n) {
  pisoActivo = String(n);
  franjas.forEach((f) => f.classList.toggle("activa", f.dataset.piso === pisoActivo));
  filas.forEach((f) => { const si = f.dataset.piso === pisoActivo; f.classList.toggle("activa", si); f.setAttribute("aria-pressed", String(si)); });
  const [titulo, detalle] = config.pisos[pisoActivo] || ["Piso " + pisoActivo, ""];
  $("[data-piso-n]").textContent = pisoActivo.padStart(2, "0");
  $("[data-piso-titulo]").textContent = titulo;
  $("[data-piso-detalle]").textContent = detalle;
  const hash = `piso-${pisoActivo}`;
  pisoIr.dataset.showroom = hash; pisoIr.href = urlShowroom(hash); pisoIr.dataset.contexto = `el piso ${pisoActivo}`;
  $(".txt", pisoIr).textContent = pisoActivo === "1" ? "Ver las zonas comunes en el showroom" : `Ver el piso ${pisoActivo} en el showroom`;
}
franjas.forEach((f) => {
  f.addEventListener("pointerenter", () => activarPiso(f.dataset.piso));
  f.addEventListener("click", () => {
    if (f.dataset.piso !== pisoActivo) { activarPiso(f.dataset.piso); return; }   // en celular: primer toque elige, segundo entra
    contexto = `el piso ${pisoActivo}`; abrirShowroom(`piso-${pisoActivo}`, pisoIr);
  });
});
filas.forEach((f) => { f.addEventListener("click", () => activarPiso(f.dataset.piso)); f.addEventListener("pointerenter", () => activarPiso(f.dataset.piso)); });
activarPiso(pisoActivo);

// =========================================================== tipologías: la foto fija sigue al texto
const tipoFotos = $$("[data-tipo-foto]"), tipoActual = $("[data-tipo-actual]");
const tipoBloques = $$(".tipo-bloques .tipologia");
const vistaTipo = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting) {
    const clave = e.target.id.replace("tipo-", "");
    tipoActual.textContent = String(tipoBloques.indexOf(e.target) + 1).padStart(2, "0");
    for (const f of tipoFotos) {
      const si = f.dataset.tipoFoto === clave;
      if (!si && f.classList.contains("activa")) { f.classList.add("saliendo"); setTimeout(() => f.classList.remove("saliendo"), 1300); }
      f.classList.toggle("activa", si);
    }
  }
}, { rootMargin: "-50% 0px -50% 0px" });
tipoBloques.forEach((b) => vistaTipo.observe(b));

// =========================================================== showroom integrado
const capa = $("#showroom"), marco = $("iframe", capa);
let abiertoDesde = null;

function irDentro(hash) {
  // Si el showroom ya está cargado, se navega sin recargarlo, con su propia interfaz de pruebas.
  let s;
  try { s = marco.contentWindow && marco.contentWindow.__showroom; } catch (e) { s = null; }
  if (!s || !s.estado) return false;
  try {
    s.cerrarCapa();
    const bajar = () => { const v = s.estado().vista; if (v === "estancia") s.cerrarEstancia(); else if (v === "apto") s.cerrarApto(); };
    bajar(); bajar();
    let m;
    if (!hash) { if (s.estado().vista === "planta") s.volverAFachada(); return true; }
    if ((m = hash.match(/^piso-(\d)$/))) {
      s.estado().vista === "fachada" ? s.entrarPiso(Number(m[1])) : s.mostrarPlano(Number(m[1]));
      return true;
    }
    if ((m = hash.match(/^(apto-\d-\d+)(?:-([\w-]+))?$/)) && numeroDeEnlace[m[1]]) {
      s.irAUnidad(numeroDeEnlace[m[1]]);
      if (m[2]) s.abrirEstancia(m[2]);
      return true;
    }
  } catch (e) { console.warn("Navegación interna del showroom falló; se recarga.", e); }
  return false;
}

function abrirShowroom(hash = "", desde = null, empujar = true) {
  abiertoDesde = desde || document.activeElement;
  if (!marco.getAttribute("src")) {
    marco.src = urlShowroom(hash);
  } else if (!irDentro(hash)) {
    marco.src = urlShowroom(hash, `?ir=${Date.now().toString(36)}`);
  }
  const yaAbierto = capa.open;
  if (!yaAbierto) capa.showModal();
  document.body.classList.add("con-showroom");
  // si ya estaba abierto se reemplaza la entrada: «atrás» siempre cierra el showroom
  if (empujar) history[yaAbierto ? "replaceState" : "pushState"]({ showroom: hash }, "", "#showroom" + (hash ? "/" + hash : ""));
  marco.focus({ preventScroll: true });
}
function cerrarShowroom(desdeHistoria = false) {
  if (!capa.open) return;
  capa.close();
  document.body.classList.remove("con-showroom");
  if (!desdeHistoria && history.state && "showroom" in history.state) history.back();
  if (abiertoDesde && abiertoDesde.focus) abiertoDesde.focus({ preventScroll: true });
  refrescar();
}
marco.addEventListener("load", () => capa.classList.add("cargado"));
capa.addEventListener("cancel", (ev) => { ev.preventDefault(); cerrarShowroom(); });
$("[data-cerrar]", capa).addEventListener("click", () => cerrarShowroom());
addEventListener("popstate", (ev) => {
  const h = ev.state && "showroom" in ev.state ? ev.state.showroom : null;
  if (h === null) cerrarShowroom(true); else abrirShowroom(h, null, false);
});

document.addEventListener("click", (ev) => {
  const a = ev.target.closest("[data-showroom]");
  if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
  ev.preventDefault();
  if (a.closest("#visor")) cerrarVisor();
  if (a.dataset.contexto) contexto = a.dataset.contexto;
  abrirShowroom(a.dataset.showroom, a);
});
// enlace directo: /web/#showroom/apto-4-2 (al cargar o al pegarlo en la barra con la página abierta)
function abrirDesdeHash() {
  const m = location.hash.match(/^#showroom(?:\/([\w-]+))?$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  abrirShowroom(m[1] || "");
}
abrirDesdeHash();
addEventListener("hashchange", abrirDesdeHash);

// =========================================================== WhatsApp con contexto
function textoWhatsapp() {
  const marca = config.marca.nombre;
  let lugar = contexto, ref = contexto;
  if (capa.open) {
    try {
      const e = marco.contentWindow.__showroom.estado();
      if (e.abierto) {
        // el showroom da el número dentro del piso ("02"); la unidad es piso + número ("202")
        const numero = /^\d+$/.test(e.abierto.numero) ? `${e.abierto.piso}${e.abierto.numero}` : e.abierto.numero;
        const u = inventario && inventario.unidades[numero];
        const t = config.tipologias[e.abierto.tipologia];
        lugar = `el apartamento ${numero}` + (t ? ` (${t.nombre.toLowerCase()}, piso ${e.abierto.piso}` + (u ? `, ${millones(u.precio)}` : "") + ")" : "");
        if (e.estancia) {
          const titulo = marco.contentDocument.getElementById("e-titulo");
          const nombre = titulo ? titulo.textContent.split("·")[0].trim().toLowerCase() : e.estancia;
          lugar += `, en la vista 360° de ${nombre}`;
        }
        ref = `showroom/${numero}`;
      } else if (e.vista === "planta") { lugar = `la planta del piso ${e.pisoEnPlanta}`; ref = `showroom/piso-${e.pisoEnPlanta}`; }
      else { lugar = "la fachada del edificio"; ref = "showroom"; }
      return `Hola, estoy en el showroom virtual de ${marca} viendo ${lugar}. ¿Me pueden dar más información? [web · ${ref}]`;
    } catch (e) { /* showroom aún cargando */ }
  }
  if (unidadCotizada && contexto === "la financiación") {
    const c = calcular(unidadCotizada.precio);
    return `Hola, coticé el apartamento ${unidadCotizada.numero} de ${marca} en la página: cuota inicial del ${plan.inicial} % ` +
      `(${pesos(c.inicial)}) en ${plan.meses} meses y crédito a ${plan.anios} años. ¿Me confirman las condiciones? [web · cotizador/${unidadCotizada.numero}]`;
  }
  return `Hola, estoy en la página de ${marca} viendo ${lugar}. ¿Me pueden dar más información? [web · ${ref}]`;
}
function prepararWhatsapp(ev) {
  const a = ev.target.closest("[data-whatsapp]");
  if (!a) return;
  // demo pública: el simulador del agente recibe el mismo mensaje que llegaría a WhatsApp
  a.href = config.agente ? `${config.agente.url}?mensaje=${encodeURIComponent(textoWhatsapp())}&origen=web`
    : `https://wa.me/${config.contacto.whatsapp}?text=${encodeURIComponent(textoWhatsapp())}`;
}
document.addEventListener("pointerdown", prepararWhatsapp);
document.addEventListener("click", prepararWhatsapp, true);
document.addEventListener("keydown", (ev) => { if (ev.key === "Enter") prepararWhatsapp(ev); }, true);

// =========================================================== cotizador
function aplicarPlan(f) {
  Object.assign(plan, f);
  for (const k of ["inicial", "meses", "anios", "tasa"]) { const el = $(`#q-${k}`); if (el && f[k] != null) el.value = f[k]; }
}
function calcular(precio) {                       // misma cuenta que el cotizador del showroom
  const inicial = precio * plan.inicial / 100;
  const separacion = Math.min(plan.separacion, inicial);
  const credito = precio - inicial;
  const i = Math.pow(1 + plan.tasa / 100, 1 / 12) - 1, n = plan.anios * 12;
  const cuota = i > 0 ? credito * i / (1 - Math.pow(1 + i, -n)) : credito / n;
  return { precio, inicial, separacion, cuotaObra: (inicial - separacion) / plan.meses, credito, cuota, ingresos: cuota / 0.30 };
}
function cotizar() {
  for (const k of ["inicial", "meses", "anios", "tasa"]) plan[k] = Number($(`#q-${k}`).value);
  $("#q-inicial-txt").value = `${plan.inicial} %`;
  $("#q-meses-txt").value = `${plan.meses} meses`;
  $("#q-anios-txt").value = `${plan.anios} años`;
  $("#q-tasa-txt").value = `${String(plan.tasa).replace(".", ",")} %`;
  const n = $("#q-unidad").value, u = inventario && inventario.unidades[n];
  if (!u) return;
  unidadCotizada = { numero: n, ...u };
  const c = calcular(u.precio);
  for (const [k, v] of Object.entries(c)) { const dd = $(`[data-q="${k}"]`); if (dd) dd.textContent = pesos(v); }
  const ver = $("#q-ver");
  if (ver && config.enlaces[n]) { ver.dataset.showroom = config.enlaces[n]; ver.href = urlShowroom(config.enlaces[n]); ver.dataset.contexto = `el apartamento ${n}`; }
}
$("#cotizador").addEventListener("input", (ev) => {
  if (ev.target.type === "range") planTocado = true;
  if (ev.target.matches("#q-unidad, input[type=range]")) cotizar();
});
$$("[data-cotizar]").forEach((b) => b.addEventListener("click", () => {
  const clave = b.dataset.cotizar;
  const libre = inventario && Object.entries(inventario.unidades).find(([, u]) => u.tipologia === clave && u.estado === "disponible");
  if (libre) { $("#q-unidad").value = libre[0]; cotizar(); }
  $("#financiacion").scrollIntoView({ behavior: quieto.matches ? "auto" : "smooth" });
  setTimeout(() => $("#q-unidad").focus({ preventScroll: true }), quieto.matches ? 0 : 600);
}));

// =========================================================== formularios
const utm = Object.fromEntries([...new URLSearchParams(location.search)].filter(([k]) => k.startsWith("utm_")));
function datosDe(form) {
  const d = Object.fromEntries(new FormData(form));
  d.consentimiento = form.elements.consentimiento.checked;
  for (const k of Object.keys(d)) if (typeof d[k] === "string") d[k] = d[k].trim();
  return d;
}
function revisar(form) {
  let primero = null;
  for (const el of form.elements) {
    if (!el.willValidate) continue;
    let ok = el.checkValidity();
    if (ok && el.type === "tel") ok = el.value.replace(/\D/g, "").length >= 10;
    el.toggleAttribute("aria-invalid", !ok);
    if (!ok && !primero) primero = el;
  }
  if (primero) {
    primero.focus();
    const msg = primero.type === "checkbox" ? "Necesitamos tu autorización para contactarte."
      : primero.type === "tel" ? "Revisa el número de celular." : primero.type === "email" ? "Revisa el correo."
      : "Completa los campos marcados.";
    return msg;
  }
  return null;
}
async function enviar(form, accion, exito) {
  const estado = $(".estado-form", form), boton = $("button[type=submit]", form);
  const error = revisar(form);
  estado.className = "estado-form";
  if (error) { estado.textContent = error; estado.classList.add("mal"); return; }
  boton.disabled = true; estado.textContent = "Enviando…";
  try {
    const r = await accion(datosDe(form));
    estado.textContent = exito; estado.classList.add("bien");
    form.reset(); form.dataset.ultimo = r.id || "";
    if (form.id === "cotizador") { aplicarPlan(plan); cotizar(); }
  } catch (e) {
    estado.innerHTML = "";
    estado.append("No pudimos registrar tus datos. ");
    const a = document.createElement("a"); a.href = `https://wa.me/${config.contacto.whatsapp}`; a.dataset.whatsapp = ""; a.target = "_blank"; a.rel = "noopener";
    a.textContent = "Escríbenos por WhatsApp"; estado.append(a, ".");
    estado.classList.add("mal");
    console.error(e);
  } finally { boton.disabled = false; }
}
const comun = () => ({ pagina: location.href.split("#")[0], utm, contexto });
$("#form-contacto").addEventListener("submit", (ev) => {
  ev.preventDefault();
  enviar(ev.target, (d) => crm.registrarInteresado({ formulario: "contacto", ...d, ...comun() }),
    config.mensajes.contacto);
});
$("#form-visita").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target;
  enviar(f, async (d) => {
    const r = await crm.agendarVisita({ formulario: "visita", ...d, ...comun() });
    const dia = new Date(d.fecha + "T12:00:00").toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
    f.dataset.confirmacion = `${dia} a las ${d.hora}`;
    return r;
  }, config.mensajes.visita.replace("{cuando}", "día elegido")).then(() => {
    const est = $(".estado-form", f);
    if (est.classList.contains("bien")) est.textContent = config.mensajes.visita.replace("{cuando}", f.dataset.confirmacion);
    horas();
  });
});
$("#cotizador").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const n = $("#q-unidad").value, u = inventario && inventario.unidades[n];
  enviar(ev.target, (d) => crm.registrarInteresado({
    formulario: "cotizacion", nombre: d.nombre, telefono: d.telefono, correo: d.correo, consentimiento: d.consentimiento,
    unidad: n, tipologia: u && u.tipologia,
    cotizacion: (() => {
      const c = calcular(u ? u.precio : 0);
      return { precio: c.precio, pct_inicial: plan.inicial, cuota_inicial: Math.round(c.inicial), separacion: Math.round(c.separacion),
        meses_cuota_inicial: plan.meses, cuota_mensual_obra: Math.round(c.cuotaObra), saldo_credito: Math.round(c.credito),
        credito_anios: plan.anios, credito_tasa_ea: plan.tasa, cuota_credito: Math.round(c.cuota), ingresos_sugeridos: Math.round(c.ingresos) };
    })(),
    ...comun(),
  }), config.mensajes.cotizacion.replace("{unidad}", n));
});

// visita: días y horas según el horario de la sala
const fecha = $("#form-visita [name=fecha]"), hora = $("#form-visita [name=hora]");
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
{ const hoy = new Date(); const man = new Date(hoy); man.setDate(hoy.getDate() + 1); const tope = new Date(hoy); tope.setDate(hoy.getDate() + 60);
  fecha.min = iso(man); fecha.max = iso(tope); }
async function horas() {
  if (!fecha.value) { hora.replaceChildren(new Option("Elige el día primero", "")); return; }
  const lista = await crm.franjasDeVisita(fecha.value);
  hora.replaceChildren(new Option(lista.length ? "Elige la hora" : "Sin horas libres ese día", ""), ...lista.map((h) => new Option(h, h)));
}
fecha.addEventListener("change", horas);

// pestañas de contacto (patrón de pestañas accesible)
const pestanas = $$('[role="tab"]');
function elegirPestana(p, foco = false) {
  for (const t of pestanas) {
    const si = t === p;
    t.setAttribute("aria-selected", String(si)); t.tabIndex = si ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !si;
  }
  p.closest(".pestanas").classList.toggle("segunda", pestanas.indexOf(p) === 1);
  if (foco) p.focus();
}
pestanas.forEach((p, i) => {
  p.addEventListener("click", () => elegirPestana(p));
  p.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    elegirPestana(pestanas[(i + (ev.key === "ArrowRight" ? 1 : pestanas.length - 1)) % pestanas.length], true);
  });
});
$$("[data-pestana]").forEach((a) => a.addEventListener("click", () => elegirPestana($(`#pes-${a.dataset.pestana}`))));

// =========================================================== visor (galería y plantas)
const visor = $("#visor"), visorImg = $("img", visor), visorTxt = $("figcaption span", visor), visor360 = $("figcaption a", visor);
let fotos = $$("[data-visor]"), actual = 0, visorDesde = null;
function mostrar(img, titulo, hash, alt) {
  visorImg.src = `img/${img}-1920.webp`;
  visorImg.alt = alt || titulo;
  visorTxt.textContent = titulo;
  visor360.hidden = !hash;
  if (hash) { visor360.dataset.showroom = hash; visor360.href = urlShowroom(hash); visor360.dataset.contexto = titulo.toLowerCase(); }
}
function abrirVisor(i) {
  actual = (i + fotos.length) % fotos.length;
  const b = fotos[actual];
  visor.classList.remove("planta");
  mostrar(b.dataset.img, b.dataset.titulo, b.dataset.hash);
  $$(".visor-paso", visor).forEach((x) => (x.hidden = false));
  if (!visor.open) { visorDesde = document.activeElement; visor.showModal(); }
}
function cerrarVisor() { if (visor.open) { visor.close(); visorDesde && visorDesde.focus({ preventScroll: true }); } }
fotos.forEach((b, i) => b.addEventListener("click", () => abrirVisor(i)));
$$("[data-paso]", visor).forEach((b) => b.addEventListener("click", () => abrirVisor(actual + Number(b.dataset.paso))));
$("[data-cerrar]", visor).addEventListener("click", cerrarVisor);
visor.addEventListener("click", (ev) => { if (ev.target === visor) cerrarVisor(); });
visor.addEventListener("keydown", (ev) => {
  if (visor.classList.contains("planta")) return;
  if (ev.key === "ArrowRight") abrirVisor(actual + 1);
  if (ev.key === "ArrowLeft") abrirVisor(actual - 1);
});
$$("[data-planta]").forEach((b) => b.addEventListener("click", () => {
  const clave = b.dataset.planta, t = config.tipologias[clave];
  const a = $(`#tipo-${clave} .acciones a[data-showroom]`);
  visor.classList.add("planta");
  mostrar(t.planta, `Planta ${t.nombre.toLowerCase()} · ${String(t.interior_m2).replace(".", ",")} m² privados`, a && a.dataset.showroom,
    `Planta en perspectiva del ${t.nombre.toLowerCase()}`);
  visor360.firstChild.textContent = "Recorrer en el showroom ";
  $$(".visor-paso", visor).forEach((x) => (x.hidden = true));
  visorDesde = b; visor.showModal();
}));
visor.addEventListener("close", () => { visor360.firstChild.textContent = "Ver en 360° "; });

// Para pruebas desde la consola o un script.
window.__mileto = { crm, abrirShowroom, cerrarShowroom, textoWhatsapp, calcular, plan, refrescar, inventario: () => inventario };
