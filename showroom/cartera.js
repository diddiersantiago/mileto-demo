/* cartera.js — la cartera de la demostracion: plan de pagos, abonos y mora.

   No guarda nada: calcula. De cada unidad reservada o vendida sale un negocio
   con su plan de pagos (separacion, cuotas de la cuota inicial y saldo final),
   y contra ese plan se aplican los abonos, del mas antiguo al mas nuevo.

   - Las unidades que ya venian reservadas o vendidas en el estado de partida no
     tienen historia real, asi que se les fabrica una: fecha de inicio, cliente y
     pagos anteriores salen de su numero, siempre iguales, con unas al dia y
     otras atrasadas. Es lo que deja ver una cartera con mora nada mas abrir.
   - Las que se reservan durante la demo empiezan hoy y sin pagos: la separacion
     queda por cobrar hasta que alguien registre el abono.

   Los abonos registrados en el panel si son estado: viven en el CRM (`CRM.estado.abonos`).
   La tasa de mora es un supuesto de la demostracion, no la de ninguna entidad.
*/
const Cartera = (() => {
  const TASA_MORA_MENSUAL = 0.02;
  const DIA = 86400000;
  const CLIENTES = ["Laura Martínez", "Andrés Pardo", "Camila Rojas", "Julián Torres", "Valentina Gómez", "Santiago León",
    "Mariana Castro", "Felipe Ortiz", "Daniela Suárez", "Nicolás Vargas", "Paula Acosta", "Sebastián Herrera",
    "Carolina Beltrán", "Mateo Duarte", "Juliana Mejía", "Ricardo Salazar", "Natalia Pineda", "Esteban Cárdenas"];
  const ASESORES = ["Ana Torres", "Carlos Rueda", "Diana Peña", "Jorge Ávila"];
  const MEDIOS = ["Transferencia", "PSE", "Consignación", "Tarjeta", "Efectivo"];

  // Un numero entre 0 y 1 que depende solo de la unidad y de para que se pide.
  function azar(numero, sal) {
    let h = 2166136261;
    for (const c of numero + ":" + sal) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  const elegir = (lista, numero, sal) => lista[Math.floor(azar(numero, sal) * lista.length)];
  const sumarMeses = (ms, k) => { const d = new Date(ms); d.setMonth(d.getMonth() + k); return d.getTime(); };

  function plan(precio, fin, inicio) {
    const inicial = precio * fin.inicial / 100, separacion = Math.min(fin.separacion, inicial);
    const cuota = Math.round((inicial - separacion) / fin.meses / 1000) * 1000;
    const cuotas = [{ concepto: "Separación", vence: inicio, valor: separacion }];
    for (let k = 1; k <= fin.meses; k++) {
      cuotas.push({ concepto: `Cuota inicial ${k} de ${fin.meses}`, vence: sumarMeses(inicio, k),
                    valor: k < fin.meses ? cuota : inicial - separacion - cuota * (fin.meses - 1) });
    }
    cuotas.push({ concepto: "Saldo con crédito o recursos propios", vence: sumarMeses(inicio, fin.meses + 1), valor: precio - inicial });
    return cuotas;
  }

  // Los pagos que una unidad del estado de partida "ya traia".
  function historia(numero, vendida, cuotas, hoy) {
    const p = azar(numero, "perfil"), a = azar(numero, "atraso");
    const atrasadas = vendida ? (p < 0.75 ? 0 : p < 0.92 ? 1 + Math.floor(a * 2) : 3 + Math.floor(a * 3))
                              : (p < 0.55 ? 0 : p < 0.82 ? 1 + Math.floor(a * 2) : 3 + Math.floor(a * 3));
    const vencidas = cuotas.filter((c) => c.vence <= hoy).length;
    const pagadas = Math.max(1, vencidas - atrasadas);
    const abonos = [];
    for (let i = 0; i < pagadas; i++) {
      abonos.push({ id: "h" + i, historico: true, valor: cuotas[i].valor, medio: elegir(MEDIOS, numero, "medio" + i),
                    cuando: Math.min(hoy, cuotas[i].vence + Math.floor(azar(numero, "dia" + i) * 5) * DIA) });
    }
    if (atrasadas && pagadas < cuotas.length && azar(numero, "parcial") < 0.4) {
      abonos.push({ id: "hp", historico: true, valor: Math.round(cuotas[pagadas].valor * 0.4 / 1000) * 1000,
                    medio: elegir(MEDIOS, numero, "mediop"), cuando: Math.min(hoy, cuotas[pagadas].vence + 9 * DIA) });
    }
    return abonos;
  }

  function negocio(numero, base, u, registrados, fin, hoy = Date.now()) {
    if (!u || u.estado === "disponible") return null;
    const partida = !u.cuando;
    let inicio = u.cuando;
    if (partida) {
      const d = new Date(hoy);
      d.setHours(12, 0, 0, 0);
      d.setDate(1 + Math.floor(azar(numero, "dia") * 27));
      inicio = sumarMeses(d.getTime(), -(2 + Math.floor(azar(numero, "meses") * (u.estado === "vendido" ? 22 : 12))));
    }
    const cuotas = plan(base.precio, fin, inicio);
    const abonos = (partida ? historia(numero, u.estado === "vendido", cuotas, hoy) : [])
      .concat(registrados || []).sort((x, y) => x.cuando - y.cuando);

    let bolsa = abonos.reduce((s, x) => s + x.valor, 0);
    const pagado = Math.min(bolsa, base.precio);
    const edades = { porVencer: 0, d30: 0, d60: 0, d90: 0, mas: 0 };
    let vencido = 0, interes = 0, diasMora = 0, proximo = null;
    cuotas.forEach((c, i) => {
      c.n = i;
      c.pagado = Math.min(c.valor, bolsa);
      bolsa -= c.pagado;
      c.saldo = c.valor - c.pagado;
      c.dias = c.saldo > 0 && c.vence < hoy ? Math.floor((hoy - c.vence) / DIA) : 0;
      c.estado = c.saldo <= 0 ? "pagada" : c.dias > 0 ? "vencida" : "pendiente";
      if (c.saldo <= 0) return;
      if (c.dias > 0) {
        vencido += c.saldo;
        interes += c.saldo * TASA_MORA_MENSUAL / 30 * c.dias;
        diasMora = Math.max(diasMora, c.dias);
        edades[c.dias <= 30 ? "d30" : c.dias <= 60 ? "d60" : c.dias <= 90 ? "d90" : "mas"] += c.saldo;
      } else {
        edades.porVencer += c.saldo;
        if (!proximo) proximo = c;
      }
    });
    const saldo = base.precio - pagado;
    return { numero, piso: base.piso, tipologia: base.tipologia, precio: base.precio, etapa: u.estado, partida, inicio,
      cliente: u.cliente || elegir(CLIENTES, numero, "cliente"), asesor: u.asesor || elegir(ASESORES, numero, "asesor"),
      cuotas, abonos, pagado, saldo, vencido, interes: Math.round(interes), diasMora, proximo, edades,
      estado: saldo <= 0 ? "paz" : vencido > 0 ? "mora" : "aldia" };
  }

  // Todos los negocios vivos del proyecto.
  function todos(base, crm, fin, hoy = Date.now()) {
    return Object.keys(base).map((n) => negocio(n, base[n], crm.unidades[n], (crm.abonos || {})[n], fin, hoy))
      .filter(Boolean).sort((a, b) => b.vencido - a.vencido || b.saldo - a.saldo);
  }

  function resumen(negocios, hoy = Date.now()) {
    const r = { negocios: negocios.length, valor: 0, pagado: 0, saldo: 0, vencido: 0, interes: 0, enMora: 0,
                edades: { porVencer: 0, d30: 0, d60: 0, d90: 0, mas: 0 }, meses: [], proximos: [] };
    const d = new Date(hoy);
    for (let k = 5; k >= 0; k--) {
      const m = new Date(d.getFullYear(), d.getMonth() - k, 1);
      r.meses.push({ desde: m.getTime(), hasta: new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime(), total: 0,
                     nombre: m.toLocaleDateString("es-CO", { month: "short", year: "2-digit" }) });
    }
    for (const g of negocios) {
      r.valor += g.precio; r.pagado += g.pagado; r.saldo += g.saldo; r.vencido += g.vencido; r.interes += g.interes;
      if (g.estado === "mora") r.enMora++;
      for (const k of Object.keys(r.edades)) r.edades[k] += g.edades[k];
      for (const a of g.abonos) { const m = r.meses.find((x) => a.cuando >= x.desde && a.cuando < x.hasta); if (m) m.total += a.valor; }
      for (const c of g.cuotas) {
        if (c.saldo > 0 && c.vence >= hoy && c.vence < hoy + 30 * DIA) r.proximos.push({ numero: g.numero, cliente: g.cliente, ...c });
      }
    }
    r.proximos.sort((a, b) => a.vence - b.vence);
    return r;
  }

  return { negocio, todos, resumen, MEDIOS, TASA_MORA_MENSUAL };
})();
