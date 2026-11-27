/* Reproductor de la demo grabada, para el sitio estático (sin servidor, sin CRM, sin IA).
 *
 * Reemplaza `fetch` solo para las rutas del simulador (sim/..., api/...). Cada acción del guion
 * (reiniciar, mensaje del cliente, mensaje de la asesora, adelantar el reloj) avanza la cinta, y
 * `sim/estado` devuelve el último estado que el servidor real había devuelto a ese mismo tiempo
 * desde la acción. Así se ven los mismos tiempos, el "escribiendo…" y el relevo de la corrida
 * grabada. Una acción que no está en la grabación se rechaza con una explicación: no se inventan
 * respuestas. Lo exporta `python agente/exportar_estatico.py`, junto con grabacion.js.
 */
(function () {
  "use strict";
  const G = window.GRABACION;
  if (!G || !Array.isArray(G.acciones) || !G.acciones.length) return;
  const acciones = G.acciones;
  const NOTA = "En la demo en línea la conversación está grabada; en vivo la atiende el agente conectado al CRM.";
  let actual = -1, t0 = 0;

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {status, headers: {"Content-Type": "application/json"}});

  function estadoActual() {
    const pasado = performance.now() - t0;
    for (let k = Math.max(actual, 0); k >= 0; k--) {
      const estados = acciones[k].estados || [];
      const vistos = k === actual ? estados.filter(([dt]) => dt <= pasado) : estados;
      if (vistos.length) return vistos[vistos.length - 1][1];
      if (k === 0 && estados.length) return estados[0][1];
    }
    return null;
  }

  const fetchReal = window.fetch.bind(window);
  window.fetch = async (url, op) => {
    const m = new URL(String(url), location.href).pathname.match(/\/((?:sim|api)\/.*)$/);
    if (!m) return fetchReal(url, op);
    const ruta = m[1];
    if (op && op.method === "POST") {
      if (ruta === "sim/reiniciar") { actual = 0; t0 = performance.now(); return json(acciones[0].respuesta || {ok: true}); }
      // La siguiente acción grabada tiene que ser esta misma: la cinta no se salta ni se inventa pasos
      const sig = acciones[actual + 1];
      if (actual >= 0 && sig && sig.ruta === ruta) { actual += 1; t0 = performance.now(); return json(sig.respuesta || {ok: true}); }
      return json({detail: NOTA}, 409);
    }
    if (ruta === "sim/estado") { const e = estadoActual(); return e ? json(e) : json({detail: NOTA}, 404); }
    if (ruta === "sim/telefono") return json({telefono: (acciones[0].respuesta || {}).telefono});
    if (ruta === "sim/marca") return json(G.marca || {});
    return json({detail: NOTA}, 404);
  };
})();
