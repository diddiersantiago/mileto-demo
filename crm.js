/* crm.js — el enlace del showroom (y del panel) con el CRM de la demostracion.

   Una sola interfaz, dos maneras de estar "en vivo":

   - Con `scripts/servidor_showroom.py` el estado vive en el servidor y cada
     cambio llega por un flujo de eventos a todas las paginas abiertas, en
     cualquier equipo de la red.
   - Sin el (la pagina publicada como sitio estatico) el estado vive en este
     navegador: `localStorage` lo guarda y `BroadcastChannel` lo reparte entre
     las pestanas. Sigue siendo instantaneo, pero solo dentro del mismo navegador.

   Quien usa esto no nota la diferencia: `CRM.cambiar(...)` y `CRM.alCambiar(...)`.
   El dia que haya un CRM de verdad, es este fichero el que cambia.
*/
const CRM = (() => {
  const CLAVE = "mileto-crm-v1";
  const ESTADOS = ["disponible", "apartado", "vendido"];
  let modo = "local", enLinea = false, serie = 0;
  let estado = { unidades: {}, eventos: [] };
  const oyentes = [], deConexion = [];
  const canal = "BroadcastChannel" in window ? new BroadcastChannel(CLAVE) : null;

  const avisar = (ev) => oyentes.forEach((f) => { try { f(ev); } catch (e) { console.error(e); } });
  const conexion = (si) => { enLinea = si; deConexion.forEach((f) => f(si, modo)); };
  const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (e) { /* sin sitio */ } };

  function recibir(ev) {
    if (ev.tipo === "reinicio") {
      estado = completo(ev.estado);
    } else if (ev.tipo === "vista") {
      estado.vistas[ev.numero] = ev.total;
    } else if (ev.tipo === "interesado") {
      if (estado.interesados.some((x) => x.id === ev.id && x.cuando === ev.cuando)) return;
      estado.interesados.unshift(ev);
      estado.interesados.length = Math.min(estado.interesados.length, 200);
    } else if (ev.tipo === "abono") {
      const lista = estado.abonos[ev.numero] || (estado.abonos[ev.numero] = []);
      if (lista.some((x) => x.id === ev.id)) return;
      lista.push(ev);
    } else if (ev.tipo === "abono_anulado") {
      estado.abonos[ev.numero] = (estado.abonos[ev.numero] || []).filter((x) => x.id !== ev.id);
    } else if (ev.tipo === "cambio") {
      if (estado.eventos.some((x) => x.id === ev.id && x.cuando === ev.cuando)) return;   // ya lo tenia
      if (ev.estado === "disponible") delete estado.abonos[ev.numero];
      estado.unidades[ev.numero] = { estado: ev.estado, cliente: ev.cliente, asesor: ev.asesor, cuando: ev.cuando };
      estado.eventos.unshift(ev);
      estado.eventos.length = Math.min(estado.eventos.length, 200);
    }
    avisar(ev);
  }

  // Un estado guardado por una version anterior puede no traer consultas ni interesados.
  const completo = (e) => { e.vistas = e.vistas || {}; e.interesados = e.interesados || []; e.abonos = e.abonos || {}; return e; };

  function deBase(base) {
    const unidades = {};
    for (const [n, u] of Object.entries(base)) unidades[n] = { estado: u.estado, cliente: null, asesor: null, cuando: null };
    return { unidades, eventos: [], vistas: {}, interesados: [], abonos: {} };
  }

  // Lo que no cambia el estado de una unidad: una consulta o un interesado.
  async function enviar(ruta, cuerpo, local) {
    if (modo === "servidor") {
      const r = await fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      return r.ok ? (await r.json()).evento : null;
    }
    const ev = local();
    recibir(ev);
    guardar();
    if (canal) canal.postMessage(ev);
    return ev;
  }

  function ver(numero) {
    if (!estado.unidades[numero]) return Promise.resolve(null);
    return enviar("api/crm/vista", { numero },
      () => ({ tipo: "vista", numero, total: (estado.vistas[numero] || 0) + 1 })).catch(() => null);
  }

  // Un pago a la cartera de una unidad reservada o vendida, y su anulacion.
  function abonar(numero, datos) {
    const valor = Math.round(Number(datos.valor));
    const u = estado.unidades[numero];
    if (!u || u.estado === "disponible" || !(valor > 0)) return Promise.resolve(null);
    return enviar("api/crm/abono", { numero, valor, medio: datos.medio, nota: datos.nota },
      () => ({ tipo: "abono", id: ++serie, cuando: Date.now(), numero, valor,
               medio: datos.medio || "Transferencia", nota: datos.nota || null }));
  }

  function anularAbono(numero, id) {
    return enviar("api/crm/abono/anular", { numero, id }, () => ({ tipo: "abono_anulado", numero, id }));
  }

  function interesado(datos) {
    const nombre = String(datos.nombre || "").trim(), telefono = String(datos.telefono || "").trim();
    if (!estado.unidades[datos.numero] || !nombre || !telefono) return Promise.resolve(null);
    return enviar("api/crm/interesado", { ...datos, nombre, telefono },
      () => ({ tipo: "interesado", id: ++serie, cuando: Date.now(), numero: datos.numero, nombre, telefono,
               plan: datos.plan || null, origen: datos.origen || "showroom" }));
  }

  async function conectar(base) {
    try {
      const r = await fetch("api/crm", { cache: "no-store" });
      if (!r.ok) throw new Error("sin servidor");
      estado = completo(await r.json());
      modo = "servidor";
      const flujo = new EventSource("api/crm/flujo");
      flujo.onopen = () => conexion(true);
      flujo.onerror = () => conexion(false);          // el navegador reintenta solo
      flujo.onmessage = (m) => recibir(JSON.parse(m.data));
    } catch (e) {
      modo = "local";
      let guardado = null;
      try { guardado = JSON.parse(localStorage.getItem(CLAVE) || "null"); } catch (x) { /* corrupto */ }
      const mismas = guardado && Object.keys(guardado.unidades || {}).length === Object.keys(base).length;
      estado = mismas ? completo(guardado) : deBase(base);
      serie = estado.eventos.concat(estado.interesados, ...Object.values(estado.abonos))
        .reduce((m, x) => Math.max(m, x.id || 0), 0);
      if (canal) canal.onmessage = (m) => { recibir(m.data); guardar(); };
      // Sin BroadcastChannel, el propio almacenamiento avisa a las otras pestanas.
      window.addEventListener("storage", (m) => {
        if (m.key !== CLAVE || !m.newValue || canal) return;
        estado = completo(JSON.parse(m.newValue));
        avisar({ tipo: "reinicio", estado });
      });
      conexion(true);
    }
    return estado;
  }

  async function cambiar(numero, nuevo, extra = {}) {
    if (!ESTADOS.includes(nuevo) || !estado.unidades[numero]) return null;
    if (modo === "servidor") {
      const r = await fetch("api/crm/cambio", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero, estado: nuevo, ...extra }) });
      return r.ok ? (await r.json()).evento : null;     // el aviso llega por el flujo, como a todos
    }
    const antes = estado.unidades[numero].estado;
    if (antes === nuevo) return null;
    const libre = nuevo === "disponible";
    const ev = { tipo: "cambio", id: ++serie, cuando: Date.now(), numero, estado: nuevo, antes,
                 cliente: libre ? null : (extra.cliente || null), asesor: libre ? null : (extra.asesor || null),
                 origen: extra.origen || "crm" };
    recibir(ev);
    guardar();
    if (canal) canal.postMessage(ev);
    return ev;
  }

  async function reiniciar(base) {
    if (modo === "servidor") {
      await fetch("api/crm/reiniciar", { method: "POST" });
      return;
    }
    const ev = { tipo: "reinicio", estado: deBase(base) };
    serie = 0;
    recibir(ev);
    guardar();
    if (canal) canal.postMessage(ev);
  }

  return {
    conectar, cambiar, reiniciar, ver, interesado, abonar, anularAbono,
    alCambiar: (f) => oyentes.push(f),
    alConectar: (f) => { deConexion.push(f); f(enLinea, modo); },
    get modo() { return modo; },
    get enLinea() { return enLinea; },
    get estado() { return estado; },
    cuenta() {
      const c = { disponible: 0, apartado: 0, vendido: 0 };
      for (const u of Object.values(estado.unidades)) c[u.estado] = (c[u.estado] || 0) + 1;
      return c;
    },
  };
})();
