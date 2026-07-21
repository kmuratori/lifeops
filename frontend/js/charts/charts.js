// charts.js — thin Chart.js wrappers, themed to the terminal palette

const ChartTheme = {
  grid: '#2a2a2e',
  text: '#6b6b72',
  textPrimary: '#e8e8ea',
  // Muted, desaturated accent for lines/fills
  accent: 'rgba(94,156,245,0.55)',
  font: "'JetBrains Mono', monospace",
};

Chart.defaults.color = ChartTheme.text;
Chart.defaults.borderColor = ChartTheme.grid;
Chart.defaults.font.family = ChartTheme.font;
Chart.defaults.font.size = 11;

// Desaturated palette — hue variety but low saturation/brightness
const _palette = [
  'rgba(100,130,185,0.75)',
  'rgba( 80,155,115,0.75)',
  'rgba(180,145, 85,0.75)',
  'rgba(180, 90, 95,0.75)',
  'rgba(135,110,185,0.75)',
  'rgba( 80,155,175,0.75)',
];

const _chartInstances = {};

function destroyChart(canvasId) {
  if (_chartInstances[canvasId]) {
    _chartInstances[canvasId].destroy();
    delete _chartInstances[canvasId];
  }
}

function renderRadarChart(canvasId, data) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext('2d');
  _chartInstances[canvasId] = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: data.map((d) => d.label),
      datasets: [{
        label: 'Progress %',
        data: data.map((d) => d.value),
        backgroundColor: 'rgba(94,156,245,0.07)',
        borderColor: 'rgba(94,156,245,0.45)',
        pointBackgroundColor: 'rgba(94,156,245,0.45)',
        pointRadius: 3,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          angleLines: { color: ChartTheme.grid },
          grid: { color: ChartTheme.grid },
          pointLabels: { color: ChartTheme.textPrimary, font: { family: ChartTheme.font, size: 11 } },
          ticks: { display: false, backdropColor: 'transparent' },
          min: 0, max: 100,
        },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function renderLineChart(canvasId, series) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext('2d');
  const allDates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  _chartInstances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: allDates,
      datasets: series.map((s, i) => {
        const byDate = Object.fromEntries(s.points.map((p) => [p.date, p.progress]));
        return {
          label: s.project_title,
          data: allDates.map((d) => byDate[d] ?? null),
          borderColor: _palette[i % _palette.length],
          backgroundColor: 'transparent',
          spanGaps: true,
          tension: 0.25,
          pointRadius: 2,
          borderWidth: 1.5,
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: ChartTheme.grid }, ticks: { maxTicksLimit: 8 } },
        y: { grid: { color: ChartTheme.grid }, min: 0, max: 100 },
      },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, usePointStyle: true } } },
    },
  });
}

function renderDonutChart(canvasId, data) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext('2d');
  _chartInstances[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map((d) => d.label),
      datasets: [{
        data: data.map((d) => d.value),
        // Use palette instead of vivid area colors
        backgroundColor: data.map((_, i) => _palette[i % _palette.length]),
        borderColor: '#161618',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, usePointStyle: true } } },
    },
  });
}

function renderBarChart(canvasId, weeks) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext('2d');
  _chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weeks.map((w) => w.week_start),
      datasets: [
        { label: 'Planned', data: weeks.map((w) => w.planned), backgroundColor: 'rgba(60,60,65,0.8)' },
        { label: 'Done',    data: weeks.map((w) => w.done),    backgroundColor: 'rgba(80,155,115,0.65)' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: ChartTheme.grid }, beginAtZero: true },
      },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, usePointStyle: true } } },
    },
  });
}

function renderSparkline(svgId, points) {
  const svg = document.getElementById(svgId);
  if (!svg || points.length < 2) return;
  const w = 200, h = 36;
  const vals = points.map((p) => p.progress * 100);
  const min = Math.min(...vals), max = Math.max(...vals) || 1;
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${h - ((v - min) / range) * h}`).join(' ');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = `<path d="${path}" fill="none" stroke="rgba(94,156,245,0.5)" stroke-width="1.5" />`;
}
