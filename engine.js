// Motor de cálculo de tarjetas — réplica de las fórmulas del Excel
(function (root) {
  const D = s => (s instanceof Date ? s : new Date(s + 'T00:00:00Z'));
  const mk = d => d.getUTCFullYear() * 12 + d.getUTCMonth();
  const r15 = x => Number(x.toPrecision(15));
  const r2 = x => Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100;
  const rd0 = x => Math.trunc(r15(x)); // ROUNDDOWN(x,0)

  // fila = {tipo:'' | 'DEBITO' | 'PAGO', desc, monto, fecha:'YYYY-MM-DD', cuotas}
  function calcFila(f, cortes, dolar, hoy) {
    const n = cortes.length, out = [];
    if (!f.desc) return null;
    const fe = D(f.fecha);
    let acum = 0;
    for (let i = 0; i < n; i++) {
      const c = D(cortes[i]);
      let v;
      if (f.tipo === 'DEBITO') {
        const okHoy = i === 0 ? true : hoy >= D(cortes[i - 1]);
        v = (mk(c) >= mk(fe) && okHoy) ? f.monto : 0;
      } else if (f.cuotas === 100) {
        v = f.monto * dolar;
      } else if (i === 0) {
        v = fe <= c ? f.monto / f.cuotas : 0;
      } else if (rd0(f.monto - acum) === 0) {
        v = 0;
      } else {
        v = fe <= c ? f.monto / f.cuotas : 0;
      }
      out.push(v);
      acum += v;
    }
    return out;
  }

  function estadoFila(f, meses, cortes, saldo, hoy) {
    if (!f.desc) return '';
    if (f.tipo === 'DEBITO') return 'ACTIVO';
    let last = -1;
    for (let i = 0; i < meses.length; i++) if (meses[i] !== 0) last = i;
    if (last < 0) return 'ACTIVO';
    if (D(cortes[last]) > hoy) return 'ACTIVO';
    return saldo[last] <= 0 ? 'PAGADO' : 'ACTIVO';
  }

  function calcTarjeta(t, hoy) {
    hoy = D(hoy);
    const filas = t.filas.map(f => ({ ...f, meses: calcFila(f, t.cortes, t.dolar || 0, hoy) }));
    const n = t.cortes.length;
    const gasto = Array(n).fill(0);
    filas.forEach(f => f.meses && f.meses.forEach((v, i) => (gasto[i] += v)));
    const saldo = []; let acc = 0;
    gasto.forEach((g, i) => { acc = r2(acc + g); saldo.push(acc); });
    filas.forEach(f => (f.estado = estadoFila(f, f.meses || [], t.cortes, saldo, hoy)));
    const total = gasto.reduce((a, b) => a + b, 0);
    // próximo corte >= hoy
    let idx = t.cortes.findIndex(c => D(c) >= hoy);
    return { filas, gasto, saldo, total, disponible: t.credito - total,
      idxMes: idx, proxCorte: idx >= 0 ? t.cortes[idx] : null,
      proxPago: idx >= 0 ? t.pagos[idx] : null, gastoMes: idx >= 0 ? gasto[idx] : null };
  }

  const api = { calcFila, estadoFila, calcTarjeta };
  if (typeof module !== 'undefined') module.exports = api; else root.Motor = api;
})(typeof window !== 'undefined' ? window : globalThis);
