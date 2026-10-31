/* Mis Tarjetas: app con usuarios, nube y uso sin internet */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var sb = window.supabase.createClient(window.APP_CONFIG.url, window.APP_CONFIG.key,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

  // ---------- utilidades ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('es-AR'); }
  function fd(s) { return s ? s.split('-').reverse().join('/') : '—'; }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hoyISO() { return iso(new Date()); }
  function addMonths(s, n) {
    var p = s.split('-').map(Number), y = p[0], m = p[1] - 1 + n, d = p[2];
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var ult = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(Math.min(d, ult)).padStart(2, '0');
  }
  function addDays(s, n) {
    var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function diffDays(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function toast(m) {
    var d = document.createElement('div'); d.className = 'toast'; d.textContent = m;
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2800);
  }
  function dosPasos(btn, txt, fn) {
    var t;
    btn.addEventListener('click', function () {
      if (btn.dataset.ok) { clearTimeout(t); btn.textContent = btn.dataset.txt; delete btn.dataset.ok; fn(); return; }
      btn.dataset.txt = btn.textContent; btn.dataset.ok = 1; btn.textContent = txt;
      t = setTimeout(function () { btn.textContent = btn.dataset.txt; delete btn.dataset.ok; }, 4000);
    });
  }
  function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function num(v) {
    var s = String(v).trim();
    if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return parseFloat(s);
  }

  // id fijo a partir de un texto: dos equipos que cierran el mismo resumen generan el mismo id
  function idFijo(txt) {
    var out = '';
    for (var k = 0; k < 4; k++) {
      var h = 0x811c9dc5 ^ (k * 0x9e3779b1);
      for (var i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); h ^= h >>> 13; }
      out += ('00000000' + (h >>> 0).toString(16)).slice(-8);
    }
    return out.slice(0, 8) + '-' + out.slice(8, 12) + '-5' + out.slice(13, 16) + '-a' + out.slice(17, 20) + '-' + out.slice(20, 32);
  }
  function r2(x) { return Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100; }

  // ---------- estado local ----------
  var user = null, S = null, actual = null, filtro = 'ACTIVO', mesSel = null, editId = null, syncing = false, syncTimer = null;
  function nuevoEstado() { return { tarjetas: [], gastos: [], out: { t: {}, g: {}, dt: [] } }; }
  function clave() { return 'mt_estado_' + user.id; }
  function guardar() { try { localStorage.setItem(clave(), JSON.stringify(S)); } catch (e) { } }
  function cargar() {
    try { var s = localStorage.getItem(clave()); if (s) { var o = JSON.parse(s); o.out = o.out || { t: {}, g: {}, dt: [] }; o.out.dt = o.out.dt || []; return o; } } catch (e) { }
    return nuevoEstado();
  }
  function marcarT(t) { t.updated_at = new Date().toISOString(); S.out.t[t.id] = Date.now() + Math.random(); guardar(); pedirSync(); }
  function marcarG(g) { g.updated_at = new Date().toISOString(); S.out.g[g.id] = Date.now() + Math.random(); guardar(); pedirSync(); }
  function tarjetaActual() { return S.tarjetas.filter(function (t) { return t.id === actual; })[0]; }
  function gastosDe(tid) { return S.gastos.filter(function (g) { return g.tarjeta_id === tid && !g.eliminado; }); }

  // ---------- cortes: se extienden solos ----------
  function extender(t, hoy) {
    var cambio = false;
    if (!t.cortes.length) return false;
    var meta = addMonths(hoy, 8);
    var n = 0;
    while (t.cortes[t.cortes.length - 1] < meta && n < 60) {
      var uc = t.cortes[t.cortes.length - 1], up = t.pagos[t.pagos.length - 1] || uc;
      var dias = diffDays(uc, up);
      var nuevo = addMonths(uc, 1);
      t.cortes.push(nuevo); t.pagos.push(addDays(nuevo, dias)); cambio = true; n++;
    }
    return cambio;
  }
  function motor(t) {
    return Motor.calcTarjeta({
      credito: t.credito, dolar: t.dolar || 0, cortes: t.cortes, pagos: t.pagos,
      filas: gastosDe(t.id).map(function (g) { return { tipo: g.tipo || '', desc: g.descripcion, monto: Number(g.monto), fecha: g.fecha, cuotas: Number(g.cuotas) }; })
    }, hoyISO());
  }

  // ---------- cargos automáticos (solo estimación) y cierre de resumen ----------
  var REG_CARGO = /dif[ef]?erenc|impuest|interes|comis|cargo|mantenim/i;
  function cfgDe(t) {
    var c = t.config || {};
    return { mant: Number(c.mant) || 0, iva: (c.iva === undefined || c.iva === '' || c.iva === null) ? 21 : Number(c.iva), sello: Number(c.sello) || 0, desde: c.desde || '' };
  }
  function desdeEf(t) {
    var c = cfgDe(t); if (c.desde) return c.desde;
    var h = hoyISO(), u = null; t.cortes.forEach(function (x) { if (x <= h) u = x; });
    return u || t.cortes[0];
  }
  function esPago(g) { return g.tipo === 'PAGO' || (Number(g.monto) < 0 && Number(g.cuotas) === 1 && /pago/i.test(g.descripcion || '')); }
  function comprasMes(t, r, i) {
    var gs = gastosDe(t.id), s = 0;
    r.filas.forEach(function (f, k) {
      if (!f.meses) return; var g = gs[k];
      if (esPago(g) || REG_CARGO.test(g.descripcion || '')) return;
      if (f.meses[i] > 0) s += f.meses[i];
    });
    return s;
  }
  function estimarCargos(t, r, i) {
    var c = cfgDe(t); if (!(c.mant || c.sello) || i < 0) return null;
    if (t.cortes[i] < desdeEf(t)) return null;
    var compras = comprasMes(t, r, i), iva = c.mant * c.iva / 100, sello = compras * c.sello / 100;
    return { compras: compras, mant: c.mant, iva: iva, sello: sello, total: c.mant + iva + sello };
  }

  function tarjetaMasLejana() {
    var best = null;
    S.tarjetas.forEach(function (t) { if (!t.cortes.length) return; var r = motor(t); if (r.proxCorte && (!best || r.proxCorte > best.c)) best = { id: t.id, c: r.proxCorte }; });
    return best;
  }

  // texto "cuota 4 de 12" para un gasto, mirando el mes i
  function cuotaTxt(g, f, i) {
    var n = Number(g.cuotas);
    if (g.tipo === 'DEBITO') return 'Débito automático';
    if (g.tipo === 'PAGO') return 'Pago';
    if (n === 100) return 'USD mensual';
    if (!(n > 1)) return '1 pago';
    var idx = []; (f.meses || []).forEach(function (v, j) { if (v !== 0) idx.push(j); });
    if (!idx.length) return n + ' cuotas';
    var k = idx.filter(function (j) { return j <= i; }).length;
    if (k === 0) return n + ' cuotas · empieza en ' + nombreMes(idx[0]);
    if ((f.meses[i] || 0) === 0 && k === idx.length) return 'terminó · ' + k + ' de ' + n;
    return 'cuota ' + k + ' de ' + n + (k >= n ? ' · última' : '');
  }
  var tActualRender = null;
  function nombreMes(j) { var c = tActualRender.cortes[j]; return MESES[+c.slice(5, 7) - 1] + ' ' + c.slice(2, 4); }

  // ---------- pantalla principal ----------
  var MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  function render() {
    var hoy = hoyISO();
    $('hoy').textContent = 'Hoy: ' + fd(hoy);
    var best = null;
    S.tarjetas.forEach(function (t) { if (!t.cortes.length) return; var r = motor(t); if (r.proxCorte && (!best || r.proxCorte > best.c)) best = { n: t.nombre, c: r.proxCorte }; });
    $('banner').innerHTML = best ? 'Tarjeta con el corte más lejano: <b>' + esc(best.n) + '</b><br>corta el ' + fd(best.c) + ' · conviene usar esta' : 'Agregá una tarjeta para empezar';
    var ord = S.tarjetas.slice().sort(function (a, b) { return (a.orden - b.orden) || (a.nombre < b.nombre ? -1 : 1); });
    if (!tarjetaActual() && ord.length) actual = ord[0].id;
    $('tabs').innerHTML = ord.map(function (t) { return '<button class="tab' + (t.id === actual ? ' on' : '') + '" data-id="' + esc(t.id) + '">' + esc(t.nombre) + '</button>'; }).join('');
    var t = tarjetaActual();
    $('vacio').hidden = !!t; $('detalle').hidden = !t; $('nuevo').hidden = !t;
    if (!t) return;
    var r = motor(t); tActualRender = t;
    var iv = (mesSel != null && mesSel < t.cortes.length) ? mesSel : r.idxMes;
    $('resumen').innerHTML = [['Crédito total', fmt(t.credito)], ['Disponible', fmt(r.disponible)],
      ['Gasto del mes', r.gastoMes == null ? '—' : fmt(r.gastoMes)], ['Próx. corte', fd(r.proxCorte)],
      ['Próx. vencimiento', fd(r.proxPago)], ['Total a pagar (acumulado)', fmt(r.total)]]
      .map(function (p) { return '<div class="k"><small>' + p[0] + '</small><b>' + p[1] + '</b></div>'; }).join('');
    var est = r.idxMes >= 0 ? estimarCargos(t, r, r.idxMes) : null;
    $('estim').hidden = !est;
    if (est) $('estim').innerHTML = 'Cargos estimados del próximo resumen: <b>' + fmt(est.total) + '</b><span class="sub">mantenimiento ' + fmt(est.mant) + ' + IVA ' + fmt(est.iva) + ' + sello ' + fmt(est.sello) + ' (sobre compras de ' + fmt(est.compras) + '). Solo es una estimación: no cambia ningún saldo. Se confirma con “Cerrar resumen”.</span>';
    var pagarIdx = -1;
    for (var i = 0; i < r.saldo.length; i++) { if (t.cortes[i] <= hoy && r.saldo[i] > 0) { pagarIdx = i; break; } }
    $('meses').innerHTML = t.cortes.map(function (c, i) {
      var m = MESES[+c.slice(5, 7) - 1] + ' ' + c.slice(2, 4);
      return '<div class="mes' + (i === pagarIdx ? ' pagar' : '') + (mesSel === i ? ' sel' : '') + '" data-i="' + i + '"><small>' + m + (i === pagarIdx ? ' · A PAGAR' : '') + '</small><b class="' + (r.saldo[i] > 0 ? 'deb' : 'fav') + '">' + fmt(r.saldo[i]) + '</b>' +
        '<span class="sub">corte ' + fd(c).slice(0, 5) + '<br>vence ' + fd(t.pagos[i]).slice(0, 5) + '</span></div>';
    }).join('');
    var m = $('meses').children, k = pagarIdx >= 0 ? pagarIdx : Math.max(0, r.idxMes);
    if (m[k]) $('meses').scrollLeft = m[k].offsetLeft - 16;
    $('fAct').classList.toggle('on', filtro === 'ACTIVO'); $('fTod').classList.toggle('on', filtro === 'TODOS'); $('fMes').classList.toggle('on', filtro === 'MES');
    var gs = gastosDe(t.id), enMes = filtro === 'MES' && iv >= 0;
    $('fMes').textContent = (mesSel != null && iv >= 0) ? nombreMes(iv) : 'Del mes';
    var items = r.filas.map(function (f, i) { return { f: f, g: gs[i] }; });
    if (enMes) {
      items = items.filter(function (x) { return x.f.meses && x.f.meses[iv] !== 0 && x.f.meses[iv] !== undefined; })
        .sort(function (a, b) { return b.f.meses[iv] - a.f.meses[iv]; });
      var comp = 0, pag = 0, nc = 0;
      items.forEach(function (x) { var v = x.f.meses[iv]; if (esPago(x.g)) pag += v; else { comp += v; if (Number(x.g.cuotas) > 1 && Number(x.g.cuotas) !== 100) nc++; } });
      $('resMes').hidden = false;
      $('resMes').innerHTML = '<b>' + nombreMes(iv) + '</b> · corte ' + fd(t.cortes[iv]) + ' · vence ' + fd(t.pagos[iv]) +
        '<br>Gastos del mes: <b>' + fmt(comp) + '</b>' + (nc ? ' (' + nc + ' en cuotas)' : '') +
        (pag ? '<br>Pagos cargados en ese corte: ' + fmt(pag) : '') +
        '<br><span class="sub">Saldo acumulado a ese corte: ' + fmt(r.saldo[iv]) + '</span>';
    } else {
      $('resMes').hidden = true;
      items = items.filter(function (x) { return filtro === 'TODOS' || x.f.estado !== 'PAGADO'; })
        .sort(function (a, b) { return a.g.fecha < b.g.fecha ? 1 : (a.g.fecha > b.g.fecha ? -1 : 0); });
    }
    var vi = iv >= 0 ? iv : 0;
    $('lista').innerHTML = items.length ? items.map(function (x) {
      var g = x.g, cuota = iv >= 0 ? (x.f.meses[iv] || 0) : 0;
      var sub = cuotaTxt(g, x.f, vi);
      return '<div class="row" data-id="' + esc(g.id) + '"><div><div class="d">' + esc(g.descripcion) + '</div><div class="m">' + fd(g.fecha) + ' · ' + sub + '</div></div>' +
        '<div class="r"><div class="d ' + (g.monto < 0 ? 'fav' : '') + '">' + (enMes ? fmt(cuota) : fmt(Number(g.monto))) + '</div><div class="m">' + (enMes ? (Number(g.cuotas) > 1 && Number(g.cuotas) !== 100 ? 'total ' + fmt(Number(g.monto)) : '') : 'mes: ' + fmt(cuota)) + '</div>' +
        '<span class="tag ' + (x.f.estado === 'PAGADO' ? 'pag' : '') + '">' + x.f.estado + '</span></div></div>';
    }).join('') : '<div class="empty">No hay gastos para mostrar</div>';
  }
  function setEstado(txt) { $('estado').textContent = txt; }

  // ---------- cargar / editar gasto ----------
  function abrirGasto(id) {
    editId = id; var g = id ? S.gastos.filter(function (x) { return x.id === id; })[0] : null;
    $('dtitulo').textContent = g ? 'Editar gasto' : 'Cargar gasto · ' + tarjetaActual().nombre;
    $('tipo').value = g ? (g.tipo || 'COMPRA') : 'COMPRA';
    $('desc').value = g ? g.descripcion : '';
    $('monto').value = g ? (g.tipo === 'PAGO' ? Math.abs(g.monto) : g.monto) : '';
    $('fecha').value = g ? g.fecha : hoyISO();
    $('cuotas').value = g ? g.cuotas : 1;
    $('borrar').hidden = !g; tipoUI(); $('dlg').showModal();
  }
  function tipoUI() { $('bcuotas').hidden = $('tipo').value === 'PAGO'; }
  function guardarGasto() {
    var tipo = $('tipo').value, desc = $('desc').value.trim(), monto = num($('monto').value), fecha = $('fecha').value;
    var cuotas = tipo === 'PAGO' ? 1 : parseInt($('cuotas').value, 10);
    if (!desc) return toast('Falta la descripción.');
    if (!isFinite(monto) || monto === 0) return toast('El monto tiene que ser un número distinto de 0.');
    if (!fecha) return toast('Falta la fecha.');
    if (!(cuotas >= 1)) return toast('Las cuotas deben ser 1 o más.');
    if (tipo === 'PAGO') monto = -Math.abs(monto);
    var g = editId ? S.gastos.filter(function (x) { return x.id === editId; })[0] : null;
    if (!g) { g = { id: uuid(), tarjeta_id: actual, eliminado: false }; S.gastos.push(g); }
    g.tipo = tipo === 'COMPRA' ? '' : tipo; g.descripcion = desc; g.monto = monto; g.fecha = fecha; g.cuotas = cuotas;
    marcarG(g); $('dlg').close(); render();
  }

  // ---------- tarjetas ----------
  var tarEdit = null;
  // la sincronización puede reemplazar el objeto de la tarjeta mientras el cuadro está abierto: siempre buscar el actual por id
  function tEdit() { return tarEdit ? (S.tarjetas.filter(function (x) { return x.id === tarEdit.id; })[0] || tarEdit) : null; }
  function abrirTarjeta(t) {
    tarEdit = t || null;
    $('ttitulo').textContent = t ? 'Editar tarjeta' : 'Agregar tarjeta';
    $('tnombre').value = t ? t.nombre : ''; $('tcred').value = t ? t.credito : ''; $('tdol').value = t && t.dolar ? t.dolar : '';
    $('tnuevo').hidden = !!t; $('tFechas').hidden = !t; $('tBorrar').hidden = !t;
    $('tcorte').value = ''; $('tdias').value = 8;
    var c = t ? cfgDe(t) : { mant: 0, iva: 21, sello: 0, desde: '' };
    $('tmant').value = c.mant || ''; $('tiva').value = c.iva; $('tsello').value = c.sello || ''; $('tdesde').value = c.desde || '';
    $('tcfgAviso').textContent = S.cfgOK ? '' : 'Esta configuración queda guardada en este equipo. Para que se comparta entre el celular y la notebook falta un paso en Supabase.';
    $('dtar').showModal();
  }
  function guardarTarjeta() {
    var nombre = $('tnombre').value.trim(), cred = num($('tcred').value), dol = $('tdol').value.trim() ? num($('tdol').value) : 0;
    if (!nombre) return toast('Falta el nombre.');
    if (!isFinite(cred) || cred < 0) return toast('El crédito tiene que ser un número.');
    if (!isFinite(dol) || dol < 0) return toast('El valor del dólar tiene que ser un número.');
    var mant = $('tmant').value.trim() ? num($('tmant').value) : 0, iva = $('tiva').value.trim() ? num($('tiva').value) : 21, sello = $('tsello').value.trim() ? num($('tsello').value) : 0;
    if (!isFinite(mant) || mant < 0) return toast('El mantenimiento tiene que ser un número.');
    if (!isFinite(iva) || iva < 0) return toast('El IVA tiene que ser un número.');
    if (!isFinite(sello) || sello < 0) return toast('El sello tiene que ser un número.');
    var t = tEdit();
    if (!t) {
      var corte = $('tcorte').value, dias = parseInt($('tdias').value, 10);
      if (!corte) return toast('Falta la fecha del próximo corte.');
      if (!(dias >= 0)) return toast('Los días hasta el vencimiento tienen que ser un número.');
      t = { id: uuid(), orden: S.tarjetas.length, cortes: [], pagos: [] };
      for (var i = 0; i < 12; i++) { var c = addMonths(corte, i); t.cortes.push(c); t.pagos.push(addDays(c, dias)); }
      S.tarjetas.push(t); actual = t.id;
    }
    t.nombre = nombre; t.credito = cred; t.dolar = dol;
    t.config = { mant: mant, iva: iva, sello: sello, desde: $('tdesde').value || '' };
    extender(t, hoyISO()); marcarT(t); $('dtar').close(); render();
  }
  function abrirFechas() {
    var t = tEdit(); if (!t) return;
    $('fechasLista').innerHTML = t.cortes.map(function (c, i) {
      return '<input type="date" data-k="c" data-i="' + i + '" value="' + c + '"><input type="date" data-k="p" data-i="' + i + '" value="' + t.pagos[i] + '">';
    }).join('');
    $('dfec').showModal();
  }
  function guardarFechas() {
    var t = tEdit(), cs = [], ps = [], ins = $('fechasLista').querySelectorAll('input');
    for (var j = 0; j < ins.length; j++) { var i = +ins[j].dataset.i; (ins[j].dataset.k === 'c' ? cs : ps)[i] = ins[j].value; }
    for (var k = 0; k < cs.length; k++) { if (!cs[k] || !ps[k]) return toast('Hay una fecha vacía.'); if (k && cs[k] <= cs[k - 1]) return toast('Los cortes tienen que ir en orden.'); }
    t.cortes = cs; t.pagos = ps; marcarT(t); $('dfec').close(); $('dtar').close(); render();
  }
  function borrarTarjeta() {
    var t = tEdit(); S.tarjetas = S.tarjetas.filter(function (x) { return x.id !== t.id; });
    S.gastos = S.gastos.filter(function (g) { if (g.tarjeta_id === t.id) { delete S.out.g[g.id]; return false; } return true; });
    delete S.out.t[t.id]; S.out.dt.push(t.id); guardar(); actual = null; $('dtar').close(); $('dmenu').close(); render(); pedirSync();
  }

  // ---------- exportar / importar ----------
  function csvCampo(v) { v = String(v == null ? '' : v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportar() {
    var filas = ['ID;Tarjeta;Tipo;Descripcion;Monto;Fecha;Cuotas'];
    S.tarjetas.forEach(function (t) {
      gastosDe(t.id).forEach(function (g) {
        filas.push([g.id, t.nombre, g.tipo || 'COMPRA', g.descripcion, String(g.monto).replace('.', ','), fd(g.fecha), g.cuotas].map(csvCampo).join(';'));
      });
    });
    var blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mis_tarjetas_' + hoyISO() + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('Archivo descargado');
  }
  function parseCSV(txt) {
    txt = txt.replace(/^﻿/, ''); var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < txt.length; i++) {
      var c = txt[i];
      if (q) { if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ';') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function fechaISO(s) {
    s = String(s).trim(); var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
  }
  function leerArchivo(texto, nombre) {
    var datos = { tarjetas: [], gastosCSV: [] };
    if (/\.json$/i.test(nombre) || texto.trim()[0] === '{') {
      var o = JSON.parse(texto); if (!o || !o.tarjetas) throw new Error('El archivo no tiene el formato esperado.');
      datos.tarjetas = o.tarjetas; return datos;
    }
    var rows = parseCSV(texto), cab = rows.shift().map(function (x) { return norm(x); });
    var ix = function (n) { return cab.indexOf(n); };
    if (ix('tarjeta') < 0 || ix('monto') < 0 || ix('fecha') < 0 || ix('descripcion') < 0) throw new Error('El archivo no tiene las columnas esperadas (ID;Tarjeta;Tipo;Descripcion;Monto;Fecha;Cuotas).');
    rows.forEach(function (r, n) {
      if (r.length < 3 || !r.join('').trim()) return;
      var f = fechaISO(r[ix('fecha')]), m = num(r[ix('monto')]);
      if (!f || !isFinite(m)) throw new Error('Fila ' + (n + 2) + ': fecha o monto no válidos.');
      var tp = (ix('tipo') >= 0 ? String(r[ix('tipo')]).trim().toUpperCase() : '');
      datos.gastosCSV.push({ id: ix('id') >= 0 ? String(r[ix('id')]).trim() : '', tarjeta: String(r[ix('tarjeta')]).trim(), tipo: tp === 'COMPRA' ? '' : tp,
        descripcion: String(r[ix('descripcion')]).trim(), monto: m, fecha: f, cuotas: ix('cuotas') >= 0 ? (parseInt(r[ix('cuotas')], 10) || 1) : 1 });
    });
    return datos;
  }
  function planificar(datos) {
    var plan = { tarjetasNuevas: [], gastosNuevos: [], dups: [], saltados: 0, faltan: [] };
    var porNombre = {}; S.tarjetas.forEach(function (t) { porNombre[norm(t.nombre)] = t; });
    var idsExistentes = {}; S.gastos.forEach(function (g) { idsExistentes[g.id] = true; });
    function tarjetaPara(nombre) { return porNombre[norm(nombre)]; }
    datos.tarjetas.forEach(function (it) {
      var t = tarjetaPara(it.nombre);
      if (!t) {
        t = { id: it.id && !S.tarjetas.some(function (x) { return x.id === it.id; }) ? it.id : uuid(), nombre: it.nombre, credito: Number(it.credito) || 0, dolar: Number(it.dolar) || 0,
          cortes: it.cortes || [], pagos: it.pagos || [], orden: S.tarjetas.length + plan.tarjetasNuevas.length };
        plan.tarjetasNuevas.push(t); porNombre[norm(t.nombre)] = t;
      }
      (it.gastos || []).forEach(function (g) { agregar(t, g); });
    });
    datos.gastosCSV.forEach(function (g) {
      var t = tarjetaPara(g.tarjeta);
      if (!t) { if (plan.faltan.indexOf(g.tarjeta) < 0) plan.faltan.push(g.tarjeta); return; }
      agregar(t, g);
    });
    function agregar(t, g) {
      var id = g.id && /^[0-9a-f-]{36}$/i.test(g.id) ? g.id : null;
      if (id && idsExistentes[id]) { plan.saltados++; return; }
      var nuevo = { id: id || uuid(), tarjeta_id: t.id, tipo: g.tipo || '', descripcion: g.descripcion, monto: Number(g.monto), fecha: g.fecha, cuotas: Number(g.cuotas) || 1, eliminado: false };
      var igual = S.gastos.some(function (x) {
        return !x.eliminado && x.tarjeta_id === t.id && x.fecha === nuevo.fecha && Number(x.monto) === nuevo.monto && norm(x.descripcion) === norm(nuevo.descripcion) && (x.tipo || '') === nuevo.tipo;
      });
      if (igual) plan.dups.push({ g: nuevo, tarjeta: t.nombre }); else plan.gastosNuevos.push(nuevo);
      idsExistentes[nuevo.id] = true;
    }
    return plan;
  }
  var planActual = null;
  function importarTexto(texto, nombre) {
    var datos; try { datos = leerArchivo(texto, nombre); } catch (e) { return toast(e.message || 'No pude leer el archivo.'); }
    var plan = planificar(datos);
    if (plan.faltan.length) return toast('Primero agregá la tarjeta: ' + plan.faltan.join(', '));
    planActual = plan;
    if (plan.dups.length) {
      $('dupLista').innerHTML = plan.dups.map(function (d, i) {
        return '<label class="dup"><input type="checkbox" data-i="' + i + '"><span><b>' + esc(d.g.descripcion) + '</b> · ' + fmt(d.g.monto) + '<br><span class="sub">' + esc(d.tarjeta) + ' · ' + fd(d.g.fecha) + '</span></span></label>';
      }).join('');
      $('ddup').showModal();
    } else aplicarImport([]);
  }
  function aplicarImport(agregarDups) {
    var p = planActual; if (!p) return;
    p.tarjetasNuevas.forEach(function (t) { S.tarjetas.push(t); extender(t, hoyISO()); marcarT(t); });
    var nuevos = p.gastosNuevos.concat(agregarDups.map(function (i) { return p.dups[i].g; }));
    nuevos.forEach(function (g) { S.gastos.push(g); marcarG(g); });
    var omit = p.dups.length - agregarDups.length;
    planActual = null; $('dmenu').close(); render();
    toast('Importado: ' + nuevos.length + ' gastos' + (p.tarjetasNuevas.length ? ', ' + p.tarjetasNuevas.length + ' tarjetas' : '') + (omit ? ' · ' + omit + ' duplicados omitidos' : '') + (p.saltados ? ' · ' + p.saltados + ' ya estaban' : ''));
  }

  // ---------- cerrar resumen ----------
  var resT = null;
  function idCierre(t, corte) { return idFijo('cierre|' + t.id + '|' + corte); }
  function calcCierre(t, corte) {
    var id = idCierre(t, corte), i = t.cortes.indexOf(corte);
    var gs = gastosDe(t.id).filter(function (g) { return g.id !== id; });
    var r = Motor.calcTarjeta({ credito: t.credito, dolar: t.dolar || 0, cortes: t.cortes, pagos: t.pagos,
      filas: gs.map(function (g) { return { tipo: g.tipo || '', desc: g.descripcion, monto: Number(g.monto), fecha: g.fecha, cuotas: Number(g.cuotas) }; }) }, hoyISO());
    var pagos = 0;
    r.filas.forEach(function (f, k) { if (f.meses && esPago(gs[k])) pagos += f.meses[i]; });
    var previo = S.gastos.filter(function (g) { return g.id === id && !g.eliminado; })[0];
    return { id: id, i: i, saldo: r.saldo[i], pagos: pagos, total: r2(r.saldo[i] - pagos), previo: previo, est: estimarCargos(t, r, i) };
  }
  function abrirResumen() {
    var t = tarjetaActual(); if (!t) return toast('Todavía no hay tarjetas.');
    resT = t; var d = desdeEf(t), h = hoyISO(), lim = null, def = null;
    var r = motor(t); lim = r.idxMes >= 0 ? t.cortes[r.idxMes] : t.cortes[t.cortes.length - 1];
    var ops = t.cortes.filter(function (c) { return c >= d && c <= lim; });
    if (!ops.length) return toast('No hay cortes para cerrar. Revisá “Se usan desde el corte del” en Editar esta tarjeta.');
    ops.forEach(function (c) { if (c <= h) def = c; });
    $('rtitulo').textContent = 'Cerrar resumen · ' + t.nombre;
    $('rmes').innerHTML = ops.map(function (c) { return '<option value="' + c + '">' + fd(c) + '</option>'; }).join('');
    $('rmes').value = def || ops[0]; $('rtotal').value = '';
    $('dmenu').close(); refrescarResumen(); $('dres').showModal();
  }
  function refrescarResumen() {
    var t = resT, c = calcCierre(t, $('rmes').value);
    $('rcalc').innerHTML = 'La app tiene para este corte: <b>' + fmt(c.total) + '</b><br><span class="sub">saldo al corte ' + fmt(c.saldo) + ' sin contar los pagos cargados en ese corte (' + fmt(c.pagos) + ')</span>' +
      (c.est ? '<br><span class="sub">Cargos estimados: ' + fmt(c.est.total) + '</span>' : '') +
      (c.previo ? '<br><span class="sub">Ya hay una diferencia de ' + fmt(Number(c.previo.monto)) + ' cargada para este corte: se reemplaza.</span>' : '');
    var v = $('rtotal').value.trim();
    if (!v) { $('rdif').innerHTML = ''; return; }
    var n = num(v); if (!isFinite(n)) { $('rdif').innerHTML = 'Escribí el total como número.'; return; }
    var dif = r2(n - c.total);
    $('rdif').innerHTML = Math.abs(dif) < 0.005 ? 'La app ya coincide con el PDF. No hace falta cargar nada.' :
      'Diferencia a cargar: <b>' + (dif < 0 ? '-' : '') + '$' + Math.abs(dif).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</b><br><span class="sub">' + (dif > 0 ? 'Suma a lo que se debe (mantenimiento, impuestos, intereses…).' : 'Baja lo que se debe.') + '</span>';
  }
  function guardarResumen() {
    var t = resT, corte = $('rmes').value, v = $('rtotal').value.trim(); if (!v) return toast('Falta el total del PDF.');
    var n = num(v); if (!isFinite(n) || n < 0) return toast('El total tiene que ser un número.');
    var c = calcCierre(t, corte), dif = r2(n - c.total);
    var g = S.gastos.filter(function (x) { return x.id === c.id; })[0];
    if (Math.abs(dif) < 0.005) {
      if (g && !g.eliminado) { g.eliminado = true; marcarG(g); }
      $('dres').close(); render(); return toast('La app ya coincide con el PDF.');
    }
    if (!g) { g = { id: c.id, tarjeta_id: t.id, eliminado: false }; S.gastos.push(g); }
    g.tipo = ''; g.descripcion = 'DIFERENCIA RESUMEN ' + MESES[+corte.slice(5, 7) - 1] + ' ' + corte.slice(2, 4);
    g.monto = dif; g.fecha = corte; g.cuotas = 1; g.eliminado = false;
    marcarG(g); $('dres').close(); render(); toast('Diferencia cargada: ' + fmt(dif));
  }

  // ---------- sincronización ----------
  function filaT(t) { var f = { id: t.id, nombre: t.nombre, credito: t.credito, dolar: t.dolar || 0, cortes: t.cortes, pagos: t.pagos, orden: t.orden || 0 }; if (S.cfgOK) f.config = t.config || {}; return f; }
  function filaG(g) { return { id: g.id, tarjeta_id: g.tarjeta_id, tipo: g.tipo || '', descripcion: g.descripcion, monto: g.monto, fecha: g.fecha, cuotas: g.cuotas, eliminado: !!g.eliminado }; }
  function pedirSync() { clearTimeout(syncTimer); syncTimer = setTimeout(sincronizar, 800); }
  function pendientes() { return Object.keys(S.out.t).length + Object.keys(S.out.g).length + S.out.dt.length; }
  async function sincronizar() {
    if (syncing || !user || !S) return;
    if (document.querySelector('dialog[open]')) return; // con un cuadro abierto no se toca nada: se sincroniza al cerrarlo
    if (!navigator.onLine) { setEstado(pendientes() ? 'Sin internet · ' + pendientes() + ' cambios por subir' : 'Sin internet'); return; }
    syncing = true; setEstado('Sincronizando…');
    try {
      if (S.out.dt.length) {
        var ids = S.out.dt.slice();
        var d = await sb.from('tarjetas').delete().in('id', ids); if (d.error) throw d.error;
        S.out.dt = S.out.dt.filter(function (x) { return ids.indexOf(x) < 0; });
      }
      var sellosT = {}, filasT = S.tarjetas.filter(function (t) { if (S.out.t[t.id]) { sellosT[t.id] = S.out.t[t.id]; return true; } }).map(filaT);
      if (filasT.length) { var u = await sb.from('tarjetas').upsert(filasT, { onConflict: 'id' }); if (u.error) throw u.error; }
      Object.keys(sellosT).forEach(function (id) { if (S.out.t[id] === sellosT[id]) delete S.out.t[id]; });
      var sellosG = {}, filasG = S.gastos.filter(function (g) { if (S.out.g[g.id]) { sellosG[g.id] = S.out.g[g.id]; return true; } }).map(filaG);
      if (filasG.length) { var u2 = await sb.from('gastos').upsert(filasG, { onConflict: 'id' }); if (u2.error) throw u2.error; }
      Object.keys(sellosG).forEach(function (id) { if (S.out.g[id] === sellosG[id]) delete S.out.g[id]; });
      var rt = await sb.from('tarjetas').select('*'); if (rt.error) throw rt.error;
      var rg = await sb.from('gastos').select('*'); if (rg.error) throw rg.error;
      var remT = {}; rt.data.forEach(function (r) { remT[r.id] = r; });
      var remG = {}; rg.data.forEach(function (r) { remG[r.id] = r; });
      S.tarjetas = S.tarjetas.filter(function (t) { return remT[t.id] || S.out.t[t.id]; });
      var reenviar = false;
      if (rt.data.length && ('config' in rt.data[0])) S.cfgOK = true;
      rt.data.forEach(function (r) {
        if (S.out.t[r.id]) return;
        var i = S.tarjetas.findIndex(function (t) { return t.id === r.id; });
        var loc = i >= 0 ? S.tarjetas[i].config : null, rc = ('config' in r) ? (r.config || {}) : null;
        var remVacio = !rc || !Object.keys(rc).length, locLleno = loc && Object.keys(loc).length;
        var n = { id: r.id, nombre: r.nombre, credito: Number(r.credito), dolar: Number(r.dolar), cortes: r.cortes || [], pagos: r.pagos || [], orden: r.orden || 0, updated_at: r.updated_at,
          config: (remVacio && locLleno) ? loc : (rc || {}) };
        if (i >= 0) S.tarjetas[i] = n; else S.tarjetas.push(n);
        if (S.cfgOK && remVacio && locLleno) { S.out.t[r.id] = Date.now() + Math.random(); reenviar = true; }
      });
      S.gastos = S.gastos.filter(function (g) { return remG[g.id] || S.out.g[g.id]; });
      rg.data.forEach(function (r) {
        if (S.out.g[r.id]) return;
        var n = { id: r.id, tarjeta_id: r.tarjeta_id, tipo: r.tipo || '', descripcion: r.descripcion, monto: Number(r.monto), fecha: r.fecha, cuotas: r.cuotas, eliminado: !!r.eliminado, updated_at: r.updated_at };
        var i = S.gastos.findIndex(function (g) { return g.id === r.id; }); if (i >= 0) S.gastos[i] = n; else S.gastos.push(n);
      });
      if (reenviar) pedirSync();
      var ext = false; S.tarjetas.forEach(function (t) { if (extender(t, hoyISO())) { marcarT(t); ext = true; } });
      guardar(); render();
      var h = new Date(); setEstado('Sincronizado ' + String(h.getHours()).padStart(2, '0') + ':' + String(h.getMinutes()).padStart(2, '0'));
    } catch (e) {
      console.warn('sync', e); setEstado(pendientes() ? 'No se pudo sincronizar · ' + pendientes() + ' cambios por subir' : 'No se pudo sincronizar');
    } finally { syncing = false; }
  }

  // ---------- tamaño de letra ----------
  var TAM = [['Normal', 1], ['Grande', 1.25], ['Muy grande', 1.5]];
  function tamActual() { var i = 1; try { var v = parseInt(localStorage.getItem('mt_tam'), 10); if (v >= 0 && v < TAM.length) i = v; } catch (e) { } return i; }
  function aplicarTam() { var i = tamActual(); document.documentElement.style.setProperty('--zoom', TAM[i][1]); var b = $('mLetra'); if (b) b.textContent = 'Tamaño de letra: ' + TAM[i][0] + ' (tocá para cambiar)'; }
  function cambiarTam() { var i = (tamActual() + 1) % TAM.length; try { localStorage.setItem('mt_tam', i); } catch (e) { } aplicarTam(); }
  aplicarTam();

  // ---------- avisos (notificaciones) ----------
  function b64(s) {
    var p = '='.repeat((4 - s.length % 4) % 4), b = (s + p).replace(/-/g, '+').replace(/_/g, '/'), r = atob(b), o = new Uint8Array(r.length);
    for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o;
  }
  function soportaAvisos() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  async function suscripcion() {
    if (!soportaAvisos()) return null;
    var reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription();
  }
  async function refrescarBotonAvisos() {
    var b = $('mAvisos'); if (!soportaAvisos()) { b.textContent = 'Avisos: este navegador no los permite'; return; }
    try { var s = await suscripcion(); b.textContent = s ? 'Avisos activados (tocá para desactivar)' : 'Activar avisos en este equipo'; b.dataset.on = s ? '1' : ''; } catch (e) { b.textContent = 'Activar avisos en este equipo'; }
  }
  async function alternarAvisos() {
    if (!soportaAvisos()) return toast('Este navegador no permite avisos. Probá desde la app instalada en Chrome.');
    if (!navigator.onLine) return toast('Necesitás internet para esto.');
    try {
      var reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
      if (sub) {
        var ep = sub.endpoint; await sub.unsubscribe();
        await sb.from('push_subs').delete().eq('endpoint', ep);
        toast('Avisos desactivados en este equipo'); return refrescarBotonAvisos();
      }
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') return toast('No diste permiso. Podés activarlo en los ajustes del navegador.');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(window.APP_CONFIG.vapid) });
      var j = sub.toJSON();
      var r = await sb.from('push_subs').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
      if (r.error) { await sub.unsubscribe(); return toast('No se pudo guardar el aviso: ' + r.error.message); }
      toast('Avisos activados en este equipo'); refrescarBotonAvisos();
    } catch (e) { toast('No se pudo activar: ' + (e && e.message || e)); }
  }

  // ---------- sesión ----------
  function mostrarLogin(msg) { $('app').hidden = true; $('auth').hidden = false; $('authMsg').textContent = msg || ''; user = null; S = null; }
  function entrar(u) {
    user = u; S = cargar(); $('auth').hidden = true; $('app').hidden = false; $('quien').textContent = 'Sesión: ' + (u.email || '');
    S.tarjetas.forEach(function (t) { if (extender(t, hoyISO())) marcarT(t); });
    var ord = S.tarjetas.slice().sort(function (a, b) { return (a.orden - b.orden); }); actual = ord.length ? ord[0].id : null;
    var mejor = tarjetaMasLejana(); if (mejor) actual = mejor.id;
    render(); setEstado(pendientes() ? 'Hay cambios por subir' : ''); sincronizar();
  }
  async function login(crear) {
    var email = $('email').value.trim(), pass = $('pass').value;
    if (!email || pass.length < 6) { $('authMsg').textContent = 'Escribí tu correo y una contraseña de al menos 6 caracteres.'; return; }
    $('authMsg').textContent = crear ? 'Creando cuenta…' : 'Entrando…';
    try {
      var r = crear ? await sb.auth.signUp({ email: email, password: pass }) : await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) { $('authMsg').textContent = traducir(r.error.message); return; }
      if (!r.data.session) { $('authMsg').textContent = 'Cuenta creada. Si pide confirmar el correo, revisá tu casilla y volvé a entrar.'; return; }
      entrar(r.data.session.user);
    } catch (e) { $('authMsg').textContent = 'No se pudo conectar. Revisá tu internet.'; }
  }
  function traducir(m) {
    if (/invalid login/i.test(m)) return 'Correo o contraseña incorrectos.';
    if (/already registered|already been registered/i.test(m)) return 'Ese correo ya tiene cuenta. Tocá Entrar.';
    if (/password/i.test(m)) return 'La contraseña es muy corta o no es válida.';
    if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Esperá unos minutos.';
    return m;
  }

  // ---------- eventos ----------
  document.addEventListener('click', function (e) {
    var tb = e.target.closest('.tab'); if (tb) { actual = tb.dataset.id; mesSel = null; if (filtro === 'MES') filtro = 'ACTIVO'; render(); return; }
    var mc = e.target.closest('.mes'); if (mc && mc.dataset.i !== undefined) { mesSel = +mc.dataset.i; filtro = 'MES'; render(); var l = $('resMes'); if (l && l.scrollIntoView) l.scrollIntoView({ block: 'nearest' }); return; }
    var rw = e.target.closest('.row'); if (rw) abrirGasto(rw.dataset.id);
  });
  $('nuevo').onclick = function () { abrirGasto(null); };
  $('tipo').onchange = tipoUI;
  $('cancel').onclick = function () { $('dlg').close(); };
  $('guardar').onclick = guardarGasto;
  dosPasos($('borrar'), 'Tocá otra vez para eliminar', function () {
    var g = S.gastos.filter(function (x) { return x.id === editId; })[0]; if (g) { g.eliminado = true; marcarG(g); }
    $('dlg').close(); render(); toast('Gasto eliminado');
  });
  $('fAct').onclick = function () { filtro = 'ACTIVO'; render(); };
  $('fTod').onclick = function () { filtro = 'TODOS'; render(); };
  $('fMes').onclick = function () { filtro = 'MES'; render(); };
  $('menu').onclick = function () { refrescarBotonAvisos(); $('dmenu').showModal(); };
  $('mAvisos').onclick = alternarAvisos;
  $('mLetra').onclick = cambiarTam;
  $('mCerrar').onclick = function () { $('dmenu').close(); };
  $('mSync').onclick = function () { $('dmenu').close(); sincronizar(); };
  $('mResumen').onclick = abrirResumen;
  $('rmes').onchange = refrescarResumen;
  $('rtotal').oninput = refrescarResumen;
  $('rCancel').onclick = function () { $('dres').close(); };
  $('rGuardar').onclick = guardarResumen;
  $('mTarjeta').onclick = function () { var t = tarjetaActual(); if (!t) return toast('Todavía no hay tarjetas.'); $('dmenu').close(); abrirTarjeta(t); };
  $('mNueva').onclick = function () { $('dmenu').close(); abrirTarjeta(null); };
  $('bPrimera').onclick = function () { abrirTarjeta(null); };
  $('mImp').onclick = function () { $('file').click(); };
  $('file').onchange = function (e) {
    var f = e.target.files[0]; if (!f) return; var r = new FileReader();
    r.onload = function () { importarTexto(String(r.result), f.name); }; r.readAsText(f); e.target.value = '';
  };
  $('mExp').onclick = function () { $('dmenu').close(); exportar(); };
  dosPasos($('mSalir'), 'Tocá otra vez para salir', async function () {
    try { await sb.auth.signOut(); } catch (e) { }
    $('dmenu').close(); mostrarLogin('');
  });
  $('tCancel').onclick = function () { $('dtar').close(); };
  $('tGuardar').onclick = guardarTarjeta;
  $('tFechas').onclick = abrirFechas;
  $('fCancel').onclick = function () { $('dfec').close(); };
  $('fGuardar').onclick = guardarFechas;
  $('fMas').onclick = function () {
    var t = tEdit(); var uc = t.cortes[t.cortes.length - 1], up = t.pagos[t.pagos.length - 1];
    var n = addMonths(uc, 1); t.cortes.push(n); t.pagos.push(addDays(n, diffDays(uc, up))); abrirFechas();
  };
  dosPasos($('tBorrar'), 'Tocá otra vez: se borra con todos sus gastos', borrarTarjeta);
  $('dupTodos').onclick = function () { $('dupLista').querySelectorAll('input').forEach(function (i) { i.checked = true; }); };
  $('dupNinguno').onclick = function () { $('dupLista').querySelectorAll('input').forEach(function (i) { i.checked = false; }); };
  $('dupCancel').onclick = function () { planActual = null; $('ddup').close(); toast('Importación cancelada'); };
  $('dupOk').onclick = function () {
    var elegidos = []; $('dupLista').querySelectorAll('input').forEach(function (i) { if (i.checked) elegidos.push(+i.dataset.i); });
    $('ddup').close(); aplicarImport(elegidos);
  };
  $('bEntrar').onclick = function () { login(false); };
  $('bCrear').onclick = function () { login(true); };
  $('pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(false); });
  document.addEventListener('close', function (e) { if (e.target && e.target.tagName === 'DIALOG' && user) pedirSync(); }, true);
  window.addEventListener('online', sincronizar);
  window.addEventListener('offline', function () { setEstado('Sin internet · se guarda en el celular'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && user) { render(); sincronizar(); } });
  setInterval(function () { if (!document.hidden && user) sincronizar(); }, 60000);

  // ---------- arranque ----------
  (async function () {
    try {
      var r = await sb.auth.getSession();
      if (r.data && r.data.session) entrar(r.data.session.user); else mostrarLogin('');
    } catch (e) { mostrarLogin(''); }
    sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT' && user) mostrarLogin(''); });
  })();
})();
