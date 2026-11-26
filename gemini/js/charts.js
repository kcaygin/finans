// Kelo-Finans — Gemini Edition
// Bağımlılıksız, duyarlı (responsive) inline SVG veri görselleştirme bileşenleri.

export const CHART_PALETTE = [
  'var(--gold)',
  'var(--accent)',
  'var(--cash)',
  'var(--income)',
  'var(--expense)',
  '#A78BFA',
  '#F59E0B'
];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

export function fmtCompact(n, currencySymbol = '₺') {
  const v = Number(n) || 0;
  const sign = v < 0 ? '−' : '';
  return `${sign}${currencySymbol}${Math.abs(v).toLocaleString('tr-TR', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  })}`;
}

export function donutSvg(segments, opts = {}) {
  const size = opts.size || 108;
  const stroke = opts.stroke || 14;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const positiveSegments = segments.filter(s => Number(s.value) > 0);
  const total = positiveSegments.reduce((s, x) => s + Number(x.value), 0);

  const bg = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}"/>`;
  let arcs = '';

  if (total > 0) {
    let offset = 0;
    arcs = positiveSegments
      .map(s => {
        const frac = Number(s.value) / total;
        const len = frac * circumference;
        const dasharray = `${len} ${circumference - len}`;
        const dashoffset = -offset;
        offset += len;
        return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}" stroke-dasharray="${dasharray}" stroke-dashoffset="${dashoffset}" stroke-linecap="butt" transform="rotate(-90 ${c} ${c})"/>`;
      })
      .join('');
  }

  let labelFontSize = opts.centerLabelSize || 13;
  const labelStr = opts.centerLabel != null ? String(opts.centerLabel) : '';
  if (labelStr.length > 8) {
    labelFontSize = Math.max(8.5, labelFontSize - (labelStr.length - 8) * 0.85);
  }

  const centerLabel =
    opts.centerLabel != null
      ? `<text x="${c}" y="${opts.centerSub != null ? c - 5 : c}" text-anchor="middle" dominant-baseline="middle" font-size="${labelFontSize}" font-weight="800" fill="var(--ink)" class="num">${esc(labelStr)}</text>`
      : '';
  const centerSub =
    opts.centerSub != null
      ? `<text x="${c}" y="${c + 11}" text-anchor="middle" dominant-baseline="middle" font-size="9" font-weight="600" fill="var(--ink-faint)">${esc(String(opts.centerSub))}</text>`
      : '';

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex:none;" role="img" aria-label="Dağılım grafiği">${bg}${arcs}${centerLabel}${centerSub}</svg>`;
}

export function monthlyTrendSvg(months, opts = {}) {
  const w = opts.width || 620;
  const h = opts.height || 230;
  const symbol = opts.currencySymbol || '₺';
  const rate = opts.rate || 1;
  const padL = 54;
  const padR = 14;
  const padT = 16;
  const padB = 30;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(10, h - padT - padB);
  const maxVal = Math.max(1, ...months.map(m => Math.max(m.income, m.expense) / rate));
  const n = Math.max(1, months.length);
  const groupW = plotW / n;
  const barW = Math.min(20, groupW * 0.3);
  const gap = Math.max(4, barW * 0.28);

  let grid = '';
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const y = padT + plotH - (plotH * i) / gridCount;
    const val = (maxVal * i) / gridCount;
    grid += `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="var(--hairline)" stroke-width="1"/>`;
    grid += `<text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="var(--ink-faint)" class="num">${esc(fmtCompact(val, symbol))}</text>`;
  }

  let bars = '';
  months.forEach((mo, i) => {
    const cx = padL + i * groupW + groupW / 2;
    const incVal = mo.income / rate;
    const expVal = mo.expense / rate;
    const incH = (incVal / maxVal) * plotH;
    const expH = (expVal / maxVal) * plotH;
    const incX = cx - barW - gap / 2;
    const expX = cx + gap / 2;
    const incY = padT + plotH - incH;
    const expY = padT + plotH - expH;

    bars += `<rect x="${incX}" y="${incY}" width="${barW}" height="${Math.max(0, incH)}" rx="4" fill="var(--income)"><title>${esc(mo.label)} Gelir: ${esc(fmtCompact(incVal, symbol))}</title></rect>`;
    bars += `<rect x="${expX}" y="${expY}" width="${barW}" height="${Math.max(0, expH)}" rx="4" fill="var(--expense)"><title>${esc(mo.label)} Gider: ${esc(fmtCompact(expVal, symbol))}</title></rect>`;
    bars += `<text x="${cx}" y="${padT + plotH + 18}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink-soft)">${esc(mo.label)}</text>`;
  });

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Aylık gelir ve gider trendi">${grid}${bars}</svg>`;
}

export function sparklineAreaSvg(points, opts = {}) {
  if (!points || points.length < 2) {
    return '<div class="empty" style="padding:20px;">Zaman serisi grafiği için en az 2 kayıt noktası gerekir.</div>';
  }
  const w = opts.width || 560;
  const h = opts.height || 130;
  const padX = 10;
  const padT = 14;
  const padB = 22;
  const plotW = w - padX * 2;
  const plotH = h - padT - padB;
  const vals = points.map(p => Number(p.value || 0));
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const span = Math.max(1, maxV - minV);

  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * plotW;
    const y = padT + plotH - ((Number(p.value || 0) - minV) / span) * plotH;
    return { x, y, label: p.label, value: p.value };
  });

  const linePath = coords.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const dots = coords
    .map(
      pt =>
        `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3.2" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5"><title>${esc(pt.label)}: ${esc(fmtCompact(pt.value))}</title></circle>`
    )
    .join('');

  const labels = `<text x="${coords[0].x}" y="${h - 4}" text-anchor="start" font-size="9.5" fill="var(--ink-faint)">${esc(coords[0].label)}</text><text x="${coords[coords.length - 1].x}" y="${h - 4}" text-anchor="end" font-size="9.5" fill="var(--ink-faint)">${esc(coords[coords.length - 1].label)}</text>`;

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;"><defs><linearGradient id="nwAreaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0.01"/></linearGradient></defs><path d="${areaPath}" fill="url(#nwAreaGrad)"/><path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}
