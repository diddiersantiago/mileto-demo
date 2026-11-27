/* crm.js — el ÚNICO punto por donde la página habla con el CRM.

   La página nunca hace fetch al CRM por su cuenta: usa estas cuatro funciones.

     inventario()             -> { unidades: {numero: {piso, tipologia, precio, estado, area_m2}}, financiacion, actualizado, origen }
     registrarInteresado(d)   -> { id }   formulario de contacto y de cotización
     agendarVisita(d)         -> { id }   formulario de visita
     franjasDeVisita(fecha)   -> ["09:00", "10:00", ...]  horas libres de ese día

   Dos implementaciones con la misma forma:

   - CRM real (config.crm.base con la dirección del CRM, p. ej. http://localhost:8000).
     Usa la API pública /api/v1 del CRM (crm/backend/app/api_publica.py):
       GET  /api/v1/unidades        inventario con estado en vivo (precio solo en las disponibles) y ultimo_evento
       GET  /api/v1/proyecto        plan de pagos para el cotizador
       GET  /api/v1/eventos?desde=  flujo de eventos (text/event-stream) para refrescar al instante
       POST /api/v1/interesados     contacto y cotización
       POST /api/v1/visitas         visita a la sala (si el CRM aún no lo tiene, se registra
                                    como interesado con la fecha y hora en el mensaje)
       GET  /api/v1/visitas/franjas?fecha=AAAA-MM-DD   horas libres (si no existe, se usa el
                                    horario de web/proyecto.json)
     Detalle y formatos en web/README.md.
   - Doble local (config.crm.base vacío). Lee el inventario de partida
     (showroom/sitio/datos.json) y le aplica los cambios de estado que el
     showroom haya hecho en este navegador (su CRM simulado guarda el estado en
     localStorage "mileto-crm-v1"), así web y showroom muestran lo mismo.
     Los formularios quedan en localStorage "mileto-web-interesados-v1".

   Si el CRM real no responde, el inventario cae al doble local (marcado como
   origen "referencia"); los formularios NO caen en silencio: devuelven error
   para que la persona sepa que no llegó y pueda escribir por WhatsApp.
*/

const ESTADOS = { disponible: "disponible", apartado: "reservado", reservado: "reservado", vendido: "vendido" };
const CLAVE_SHOWROOM = "mileto-crm-v1";
const CLAVE_INTERESADOS = "mileto-web-interesados-v1";
const ESPERA_MS = 6000;

export function crearCrm(config) {
  const base = (config.crm.base || "").replace(/\/$/, "");
  const real = Boolean(base);
  let respaldo = null;

  async function pedir(ruta, opciones = {}) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), ESPERA_MS);
    try {
      const r = await fetch(base + ruta, {
        ...opciones, signal: control.signal,
        headers: { Accept: "application/json", ...(opciones.body ? { "Content-Type": "application/json" } : {}) },
      });
      if (!r.ok) throw new Error(`El CRM respondió ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(reloj);
    }
  }

  // ------------------------------------------------------------ doble local
  async function inventarioLocal() {
    if (!respaldo) respaldo = await fetch(config.crm.datos_locales).then((r) => r.json());
    const unidades = {};
    for (const [n, u] of Object.entries(respaldo.unidades)) {
      unidades[n] = { piso: u.piso, tipologia: u.tipologia, precio: u.precio, estado: ESTADOS[u.estado] || u.estado,
        area_m2: (config.tipologias[u.tipologia] || {}).interior_m2 || null };
    }
    try {   // lo que el showroom cambió en este navegador manda sobre el fichero de partida
      const vivo = JSON.parse(localStorage.getItem(CLAVE_SHOWROOM) || "null");
      for (const [n, u] of Object.entries((vivo && vivo.unidades) || {})) {
        if (unidades[n] && u && u.estado) unidades[n].estado = ESTADOS[u.estado] || u.estado;
      }
    } catch (e) { /* sin estado guardado */ }
    return { unidades, financiacion: respaldo.financiacion || null, actualizado: new Date().toISOString() };
  }

  function leerInteresados() {
    try { return JSON.parse(localStorage.getItem(CLAVE_INTERESADOS) || "[]"); } catch (e) { return []; }
  }

  function guardarLocal(tipo, datos) {
    const registro = { id: `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, tipo,
      recibido: new Date().toISOString(), ...datos };
    const lista = leerInteresados();
    lista.unshift(registro);
    localStorage.setItem(CLAVE_INTERESADOS, JSON.stringify(lista.slice(0, 200)));
    return { id: registro.id };
  }

  function horasDelDia(fecha) {
    const d = new Date(fecha + "T12:00:00");
    if (Number.isNaN(d.getTime())) return [];
    const dia = (d.getDay() + 6) % 7;                  // 0 = lunes, como en el CRM
    const franjas = config.contacto.horario[String(dia)] || [];
    const horas = [];
    for (const [abre, cierra] of franjas) for (let h = abre; h < cierra; h++) horas.push(String(h).padStart(2, "0") + ":00");
    const ocupadas = new Set(leerInteresados().filter((x) => x.tipo === "visita" && x.fecha === fecha).map((x) => x.hora));
    return horas.filter((h) => !ocupadas.has(h));
  }

  function validar(d, campos) {
    for (const c of campos) if (!String(d[c] || "").trim()) throw new Error(`Falta el campo ${c}`);
    if (String(d.telefono || "").replace(/\D/g, "").length < 10) throw new Error("El celular no parece válido");
    if (!d.consentimiento) throw new Error("Falta la autorización de tratamiento de datos");
  }

  // ------------------------------------------------------------ CRM real
  let plan = null;
  async function planDelCrm() {
    if (plan) return plan;
    try {
      const p = (await pedir("/api/v1/proyecto")).plan_pagos || {};
      plan = { inicial: p.pct_inicial, meses: p.n_cuotas, anios: p.credito_anios, tasa: p.credito_tasa_ea, separacion: p.separacion };
      for (const k of Object.keys(plan)) if (plan[k] == null) delete plan[k];
    } catch (e) { plan = {}; }
    return plan;
  }

  // La forma de POST /api/v1/interesados (modelo `Interesado` del CRM).
  function aInteresado(d) {
    const c = d.cotizacion;
    const resumenPlan = c ? `Cotizó: ${c.pct_inicial} % de cuota inicial en ${c.meses_cuota_inicial} meses ` +
      `(cuota de $${c.cuota_mensual_obra.toLocaleString("es-CO")}), crédito a ${c.credito_anios} años al ${c.credito_tasa_ea} % E.A. ` +
      `(cuota estimada $${c.cuota_credito.toLocaleString("es-CO")})` : null;
    const mensaje = [d.mensaje, d.tipologia && `Le interesa: ${(config.tipologias[d.tipologia] || {}).nombre || d.tipologia}`,
      d.contexto && `Estaba viendo ${d.contexto}`, `Formulario: ${d.formulario || "contacto"}`].filter(Boolean).join(". ");
    const cuerpo = {
      nombre: d.nombre, telefono: d.telefono, email: d.correo || null, unidad: d.unidad || null,
      plan: resumenPlan ? resumenPlan.slice(0, 300) : null, mensaje: mensaje.slice(0, 1000), origen: "web",
      campana: (d.utm && (d.utm.utm_campaign || d.utm.utm_source)) || null, acepta_tratamiento_datos: Boolean(d.consentimiento),
    };
    return pedir("/api/v1/interesados", { method: "POST", body: JSON.stringify(cuerpo) })
      .then((r) => ({ id: r.lead_id ?? r.id ?? null }));
  }

  // Id del último evento antes de la foto de /unidades: /eventos?desde=<id> entrega solo lo posterior.
  let ultimoEvento = null, avisarFoto;
  const primeraFoto = new Promise((ok) => { avisarFoto = ok; });

  // ------------------------------------------------------------ interfaz
  return {
    modo: real ? "crm" : "local",

    async inventario() {
      if (real) {
        try {
          const [r, proyecto] = await Promise.all([pedir("/api/v1/unidades"), planDelCrm()]);
          const unidades = {};
          for (const u of r.unidades || []) {
            unidades[String(u.numero)] = { piso: u.piso, tipologia: u.tipologia, precio: u.precio ?? null,
              estado: ESTADOS[u.estado] || u.estado, area_m2: u.area_privada_m2 ?? null };
          }
          if (r.ultimo_evento != null) ultimoEvento = r.ultimo_evento;
          avisarFoto();
          return { unidades, financiacion: proyecto, resumen: r.resumen || null, actualizado: new Date().toISOString(), origen: "crm" };
        } catch (e) {
          console.warn("CRM sin respuesta; se muestran los datos de referencia.", e.message);
          avisarFoto();
          return { ...(await inventarioLocal()), origen: "referencia" };
        }
      }
      return { ...(await inventarioLocal()), origen: "local" };
    },

    async registrarInteresado(datos) {
      validar(datos, ["nombre", "telefono"]);
      const cuerpo = { origen: "web", ...datos };
      if (real) return aInteresado(datos);
      return guardarLocal(datos.formulario || "contacto", cuerpo);
    },

    async agendarVisita(datos) {
      validar(datos, ["nombre", "telefono", "fecha", "hora"]);
      const cuerpo = { origen: "web", ...datos };
      if (real) {
        try { return await pedir("/api/v1/visitas", { method: "POST", body: JSON.stringify(cuerpo) }); }
        catch (e) {
          if (!/ (404|405)$/.test(e.message)) throw e;            // el CRM todavía no agenda: va como interesado
          return aInteresado({ ...datos, mensaje: `Quiere visitar la sala de ventas el ${datos.fecha} a las ${datos.hora}.` });
        }
      }
      if (!horasDelDia(datos.fecha).includes(datos.hora)) throw new Error("Esa hora ya no está libre");
      return guardarLocal("visita", cuerpo);
    },

    async franjasDeVisita(fecha) {
      if (real) {
        try { return (await pedir(`/api/v1/visitas/franjas?fecha=${encodeURIComponent(fecha)}`)).franjas || []; }
        catch (e) { return horasDelDia(fecha); }
      }
      return horasDelDia(fecha);
    },

    // Avisa cuando cambia el inventario: eventos del CRM en vivo, o el showroom de este navegador.
    escuchar(alCambiar) {
      if (real && "EventSource" in window) {
        // se abre después de la primera foto, para pedir solo lo que pase desde ahí;
        // al reengancharse el navegador manda Last-Event-ID, que manda sobre «desde»
        const espera = Promise.race([primeraFoto, new Promise((ok) => setTimeout(ok, 8000))]);
        espera.then(() => {
          const desde = ultimoEvento != null ? `?desde=${encodeURIComponent(ultimoEvento)}` : "";
          const flujo = new EventSource(`${base}/api/v1/eventos${desde}`);
          flujo.addEventListener("unidad", () => alCambiar());
        });
        return;
      }
      addEventListener("storage", (ev) => { if (ev.key === CLAVE_SHOWROOM) alCambiar(); });
    },

    // Solo el doble local: para revisar en la consola lo que han dejado los formularios.
    interesados: leerInteresados,
  };
}
