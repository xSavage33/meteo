'use strict';

(() => {
  let horas = 24;
  let chart = null;
  let ultimaTs = null;
  const CIRC = 2 * Math.PI * 70;

  const $ = (id) => document.getElementById(id);
  const texto = (id, v) => { $(id).textContent = v; };

  // ---------- Calculos ambientales ----------
  function puntoRocio(t, h) {
    if (t == null || h == null || h <= 0) return null;
    const a = 17.62, b = 243.12;
    const g = Math.log(h / 100) + (a * t) / (b + t);
    return (b * g) / (a - g);
  }

  function indiceConfort(t, h) {
    if (t == null || h == null) return null;
    const pt = Math.max(0, Math.abs(t - 22) - 2) * 8;
    const ph = Math.max(0, Math.abs(h - 50) - 10) * 1.5;
    return Math.round(Math.max(0, Math.min(100, 100 - pt - ph)));
  }

  function textoConfort(s) {
    if (s == null) return 'Sin datos';
    if (s >= 80) return 'Aire ideal';
    if (s >= 60) return 'Agradable';
    if (s >= 40) return 'Aceptable';
    return 'Poco confortable';
  }

  function colorConfort(s) {
    if (s == null) return '#c4c7c0';
    if (s >= 80) return '#4fa37a';
    if (s >= 60) return '#8f9a5c';
    if (s >= 40) return '#e8a54a';
    return '#e05a4f';
  }

  function textoTemp(t) {
    if (t < 18) return 'Ambiente frio';
    if (t <= 24) return 'Temperatura agradable';
    if (t <= 28) return 'Ambiente calido';
    return 'Calor intenso';
  }

  function textoHum(h) {
    if (h < 30) return 'Aire muy seco';
    if (h < 40) return 'Aire seco';
    if (h <= 60) return 'Humedad ideal';
    if (h <= 70) return 'Algo humedo';
    return 'Humedad alta';
  }

  function textoRocio(t, td) {
    if (td == null) return '--';
    if (t - td < 3) return 'Riesgo de condensacion';
    if (td < 10) return 'Aire seco';
    if (td < 16) return 'Confortable';
    if (td < 19) return 'Algo humedo';
    return 'Bochornoso';
  }

  // ---------- Formatos ----------
  const fmt = (n, d = 1) => (n == null || isNaN(n)) ? '--' : Number(n).toFixed(d);
  const pct = (v, min, max) => (v == null) ? 0 : Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));

  function hace(iso) {
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return 'hace ' + s + ' s';
    if (s < 3600) return 'hace ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.floor(s / 3600) + ' h';
    return 'hace ' + Math.floor(s / 86400) + ' d';
  }

  function duracion(seg) {
    const d = Math.floor(seg / 86400);
    const h = Math.floor((seg % 86400) / 3600);
    const m = Math.floor((seg % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  function calidadSenal(rssi) {
    if (rssi >= -55) return 'Excelente';
    if (rssi >= -67) return 'Buena';
    if (rssi >= -75) return 'Regular';
    return 'Debil';
  }

  function etiqueta(iso) {
    const f = new Date(iso);
    if (horas <= 24) return f.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    return f.toLocaleDateString('es', { day: '2-digit', month: '2-digit' }) + ' ' + f.getHours() + 'h';
  }

  async function api(ruta) {
    const r = await fetch(ruta, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // ---------- Estado en vivo ----------
  function setLive(estado, txt) {
    $('live').className = 'live ' + estado;
    texto('liveTxt', txt);
    const b = $('nodeBadge');
    b.className = 'badge ' + estado;
    b.textContent = estado === 'on' ? 'En linea' : 'Fuera de linea';
  }

  function actualizarReloj() {
    if (ultimaTs) texto('nVisto', hace(ultimaTs));
  }

  async function cargarActual() {
    try {
      const d = await api('/api/actual');
      if (!d.lectura) { setLive('off', 'Sin datos'); return; }

      const t = d.lectura.temperatura;
      const h = d.lectura.humedad;
      ultimaTs = d.lectura.ts;

      const td = puntoRocio(t, h);
      const c = indiceConfort(t, h);

      texto('tVal', fmt(t)); texto('tNote', textoTemp(t)); $('tBar').style.width = pct(t, 0, 40) + '%';
      texto('hVal', fmt(h)); texto('hNote', textoHum(h)); $('hBar').style.width = pct(h, 0, 100) + '%';
      texto('dVal', fmt(td)); texto('dNote', textoRocio(t, td)); $('dBar').style.width = pct(td, -10, 30) + '%';
      texto('cVal', c == null ? '--' : String(c)); texto('cNote', textoConfort(c)); $('cBar').style.width = (c || 0) + '%';

      const ring = $('ring');
      ring.style.strokeDashoffset = String(CIRC * (1 - (c || 0) / 100));
      ring.style.stroke = colorConfort(c);
      texto('ringVal', c == null ? '--' : String(c));
      texto('ringTxt', textoConfort(c));

      // textContent evita inyeccion HTML desde datos del dispositivo
      const dev = d.dispositivo || {};
      texto('nRed', dev.ssid || '--');
      texto('nSenal', dev.rssi != null ? dev.rssi + ' dBm, ' + calidadSenal(dev.rssi) : '--');
      texto('nIp', dev.ip || '--');
      texto('nFw', dev.fw || '--');
      texto('nUp', dev.uptime != null ? duracion(dev.uptime) : '--');
      actualizarReloj();

      const viejo = (Date.now() - Date.parse(ultimaTs)) / 1000 > 120;
      setLive(viejo ? 'off' : 'on', viejo ? 'Sin senal' : 'En vivo');
    } catch (e) {
      setLive('off', 'Servidor no disponible');
    }
  }

  // ---------- Grafico ----------
  function degradado(color) {
    return (ctx) => {
      const ch = ctx.chart;
      const a = ch.chartArea;
      if (!a) return 'transparent';
      const g = ch.ctx.createLinearGradient(0, a.top, 0, a.bottom);
      g.addColorStop(0, color + '30');
      g.addColorStop(1, color + '00');
      return g;
    };
  }

  function opcionesGrafico() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      elements: {
        point: { radius: 0, hoverRadius: 4 },
        line: { tension: 0.35, borderWidth: 2.5 }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, boxHeight: 6, padding: 18 }
        },
        tooltip: {
          backgroundColor: '#1d1f1c', padding: 10, cornerRadius: 10,
          usePointStyle: true, boxWidth: 8, boxHeight: 8
        }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
        y: { position: 'left', grid: { color: '#f0f1ed' }, border: { display: false }, ticks: { callback: (v) => v + '\u00b0' } },
        y1: { position: 'right', min: 0, max: 100, grid: { display: false }, border: { display: false }, ticks: { callback: (v) => v + '%' } }
      }
    };
  }

  async function cargarHistorico() {
    try {
      const [serie, res] = await Promise.all([
        api('/api/historico?horas=' + horas),
        api('/api/resumen?horas=' + horas)
      ]);

      $('chartVacio').classList.toggle('visible', serie.length === 0);

      const labels = serie.map((p) => etiqueta(p.t));
      const temp = serie.map((p) => p.temp);
      const hum = serie.map((p) => p.hum);
      const rocio = serie.map((p) => {
        const v = puntoRocio(p.temp, p.hum);
        return v == null ? null : Math.round(v * 10) / 10;
      });

      const datasets = [
        { label: 'Temperatura (\u00b0C)', data: temp, borderColor: '#e8894a', backgroundColor: degradado('#e8894a'), fill: true, yAxisID: 'y' },
        { label: 'Punto de rocio (\u00b0C)', data: rocio, borderColor: '#4fa37a', borderDash: [5, 5], fill: false, yAxisID: 'y' },
        { label: 'Humedad (%)', data: hum, borderColor: '#4a7fe0', backgroundColor: degradado('#4a7fe0'), fill: true, yAxisID: 'y1' }
      ];

      if (window.Chart) {
        if (chart) {
          chart.data.labels = labels;
          chart.data.datasets = datasets;
          chart.update();
        } else {
          Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
          Chart.defaults.font.size = 11;
          Chart.defaults.color = '#8a8f87';
          chart = new Chart($('chart'), { type: 'line', data: { labels, datasets }, options: opcionesGrafico() });
        }
      }

      if (res.muestras) {
        texto('sTemp', fmt(res.temp_min) + ' / ' + fmt(res.temp_max) + ' / ' + fmt(res.temp_avg) + ' \u00b0C');
        texto('sHum', fmt(res.hum_min, 0) + ' / ' + fmt(res.hum_max, 0) + ' / ' + fmt(res.hum_avg) + ' %');
      } else {
        texto('sTemp', '--');
        texto('sHum', '--');
      }
      texto('sN', String(res.muestras || 0));
    } catch (e) {
      console.error('Error cargando historico', e);
    }
  }

  // ---------- Controles ----------
  document.querySelectorAll('#rangos button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#rangos button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      horas = parseInt(btn.dataset.h, 10);
      cargarHistorico();
    });
  });

  cargarActual();
  cargarHistorico();
  setInterval(cargarActual, 10000);
  setInterval(cargarHistorico, 60000);
  setInterval(actualizarReloj, 1000);
})();