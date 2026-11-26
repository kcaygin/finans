// Kelo-Finans — Gemini Edition
// Ana Uygulama Denetleyicisi: Mobil + Masaüstü Tek Duyarlı Arayüz, Ergonomik Akış ve Atomik Senkron.

import {
  DEFAULT_FUND_STOPAJ,
  COIN_GRAM_MULTIPLIERS,
  round2,
  round4,
  parseMoneyInput,
  normKey,
  materialPriceKey,
  fundKey,
  todayStr,
  periodRange,
  inRange,
  personName,
  getGroupPrice,
  getFundPrice,
  getFundStopajRate,
  computePotBalance,
  computeFundLedger,
  previewFundSale,
  computeMetalLedger,
  previewMetalSale,
  analyzeBankPrices,
  matchFetchedPrices,
  incomeTypeInvestmentStats,
  computeOverview,
  principalBySource,
  unifiedEntries,
  computeMonthlyTrend,
  computeMonthlyClose,
  groupHoldingsByBank,
  canDeleteEntity
} from './finance.js';

import {
  COLLECTIONS,
  COLLECTION_TO_STATE,
  newId,
  getGithubConfig,
  setGithubConfig,
  clearGithubConfig,
  GithubApi,
  StoreLayer,
  buildTransactionsCsv,
  parseBankCsvAndMatch
} from './store.js';

import {
  CHART_PALETTE,
  fmtCompact,
  donutSvg,
  monthlyTrendSvg
} from './charts.js';

const THEME_KEY = 'kft_theme_v1';
const USD_RATE_KEY = 'kft_gemini_usd_rate_v1';
const PRIVACY_KEY = 'kft_gemini_privacy_v1';
const PIN_HASH_KEY = 'kft_gemini_pin_hash_v1';
const LAST_SOURCE_KEY = 'kft_gemini_last_src_v1';

const MATERIAL_PRESETS = ['Gram Altın', 'Çeyrek Altın', 'Yarım Altın', 'Tam Altın', 'Cumhuriyet Altını', 'Gümüş (gram)', 'Fiziki Altın', 'Fiziki Gümüş'];
const FUND_PRESETS = ['EP1'];
const STOPAJ_OPTIONS = [
  { val: 0, label: '%0 (Hisse Yoğun / Muaf)' },
  { val: 0.075, label: '%7,5' },
  { val: 0.1, label: '%10' },
  { val: 0.15, label: '%15' },
  { val: 0.175, label: '%17,5 (Standart)' }
];

const S = {
  store: null,
  people: [],
  incomeTypes: [],
  expenseCategories: [],
  incomeEntries: [],
  expenseEntries: [],
  savingsHoldings: [],
  materialPrices: [],
  fundLots: [],
  fundSales: [],
  fundPrices: [],
  transfers: [],
  metalSales: [],
  debts: [],
  snapshots: [],
  fundConfigs: [],
  view: 'ozet',
  addMode: 'gider',
  addPersonId: null,
  personFilter: 'all',
  reportPeriod: 'thisMonth',
  reportScope: 'spender',
  recordFilter: 'all',
  recordSearch: '',
  holdingsFilter: 'all',
  birikimSubView: 'metal',
  fundTxView: 'lots',
  monthlyCloseYm: todayStr().slice(0, 7),
  expandedSources: {},
  expandedBanks: {},
  privacy: false,
  currency: 'TRY',
  usdTry: 35.0,
  sheetDirty: false,
  inFlight: false
};

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function fmt(n, opts = {}) {
  if (S.privacy && !opts.raw) return '••••';
  let val = Number(n) || 0;
  let cur = 'TRY';
  if (S.currency === 'USD' && S.usdTry > 0 && !opts.forceTry) {
    val = val / S.usdTry;
    cur = 'USD';
  }
  return val.toLocaleString('tr-TR', {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  });
}

function fmtTry(n) {
  return fmt(n, { forceTry: true });
}

function fmtNum(n, digits = 2) {
  return (Number(n) || 0).toLocaleString('tr-TR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0
  });
}

function monthLabel(dateStr) {
  const [y, m] = String(dateStr || '').split('-').map(Number);
  if (!y || !m) return '—';
  return new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}

function dayLabel(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return dateStr || '—';
  return new Date(y, m - 1, d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function formatDateTime(iso) {
  if (!iso) return 'Bilinmiyor';
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Durum & Senkron Göstergeleri ----------
function updateSyncIndicators(info) {
  const dots = ['#syncDotTop', '#syncDotSide'];
  const labels = ['#syncLabelTop', '#syncLabelSide'];
  const banner = $('#syncBanner');

  let dotCls = 'sync-dot';
  let text = 'Bu cihazda kayıtlı';
  if (info.status === 'synced') {
    dotCls = 'sync-dot synced';
    text = info.lastSyncedAt ? `Eşitlendi · ${formatDateTime(info.lastSyncedAt)}` : 'GitHub ile eşitlendi';
  } else if (info.status === 'pending') {
    dotCls = 'sync-dot pending';
    text = `Bu cihazda kayıtlı (${info.pendingCount} bekliyor)`;
  } else if (info.status === 'error') {
    dotCls = 'sync-dot error';
    text = 'Bağlantı hatası · Yerel önbellek aktif';
  }

  dots.forEach(sel => {
    const el = $(sel);
    if (el) el.className = dotCls;
  });
  labels.forEach(sel => {
    const el = $(sel);
    if (el) el.textContent = text;
  });

  if (banner) {
    if (info.status === 'pending') {
      banner.className = 'banner warn show';
      banner.innerHTML = `<span><strong>Çevrimdışı değişiklikler var:</strong> ${info.pendingCount} işlem bu cihazda güvenle saklanıyor.</span><button type="button" class="chip" id="bannerSyncBtn" style="min-height:30px;padding:4px 10px;">Şimdi Eşitle</button>`;
      $('#bannerSyncBtn')?.addEventListener('click', triggerManualSync);
    } else if (info.status === 'error') {
      banner.className = 'banner err show';
      banner.innerHTML = `<span>GitHub'a ulaşılamadı, önbellekteki son verilerle çalışılıyor.</span><button type="button" class="chip" id="bannerSyncBtn" style="min-height:30px;padding:4px 10px;">Tekrar Dene</button>`;
      $('#bannerSyncBtn')?.addEventListener('click', triggerManualSync);
    } else {
      banner.className = 'banner';
      banner.innerHTML = '';
    }
  }
}

async function triggerManualSync() {
  if (!S.store) return;
  if (!S.store.gh) {
    toast('GitHub bağlı değil — Ayarlar\'dan bağlayabilirsin');
    return;
  }
  toast('Eşitleniyor…');
  const res = await S.store.syncNow();
  if (res.ok) {
    loadStateFromStore();
    renderView(S.view);
    toast('GitHub ile eşitlendi ✓');
  } else {
    toast(res.error || 'Eşitlenemedi');
  }
}

// ---------- Tema, Gizlilik & Para Birimi ----------
const THEME_ICONS = {
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17Z" fill="currentColor" stroke="none"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5Z"/></svg>'
};

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'dark') root.setAttribute('data-theme', 'dark');
  else if (mode === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  ['#themeBtnTop', '#themeBtnSide'].forEach(sel => {
    const btn = $(sel);
    if (btn) btn.innerHTML = THEME_ICONS[mode] || THEME_ICONS.auto;
  });
}

function cycleTheme() {
  const cur = localStorage.getItem(THEME_KEY) || 'auto';
  const next = cur === 'auto' ? 'dark' : cur === 'dark' ? 'light' : 'auto';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
  applyTheme(next);
  toast(`Tema: ${next === 'auto' ? 'Sistem' : next === 'dark' ? 'Koyu' : 'Açık'}`);
}

function togglePrivacy() {
  S.privacy = !S.privacy;
  try {
    localStorage.setItem(PRIVACY_KEY, S.privacy ? '1' : '0');
  } catch {}
  ['#privacyBtnTop', '#privacyBtnSide'].forEach(sel => {
    $(sel)?.classList.toggle('active', S.privacy);
  });
  renderView(S.view);
  toast(S.privacy ? 'Gizlilik modu açık (tutarlar gizli)' : 'Tutarlar görünür');
}

function toggleCurrency() {
  S.currency = S.currency === 'TRY' ? 'USD' : 'TRY';
  const btn = $('#currencyToggleBtn');
  if (btn) btn.textContent = S.currency === 'USD' ? '$ USD' : '₺ TRY';
  renderView(S.view);
}

// ---------- State Senkronu ----------
function loadStateFromStore() {
  for (const col of COLLECTIONS) {
    const key = COLLECTION_TO_STATE[col];
    if (key) S[key] = S.store.list(col);
  }
  if (!S.addPersonId || !S.people.find(p => p.id === S.addPersonId && !p.archived)) {
    const active = S.people.find(p => !p.archived);
    S.addPersonId = active ? active.id : S.people[0]?.id || null;
  }
}

async function seedIfNeeded() {
  const needsPeople = S.people.length === 0;
  const needsTypes = S.incomeTypes.length === 0;
  const needsCats = S.expenseCategories.length === 0;
  if (!needsPeople && !needsTypes && !needsCats) return;

  await S.store.transaction(draft => {
    if (draft.people.length === 0) {
      draft.people.push(
        { id: newId('p'), name: 'Kürşat', archived: false, createdAt: new Date().toISOString() },
        { id: newId('p'), name: 'Baba', archived: false, createdAt: new Date().toISOString() }
      );
    }
    if (draft.income_types.length === 0 && draft.people.length > 0) {
      const me = draft.people[0];
      const baba = draft.people[1] || draft.people[0];
      const defs = [
        { name: 'Maaş', personId: me.id },
        { name: 'Maaş', personId: baba.id },
        { name: 'Buğday Parası', personId: baba.id }
      ];
      for (const d of defs) {
        draft.income_types.push({ id: newId('it'), ...d, archived: false, createdAt: new Date().toISOString() });
      }
    }
    if (draft.expense_categories.length === 0) {
      for (const name of ['Harçlık', 'Market', 'Elektrik Faturası', 'Su Faturası']) {
        draft.expense_categories.push({ id: newId('ec'), name, archived: false, createdAt: new Date().toISOString() });
      }
    }
  }, 'KFT Gemini başlangıç verileri');

  loadStateFromStore();
}

// ---------- Sheet Yönetimi (Draft Korumalı & Swipe-to-Dismiss) ----------
function openSheet(html, opts = {}) {
  const overlay = $('#sheetOverlay');
  const content = $('#sheetContent');
  S.sheetDirty = false;
  content.innerHTML = `<div class="sheet-handle" id="sheetHandle"></div>${html}`;
  overlay.classList.add('open');
  document.body.classList.add('sheet-open');

  if (opts.trackDirty !== false) {
    content.querySelectorAll('input, select, textarea').forEach(el => {
      el.addEventListener('input', () => {
        S.sheetDirty = true;
      });
      el.addEventListener('change', () => {
        S.sheetDirty = true;
      });
    });
  }

  // Dokunmatik aşağı kaydırarak kapatma
  const handle = $('#sheetHandle');
  if (handle) {
    let startY = 0;
    let deltaY = 0;
    handle.addEventListener(
      'touchstart',
      e => {
        startY = e.touches[0].clientY;
        deltaY = 0;
        content.style.transition = 'none';
      },
      { passive: true }
    );
    handle.addEventListener(
      'touchmove',
      e => {
        deltaY = Math.max(0, e.touches[0].clientY - startY);
        content.style.transform = `translateY(${deltaY}px)`;
      },
      { passive: true }
    );
    handle.addEventListener('touchend', () => {
      content.style.transition = 'transform 0.18s ease';
      if (deltaY > 90) {
        content.style.transform = '';
        requestCloseSheet();
      } else {
        content.style.transform = '';
      }
    });
  }
}

function requestCloseSheet() {
  if (S.sheetDirty) {
    const content = $('#sheetContent');
    if (content && !$('#draftGuardBanner')) {
      const guard = document.createElement('div');
      guard.id = 'draftGuardBanner';
      guard.className = 'draft-guard';
      guard.innerHTML =
        '<span>Kaydedilmemiş değişiklikler var. Çıkılsın mı?</span>' +
        '<div style="display:flex;gap:6px;">' +
        '<button type="button" class="chip" id="dgKeep" style="min-height:30px;padding:4px 10px;">Kal</button>' +
        '<button type="button" class="chip active" id="dgClose" style="min-height:30px;padding:4px 10px;background:var(--expense);border-color:var(--expense);color:#fff;">Kapat</button>' +
        '</div>';
      content.insertBefore(guard, content.children[1] || null);
      $('#dgKeep').addEventListener('click', () => guard.remove());
      $('#dgClose').addEventListener('click', closeSheet);
      return;
    }
  }
  closeSheet();
}

function closeSheet() {
  S.sheetDirty = false;
  $('#sheetOverlay')?.classList.remove('open');
  document.body.classList.remove('sheet-open');
  const content = $('#sheetContent');
  if (content) {
    content.style.transform = '';
    content.innerHTML = '';
  }
}

async function runAtomic(btn, mutatorFn, commitMessage, afterOk) {
  if (S.inFlight) return;
  S.inFlight = true;
  const origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Kaydediliyor…';
  }
  try {
    const res = await S.store.transaction(mutatorFn, commitMessage);
    loadStateFromStore();
    if (afterOk) afterOk(res);
  } catch (e) {
    console.error('İşlem hatası', e);
    toast(e?.message || 'Kaydedilemedi — bağlantı veya doğrulama hatası');
  } finally {
    S.inFlight = false;
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

// ---------- Ortak Kişi Çipleri ----------
function renderPersonChips(containerId, onChange) {
  const el = $(`#${containerId}`);
  if (!el) return;
  const active = S.people.filter(p => !p.archived);
  let html = `<button type="button" class="chip${S.personFilter === 'all' ? ' active' : ''}" data-pf="all">Tümü</button>`;
  html += active
    .map(p => `<button type="button" class="chip${S.personFilter === p.id ? ' active' : ''}" data-pf="${p.id}">${esc(p.name)}</button>`)
    .join('');
  html += `<button type="button" class="chip-manage" title="Kişileri Yönet"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>`;
  el.innerHTML = html;
  el.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      S.personFilter = btn.dataset.pf;
      onChange(S.personFilter);
    });
  });
  el.querySelector('.chip-manage')?.addEventListener('click', openSettingsSheet);
}

// ---------- Navigasyon ----------
function setView(v) {
  S.view = v;
  $$('.view').forEach(el => el.classList.remove('active'));
  $(`#view-${v}`)?.classList.add('active');
  $$('.tab').forEach(el => el.classList.toggle('active', el.dataset.view === v));
  renderView(v);
}

function renderView(v) {
  if (v === 'ozet') renderOzet();
  else if (v === 'ekle') renderEkle();
  else if (v === 'birikim') renderBirikim();
  else if (v === 'analiz') renderAnaliz();
  else if (v === 'kayitlar') renderKayitlar();
}

// ---------- ÖZET GÖRÜNÜMÜ ----------
function renderOzet() {
  renderPersonChips('ozetPersonChips', () => renderOzet());

  const ov = computeOverview(S, S.personFilter);
  const range = periodRange('thisMonth');
  const monthEntries = unifiedEntries(S, S.personFilter, 'spender').filter(e => inRange(e.date, range));
  const incM = monthEntries.filter(e => e.kind === 'gelir').reduce((a, e) => a + e.amount, 0);
  const expM = monthEntries.filter(e => e.kind === 'gider').reduce((a, e) => a + e.amount, 0);

  $('#heroTitleLabel').textContent = ov.totalDebts > 0 ? 'Net Servet (Varlık − Borç)' : 'Toplam Servet';
  $('#heroNetWorth').textContent = fmt(ov.netWorth);
  $('#heroSubLine').textContent =
    ov.totalDebts > 0
      ? `Brüt Varlık ${fmt(ov.grossTotal)} · Borç ${fmt(ov.totalDebts)} · Toplam K/Z ${fmt(ov.investProfit + ov.realizedProfit)}`
      : `Nakit ${fmt(ov.cash)} · Portföy ${fmt(ov.investValue)} · Açık K/Z ${(ov.investProfit >= 0 ? '+' : '') + fmt(ov.investProfit)}`;

  $('#kpiCashVal').textContent = fmt(ov.cash);
  $('#kpiPortfolioVal').textContent = fmt(ov.investValue);
  const netMonth = round2(incM - expM);
  $('#kpiMonthVal').textContent = (netMonth >= 0 ? '+' : '') + fmt(netMonth);

  // Dağılım & Ana Para Mutabakat Kartı
  const posTotal = Math.max(0, ov.cash) + Math.max(0, ov.fundValue) + Math.max(0, ov.metalValue);
  const pct = part => (posTotal > 0 ? (Math.max(0, part) / posTotal) * 100 : 0);
  const rate = S.currency === 'USD' && S.usdTry > 0 ? S.usdTry : 1;
  const sym = S.currency === 'USD' ? '$' : '₺';
  const donut = donutSvg(
    [
      { value: Math.max(0, ov.cash), color: 'var(--cash)' },
      { value: Math.max(0, ov.fundValue), color: 'var(--accent)' },
      { value: Math.max(0, ov.metalValue), color: 'var(--gold)' }
    ],
    {
      size: 98,
      stroke: 13,
      centerLabel: S.privacy ? '••••' : fmtCompact(ov.grossTotal / rate, sym),
      centerSub: 'Brüt Varlık'
    }
  );

  const profitSpan = v => `<span class="${v >= 0 ? 'profit-pos' : 'profit-neg'}">${v >= 0 ? '+' : ''}${fmt(v)}</span>`;
  const sourceRows = principalBySource(S, S.personFilter, ov);
  const missingNotice =
    ov.missingFundPrices + ov.missingMetalPrices > 0
      ? `<span class="badge warn">${ov.missingFundPrices + ov.missingMetalPrices} varlıkta fiyat eksik (maliyetten)</span>`
      : `<span class="badge pos">Güncel fiyatlı</span>`;

  $('#breakdownCard').innerHTML =
    `<div class="card-title"><span>Varlık Dağılımı & Mutabakat</span>${missingNotice}</div>` +
    `<div class="donut-row">${donut}` +
    `<div style="flex:1;min-width:0;">` +
    `<div style="font-size:12px;color:var(--ink-faint);">Toplam Ana Para</div>` +
    `<div class="num" style="font-size:20px;font-weight:800;margin-top:2px;">${fmt(ov.totalPrincipal)}</div>` +
    `<div style="font-size:12px;color:var(--ink-soft);margin-top:4px;">Açık K/Z: ${profitSpan(ov.investProfit)}</div>` +
    `<div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">Realize K/Z: ${profitSpan(ov.realizedProfit)}</div>` +
    `</div></div>` +
    `<div class="breakdown-stack">` +
    `<div class="seg cash" style="width:${pct(ov.cash)}%"></div>` +
    `<div class="seg fund" style="width:${pct(ov.fundValue)}%"></div>` +
    `<div class="seg metal" style="width:${pct(ov.metalValue)}%"></div>` +
    `</div>` +
    `<div class="breakdown-rows" style="margin-top:12px;">` +
    `<div class="breakdown-row"><div class="label"><span class="dot cash"></span>Nakit</div><div class="amounts"><div class="main num">${fmt(ov.cash)}</div>${ov.cash < 0 ? '<div class="sub" style="color:var(--expense);">Negatif bakiye</div>' : ''}</div></div>` +
    `<div class="breakdown-row"><div class="label"><span class="dot fund"></span>Yatırım Fonu</div><div class="amounts"><div class="main num">${fmt(ov.fundValue)}</div><div class="sub">Net Likidasyon ${fmt(ov.fundNetLiquidationValue)} · ${profitSpan(ov.fundProfit)}</div></div></div>` +
    `<div class="breakdown-row"><div class="label"><span class="dot metal"></span>Kıymetli Maden</div><div class="amounts"><div class="main num">${fmt(ov.metalValue)}</div><div class="sub">Ana Para ${fmt(ov.metalCost)} · ${profitSpan(ov.metalProfit)}</div></div></div>` +
    `</div>` +
    (sourceRows.length
      ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--hairline);">` +
        `<div style="font-size:11px;font-weight:700;color:var(--ink-faint);text-transform:uppercase;margin-bottom:6px;">Ana Para Kaynak Kırılımı</div>` +
        sourceRows
          .map(
            r =>
              `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0;"><span style="color:var(--ink-soft);">${esc(r.name)}</span><span class="num" style="font-weight:700;">${fmt(r.amount)}${r.hasInvestment ? ` (${profitSpan(r.profit)})` : ''}</span></div>`
          )
          .join('') +
        `</div>`
      : '');

  // Gelir Kaynakları (Kumbaralar)
  let types = S.incomeTypes.filter(t => !t.archived);
  if (S.personFilter !== 'all') types = types.filter(t => t.personId === S.personFilter);
  const potGrid = $('#potGrid');
  if (types.length === 0) {
    potGrid.innerHTML = `<div class="empty"><img src="./assets/empty-vault.png" alt="" class="empty-vault-img">Henüz gelir kaynağı yok. Yukarıdaki + ile ekleyebilirsin.</div>`;
  } else {
    potGrid.innerHTML = types
      .map(t => {
        const b = computePotBalance(S, t.id);
        const inv = incomeTypeInvestmentStats(S, t.id, ov.fundLedger, ov.metalLedger);
        return (
          `<div class="pot-card" data-id="${t.id}">` +
          `<div><div class="pot-name">${esc(t.name)} <span class="pot-person">· ${esc(personName(S, t.personId))}</span></div>` +
          `<div class="pot-sub">Gelen ${fmt(b.income)} · Harcanan ${fmt(b.spent)}${b.transfersOut > 0 ? ` · Yatırıma ${fmt(b.transfersOut)}` : ''}</div>` +
          (inv.hasInvestment ? `<div class="pot-sub">Bağlı Yatırım: ${fmt(inv.value)} (${profitSpan(inv.profit)})</div>` : '') +
          `</div><div class="pot-balance num ${b.balance < 0 ? 'neg' : 'pos'}">${fmt(b.balance)}</div></div>`
        );
      })
      .join('');
    potGrid.querySelectorAll('.pot-card').forEach(card => {
      card.addEventListener('click', () => openIncomeTypeSheet(card.dataset.id));
    });
  }

  // Borçlar & Kredi Kartları
  let debts = S.debts.filter(d => !d.archived);
  if (S.personFilter !== 'all') debts = debts.filter(d => d.personId === S.personFilter);
  const debtGrid = $('#debtGrid');
  if (debts.length === 0) {
    debtGrid.innerHTML = `<div class="empty" style="padding:14px;">Kayıtlı borç veya kredi kartı yok.</div>`;
  } else {
    debtGrid.innerHTML = debts
      .map(
        d =>
          `<div class="pot-card" data-debt="${d.id}">` +
          `<div><div class="pot-name">${esc(d.name)} <span class="pot-person">· ${esc(personName(S, d.personId))}</span></div>` +
          `<div class="pot-sub">${esc(d.note || 'Borç / Kredi Kartı')}</div></div>` +
          `<div class="pot-balance num neg">−${fmt(d.amount)}</div></div>`
      )
      .join('');
    debtGrid.querySelectorAll('[data-debt]').forEach(card => {
      card.addEventListener('click', () => openDebtSheet(card.dataset.debt));
    });
  }

  // Son Hareketler
  const recent = unifiedEntries(S, S.personFilter, 'spender').slice(0, 7);
  const recentList = $('#recentList');
  if (recent.length === 0) {
    recentList.innerHTML = `<div class="empty" style="border:none;"><img src="./assets/empty-vault.png" alt="" class="empty-vault-img">Henüz işlem yok. Ortadaki <strong>+</strong> butonuyla ilk kaydını gir.</div>`;
  } else {
    recentList.innerHTML = recent.map(e => txRowHtml(e)).join('');
    bindTxRows(recentList);
  }
}

function txRowHtml(e) {
  const sign = e.kind === 'gider' ? '−' : e.kind === 'gelir' ? '+' : '⇄';
  return (
    `<div class="tx-row" data-kind="${e.kind}" data-id="${e.id}">` +
    `<div class="tx-dot ${e.kind}"></div>` +
    `<div class="tx-main"><div class="tx-label">${esc(e.label)}</div>` +
    `<div class="tx-sub">${esc((e.sub ? e.sub + ' · ' : '') + esc(e.personName) + ' · ' + dayLabel(e.date))}</div></div>` +
    `<div class="tx-amount num ${e.kind}">${sign} ${fmt(e.amount)}</div></div>`
  );
}

function bindTxRows(container) {
  container.querySelectorAll('.tx-row').forEach(row => {
    row.addEventListener('click', () => {
      if (row.dataset.kind === 'transfer') openTransferDetailSheet(row.dataset.id);
      else openEditTxSheet(row.dataset.kind, row.dataset.id);
    });
  });
}

// ---------- HERO MUTABAKAT DRILL-DOWN SHEET'LERİ ----------
function openDrilldownSheet(mode) {
  const ov = computeOverview(S, S.personFilter);
  if (mode === 'cash') {
    const rows = unifiedEntries(S, S.personFilter, 'account').slice(0, 30);
    openSheet(
      `<div class="sheet-title">Nakit Mutabakatı · ${fmt(ov.cash)}</div>` +
        `<div class="field-hint" style="margin-bottom:12px;">Seçili kapsamdaki nakit hesabını oluşturan son 30 hareket (gelir, gider ve yatırımla yapılan transferler).</div>` +
        `<div class="tx-list">${rows.length ? rows.map(txRowHtml).join('') : '<div class="empty">Hareket yok.</div>'}</div>`,
      { trackDirty: false }
    );
    bindTxRows($('#sheetContent'));
  } else if (mode === 'portfolio') {
    const activeMetals = ov.metalLedger.holdings.filter(h => h.remaining > 1e-9 && (S.personFilter === 'all' || h.personId === S.personFilter));
    const activeFunds = ov.fundLedger.lots.filter(l => l.remaining > 1e-9 && (S.personFilter === 'all' || l.personId === S.personFilter));
    openSheet(
      `<div class="sheet-title">Portföy Detayı · ${fmt(ov.investValue)}</div>` +
        `<div class="field-hint" style="margin-bottom:12px;">Brüt değer: ${fmt(ov.investValue)} · Tahmini Stopaj Sonrası Net Likidasyon: <strong>${fmt(ov.investNetLiquidation)}</strong></div>` +
        `<div class="section-title">Yatırım Fonları (${activeFunds.length} lot)</div>` +
        (activeFunds.length
          ? activeFunds
              .map(
                l =>
                  `<div class="cat-row"><div class="cat-name">${esc(l.fundName)} · ${fmtNum(l.remaining, 4)} adet<div class="pot-sub">${l.hasPrice ? `Güncel fiyat: ${fmtTry(l.curPrice)}` : 'Fiyat girilmedi (maliyetten)'}</div></div><div class="num" style="font-weight:700;">${fmt(l.value)}</div></div>`
              )
              .join('')
          : '<div class="empty">Fon lotu yok.</div>') +
        `<div class="section-title">Kıymetli Maden (${activeMetals.length} varlık)</div>` +
        (activeMetals.length
          ? activeMetals
              .map(
                h =>
                  `<div class="cat-row"><div class="cat-name">${esc(h.material)} · ${esc(h.bank || '—')}<div class="pot-sub">${fmtNum(h.remaining)} ${esc(h.unit)} · Birim: ${fmtTry(h.effectivePrice)}</div></div><div class="num" style="font-weight:700;">${fmt(h.value)}</div></div>`
              )
              .join('')
          : '<div class="empty">Kıymetli maden yok.</div>'),
      { trackDirty: false }
    );
  } else if (mode === 'month') {
    const range = periodRange('thisMonth');
    const rows = unifiedEntries(S, S.personFilter, 'spender').filter(e => inRange(e.date, range));
    const inc = rows.filter(e => e.kind === 'gelir').reduce((a, e) => a + e.amount, 0);
    const exp = rows.filter(e => e.kind === 'gider').reduce((a, e) => a + e.amount, 0);
    const trf = rows.filter(e => e.kind === 'transfer').reduce((a, e) => a + e.amount, 0);
    openSheet(
      `<div class="sheet-title">Bu Ay Nakit Akışı</div>` +
        `<div class="stat-row" style="margin:10px 0 14px;">` +
        `<div class="stat-tile"><div class="l">Gelir</div><div class="v num income">${fmt(inc)}</div></div>` +
        `<div class="stat-tile"><div class="l">Gider</div><div class="v num expense">${fmt(exp)}</div></div>` +
        `<div class="stat-tile"><div class="l">Transfer</div><div class="v num">${fmt(trf)}</div></div>` +
        `</div>` +
        `<div class="tx-list">${rows.length ? rows.map(txRowHtml).join('') : '<div class="empty">Bu ay işlem yok.</div>'}</div>`,
      { trackDirty: false }
    );
    bindTxRows($('#sheetContent'));
  }
}

// ---------- EKLE GÖRÜNÜMÜ ----------
function renderEkle() {
  const persons = S.people.filter(p => !p.archived);
  $('#f_person').innerHTML = persons.map(p => `<option value="${p.id}"${p.id === S.addPersonId ? ' selected' : ''}>${esc(p.name)}</option>`).join('');

  const cats = S.expenseCategories.filter(c => !c.archived);
  $('#f_category').innerHTML = cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const allActiveTypes = S.incomeTypes.filter(t => !t.archived);
  const lastSrc = localStorage.getItem(LAST_SOURCE_KEY);

  // Ödeme kaynağı tüm aktif hesaplardan seçilebilir (başka kişinin hesabından ödenen kendi harcaması dahil!)
  const potOptionHtml = t => {
    const b = computePotBalance(S, t.id);
    return `<option value="${t.id}">${esc(t.name)} · ${esc(personName(S, t.personId))} (${fmtTry(b.balance)})</option>`;
  };
  $('#f_paidfrom').innerHTML = allActiveTypes.map(potOptionHtml).join('');
  if (lastSrc && allActiveTypes.some(t => t.id === lastSrc)) {
    $('#f_paidfrom').value = lastSrc;
  }

  const personTypes = allActiveTypes.filter(t => t.personId === S.addPersonId);
  $('#f_incometype').innerHTML = (personTypes.length ? personTypes : allActiveTypes).map(potOptionHtml).join('');
  $('#f_tr_from').innerHTML = allActiveTypes.map(potOptionHtml).join('');
  $('#f_tr_to').innerHTML = allActiveTypes.map(potOptionHtml).join('');

  if (!$('#f_date').value) $('#f_date').value = todayStr();
  applyAddMode();
}

function applyAddMode() {
  $$('#addModeTabs button').forEach(b => b.classList.toggle('active', b.dataset.mode === S.addMode));
  const isExp = S.addMode === 'gider';
  const isInc = S.addMode === 'gelir';
  const isTrf = S.addMode === 'transfer';

  $('#f_person_label').textContent = isExp ? 'Kimin Harcaması' : isInc ? 'Kişi' : 'İşlemi Yapan Kişi';
  $('#expenseCatField').style.display = isExp ? '' : 'none';
  $('#paidFromField').style.display = isExp ? '' : 'none';
  $('#incomeTypeField').style.display = isInc ? '' : 'none';
  $('#transferFields').style.display = isTrf ? '' : 'none';

  const btn = $('#submitBtn');
  btn.className = `btn-primary ${isExp ? 'expense' : isInc ? 'income' : 'gold'}`;
  btn.textContent = isExp ? 'Gideri Kaydet' : isInc ? 'Geliri Kaydet' : 'Transferi Kaydet';
}

// ---------- BİRİKİM (MADEN + FONLAR + FIFO) ----------
function renderBirikim() {
  renderPersonChips('birikimPersonChips', () => renderBirikim());

  const ov = computeOverview(S, S.personFilter);
  const totalProfit = round2(ov.investProfit);
  const profCls = totalProfit >= 0 ? 'profit-pos' : 'profit-neg';
  const donut = donutSvg(
    [
      { value: ov.fundValue, color: 'var(--accent)' },
      { value: ov.metalValue, color: 'var(--gold)' }
    ],
    { size: 84, stroke: 12, centerLabel: S.privacy ? '••••' : fmtCompact(ov.investValue), centerSub: 'Portföy' }
  );

  $('#birikimOverviewCard').innerHTML =
    `<div class="card-title"><span>Birikim Özeti</span><span class="badge gold">Net Likidasyon: ${fmt(ov.investNetLiquidation)}</span></div>` +
    `<div class="donut-row">${donut}` +
    `<div style="flex:1;min-width:0;">` +
    `<div class="num" style="font-size:24px;font-weight:800;">${fmt(ov.investValue)}</div>` +
    `<div style="font-size:12.5px;color:var(--ink-soft);margin-top:3px;">Ana Para ${fmt(ov.investCost)} · Açık K/Z <span class="${profCls}">${totalProfit >= 0 ? '+' : ''}${fmt(totalProfit)}</span></div>` +
    `<div style="font-size:12px;color:var(--ink-faint);margin-top:2px;">Gerçekleşen Net Kâr: <span class="${ov.realizedProfit >= 0 ? 'profit-pos' : 'profit-neg'}">${ov.realizedProfit >= 0 ? '+' : ''}${fmt(ov.realizedProfit)}</span></div>` +
    `</div></div>`;

  $$('#birikimSubTabs button').forEach(b => b.classList.toggle('active', b.dataset.sub === S.birikimSubView));
  $('#birikimMetalPane').style.display = S.birikimSubView === 'metal' ? '' : 'none';
  $('#birikimFundPane').style.display = S.birikimSubView === 'fund' ? '' : 'none';

  if (S.birikimSubView === 'metal') renderMetalPane(ov);
  else renderFundPane(ov);
}

function renderMetalPane(ov) {
  const holdings = ov.metalLedger.holdings.filter(h => S.personFilter === 'all' || h.personId === S.personFilter);
  const sales = ov.metalLedger.sales.filter(s => S.personFilter === 'all' || s.personId === S.personFilter);
  const activeHoldings = holdings.filter(h => h.remaining > 1e-9);

  $('#bMaliyet').textContent = fmt(ov.metalCost);
  $('#bDeger').textContent = fmt(ov.metalValue);
  const karEl = $('#bKar');
  karEl.textContent = `${ov.metalProfit >= 0 ? '+' : ''}${fmt(ov.metalProfit)}`;
  karEl.className = `v num ${ov.metalProfit >= 0 ? 'income' : 'expense'}`;
  const relEl = $('#bRealized');
  relEl.textContent = `${ov.metalRealizedProfit >= 0 ? '+' : ''}${fmt(ov.metalRealizedProfit)}`;
  relEl.className = `v num ${ov.metalRealizedProfit >= 0 ? 'income' : 'expense'}`;

  // Materyale göre dağılım
  const byMat = new Map();
  for (const h of activeHoldings) {
    const key = h.material || '—';
    if (!byMat.has(key)) byMat.set(key, { name: key, qty: 0, unit: h.unit, total: 0 });
    const item = byMat.get(key);
    item.qty = round4(item.qty + h.remaining);
    item.total = round2(item.total + h.value);
  }
  const matArr = Array.from(byMat.values()).sort((a, b) => b.total - a.total);
  const maxMat = matArr[0]?.total || 1;
  const matEl = $('#materialBars');
  if (matArr.length === 0) {
    matEl.innerHTML = `<div class="empty" style="border:none;"><img src="./assets/empty-vault.png" alt="" class="empty-vault-img">Henüz kıymetli maden eklenmedi.</div>`;
  } else {
    matEl.innerHTML = matArr
      .map(
        m =>
          `<div class="bar-row"><div class="bar-top"><span class="name">${esc(m.name)}</span><span class="amt num">${fmtNum(m.qty)} ${esc(m.unit)} · ${fmt(m.total)}</span></div><div class="bar-track"><div class="bar-fill gold" style="width:${Math.max(4, Math.round((m.total / maxMat) * 100))}%"></div></div></div>`
      )
      .join('');
  }

  // Filtre çipleri
  const profitCnt = activeHoldings.filter(h => h.profit > 0).length;
  const lossCnt = activeHoldings.filter(h => h.profit < 0).length;
  const hfEl = $('#holdingsFilterChips');
  hfEl.innerHTML = [
    { key: 'all', label: `Tümü (${activeHoldings.length})` },
    { key: 'profit', label: `Kârda (${profitCnt})` },
    { key: 'loss', label: `Zararda (${lossCnt})` }
  ]
    .map(o => `<button type="button" class="chip${S.holdingsFilter === o.key ? ' active' : ''}" data-hf="${o.key}">${esc(o.label)}</button>`)
    .join('');
  hfEl.querySelectorAll('.chip').forEach(b =>
    b.addEventListener('click', () => {
      S.holdingsFilter = b.dataset.hf;
      renderBirikim();
    })
  );

  let list = activeHoldings;
  if (S.holdingsFilter === 'profit') list = list.filter(h => h.profit > 0);
  else if (S.holdingsFilter === 'loss') list = list.filter(h => h.profit < 0);

  const listEl = $('#holdingsList');
  if (list.length === 0) {
    listEl.innerHTML = `<div class="empty">Bu filtrede kıymetli maden varlığı yok.</div>`;
  } else {
    listEl.innerHTML = list
      .slice()
      .sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''))
      .map(h => {
        const cls = h.profit >= 0 ? 'pos' : 'neg';
        const sign = h.profit >= 0 ? '+' : '';
        const srcBadge =
          h.priceStatus === 'live_group'
            ? `<span class="badge pos">Ortak Fiyat</span>`
            : h.priceStatus === 'holding_fallback'
              ? `<span class="badge">Kendi Fiyatı</span>`
              : `<span class="badge warn">Maliyet Üzerinden</span>`;
        return (
          `<div class="holding-card" data-id="${h.id}">` +
          `<div class="holding-top"><div><div class="holding-material">${esc(h.material)} <span class="pot-person">· ${esc(personName(S, h.personId))}</span></div>` +
          `<div class="holding-sub">${esc(h.bank || 'Banka yok')} · ${dayLabel(h.purchaseDate)} ${srcBadge}</div></div>` +
          `<div class="holding-profit ${cls}">${sign}${fmt(h.profit)}<div class="holding-profit-pct">${sign}${fmtNum(h.pct, 1)}%</div></div></div>` +
          `<div class="holding-bottom">` +
          `<div class="cell"><div class="l">Kalan</div><div class="v num">${fmtNum(h.remaining)} ${esc(h.unit)}</div></div>` +
          `<div class="cell"><div class="l">Maliyet</div><div class="v num">${fmt(h.cost)}</div></div>` +
          `<div class="cell"><div class="l">Birim Fiyat</div><div class="v num">${fmtTry(h.effectivePrice)}</div></div>` +
          `<div class="cell"><div class="l">Değer</div><div class="v num">${fmt(h.value)}</div></div>` +
          `</div></div>`
        );
      })
      .join('');
    listEl.querySelectorAll('.holding-card').forEach(c => c.addEventListener('click', () => openHoldingSheet(c.dataset.id)));
  }

  const msEl = $('#metalSalesList');
  if (sales.length === 0) {
    msEl.innerHTML = `<div class="empty" style="padding:14px;">Henüz maden satışı yok.</div>`;
  } else {
    msEl.innerHTML = sales
      .slice()
      .reverse()
      .map(
        s =>
          `<div class="holding-card" data-ms="${s.id}">` +
          `<div class="holding-top"><div><div class="holding-material">${esc(s.material)} (${esc(s.bank || '—')})</div><div class="holding-sub">${dayLabel(s.saleDate)} · ${fmtNum(s.quantity)} ${esc(s.unit || 'gram')} satış</div></div>` +
          `<div class="holding-profit ${s.netProfit >= 0 ? 'pos' : 'neg'}">${s.netProfit >= 0 ? '+' : ''}${fmt(s.netProfit)}</div></div>` +
          `</div>`
      )
      .join('');
    msEl.querySelectorAll('[data-ms]').forEach(c => c.addEventListener('click', () => openMetalSaleDetailSheet(c.dataset.ms)));
  }
}

function renderFundPane(ov) {
  const lots = ov.fundLedger.lots.filter(l => S.personFilter === 'all' || l.personId === S.personFilter);
  const sales = ov.fundLedger.sales.filter(s => S.personFilter === 'all' || s.personId === S.personFilter);
  const activeLots = lots.filter(l => l.remaining > 1e-9);
  const totalUnits = round4(activeLots.reduce((a, l) => a + l.remaining, 0));

  $('#fAdet').textContent = fmtNum(totalUnits, 4);
  $('#fMaliyet').textContent = fmt(ov.fundCost);
  $('#fDeger').textContent = fmt(ov.fundValue);
  $('#fNetLiq').textContent = fmt(ov.fundNetLiquidationValue);
  const relEl = $('#fRealized');
  relEl.textContent = `${ov.fundRealizedProfit >= 0 ? '+' : ''}${fmt(ov.fundRealizedProfit)}`;
  relEl.className = `v num ${ov.fundRealizedProfit >= 0 ? 'income' : 'expense'}`;

  // Fon dağılımı + stopaj oranları
  const byFund = new Map();
  for (const l of activeLots) {
    const key = l.fundName || '—';
    if (!byFund.has(key)) byFund.set(key, { name: key, qty: 0, total: 0, rate: l.stopajRate });
    const item = byFund.get(key);
    item.qty = round4(item.qty + l.remaining);
    item.total = round2(item.total + l.value);
  }
  const fundArr = Array.from(byFund.values()).sort((a, b) => b.total - a.total);
  const maxFund = fundArr[0]?.total || 1;
  const fundBars = $('#fundBars');
  if (fundArr.length === 0) {
    fundBars.innerHTML = `<div class="empty" style="border:none;"><img src="./assets/empty-vault.png" alt="" class="empty-vault-img">Henüz yatırım fonu alışı yok.</div>`;
  } else {
    fundBars.innerHTML = fundArr
      .map(
        f =>
          `<div class="bar-row"><div class="bar-top"><span class="name">${esc(f.name)} <span class="badge">Stopaj %${fmtNum(f.rate * 100, 1)}</span></span><span class="amt num">${fmtNum(f.qty, 4)} adet · ${fmt(f.total)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, Math.round((f.total / maxFund) * 100))}%"></div></div></div>`
      )
      .join('');
  }

  $$('#fundTxTabs button').forEach(b => b.classList.toggle('active', b.dataset.sub === S.fundTxView));
  $('#fundLotsList').style.display = S.fundTxView === 'lots' ? '' : 'none';
  $('#fundSalesList').style.display = S.fundTxView === 'sales' ? '' : 'none';

  const lotsEl = $('#fundLotsList');
  if (lots.length === 0) {
    lotsEl.innerHTML = `<div class="empty">Henüz fon lotu yok.</div>`;
  } else {
    lotsEl.innerHTML = lots
      .slice()
      .sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''))
      .map(l => {
        const cls = l.profit >= 0 ? 'pos' : 'neg';
        const sign = l.profit >= 0 ? '+' : '';
        const priceBadge = l.hasPrice ? `<span class="badge pos">Güncel Fiyat</span>` : `<span class="badge warn">Maliyetten</span>`;
        return (
          `<div class="holding-card" data-lot="${l.id}">` +
          `<div class="holding-top"><div><div class="holding-material">${esc(l.fundName)} <span class="pot-person">· ${esc(personName(S, l.personId))}</span></div>` +
          `<div class="holding-sub">${dayLabel(l.purchaseDate)} · ${fmtNum(l.quantity, 4)} alış${l.soldQuantity > 0 ? ` · ${fmtNum(l.soldQuantity, 4)} satıldı` : ''} ${priceBadge}</div></div>` +
          `<div class="holding-profit ${cls}">${sign}${fmt(l.profit)}<div class="holding-profit-pct">${sign}${fmtNum(l.pct, 1)}%</div></div></div>` +
          `<div class="holding-bottom">` +
          `<div class="cell"><div class="l">Kalan</div><div class="v num">${fmtNum(l.remaining, 4)}</div></div>` +
          `<div class="cell"><div class="l">Maliyet</div><div class="v num">${fmt(l.cost)}</div></div>` +
          `<div class="cell"><div class="l">Brüt Değer</div><div class="v num">${fmt(l.grossValue)}</div></div>` +
          `<div class="cell"><div class="l">Net Likid.</div><div class="v num">${fmt(l.netLiquidationValue)}</div></div>` +
          `</div></div>`
        );
      })
      .join('');
    lotsEl.querySelectorAll('[data-lot]').forEach(c => c.addEventListener('click', () => openFundLotSheet(c.dataset.lot)));
  }

  const salesEl = $('#fundSalesList');
  if (sales.length === 0) {
    salesEl.innerHTML = `<div class="empty">Henüz fon satışı yok.</div>`;
  } else {
    salesEl.innerHTML = sales
      .slice()
      .reverse()
      .map(
        s =>
          `<div class="holding-card" data-sale="${s.id}">` +
          `<div class="holding-top"><div><div class="holding-material">${esc(s.fundName)} <span class="pot-person">· ${esc(personName(S, s.personId))}</span></div>` +
          `<div class="holding-sub">${dayLabel(s.saleDate)} · ${fmtNum(s.quantity, 4)} adet · ${s.hasActualStopaj ? '<span class="badge pos">Ekstre Stopajı</span>' : '<span class="badge">Tahmini Stopaj</span>'}</div></div>` +
          `<div class="holding-profit ${s.netProfit >= 0 ? 'pos' : 'neg'}">${s.netProfit >= 0 ? '+' : ''}${fmt(s.netProfit)}<div class="holding-profit-pct">Net Kâr</div></div></div>` +
          `<div class="holding-bottom">` +
          `<div class="cell"><div class="l">Maliyet</div><div class="v num">${fmt(s.costBasis)}</div></div>` +
          `<div class="cell"><div class="l">Brüt Kâr</div><div class="v num">${fmt(s.grossProfit)}</div></div>` +
          `<div class="cell"><div class="l">Stopaj</div><div class="v num">${fmt(s.stopaj)}</div></div>` +
          `<div class="cell"><div class="l">Nakde Geçen</div><div class="v num">${fmt(s.netProceeds)}</div></div>` +
          `</div></div>`
      )
      .join('');
    salesEl.querySelectorAll('[data-sale]').forEach(c => c.addEventListener('click', () => openFundSaleDetailSheet(c.dataset.sale)));
  }
}

// ---------- ANALİZ & RAPOR ----------
function renderAnaliz() {
  renderPersonChips('raporPersonChips', () => renderAnaliz());
  $$('#periodChips .chip').forEach(c => c.classList.toggle('active', c.dataset.period === S.reportPeriod));
  $$('#scopeChips .chip').forEach(c => c.classList.toggle('active', c.dataset.scope === S.reportScope));

  const range = periodRange(S.reportPeriod);
  const scoped = unifiedEntries(S, S.personFilter, S.reportScope).filter(e => inRange(e.date, range));
  const inc = scoped.filter(e => e.kind === 'gelir');
  const exp = scoped.filter(e => e.kind === 'gider');
  const incSum = round2(inc.reduce((a, e) => a + e.amount, 0));
  const expSum = round2(exp.reduce((a, e) => a + e.amount, 0));
  const net = round2(incSum - expSum);

  $('#repIncome').textContent = fmt(incSum);
  $('#repExpense').textContent = fmt(expSum);
  const netEl = $('#repNet');
  netEl.textContent = (net >= 0 ? '+' : '') + fmt(net);
  netEl.className = `v num ${net >= 0 ? 'income' : 'expense'}`;

  // 6 Aylık Trend + Tasarruf Oranı
  const months = computeMonthlyTrend(S, S.personFilter, 6);
  const sumInc6 = months.reduce((a, m) => a + m.income, 0);
  const sumExp6 = months.reduce((a, m) => a + m.expense, 0);
  const saveRate = sumInc6 > 0 ? ((sumInc6 - sumExp6) / sumInc6) * 100 : 0;
  const srEl = $('#anSavingsRate');
  srEl.textContent = `%${fmtNum(saveRate, 1)}`;
  srEl.className = `v num ${saveRate >= 0 ? 'income' : 'expense'}`;
  $('#monthlyTrendChart').innerHTML = monthlyTrendSvg(months, {
    currencySymbol: S.currency === 'USD' ? '$' : '₺',
    rate: S.currency === 'USD' && S.usdTry > 0 ? S.usdTry : 1
  });

  // Aylık Kapanış
  const picker = $('#monthlyClosePicker');
  if (picker && !picker.value) picker.value = S.monthlyCloseYm;
  const mc = computeMonthlyClose(S, S.monthlyCloseYm, S.personFilter);
  $('#monthlyCloseBox').innerHTML =
    `<div class="cat-row"><div class="cat-name">Ay Başı Nakit</div><div class="num" style="font-weight:700;">${fmt(mc.openingCash)}</div></div>` +
    `<div class="cat-row"><div class="cat-name" style="color:var(--income);">+ Ay İçi Gelirler</div><div class="num profit-pos">+${fmt(mc.monthIncome)}</div></div>` +
    `<div class="cat-row"><div class="cat-name" style="color:var(--expense);">− Ay İçi Giderler</div><div class="num profit-neg">−${fmt(mc.monthExpense)}</div></div>` +
    `<div class="cat-row"><div class="cat-name">⇄ Yatırıma Çıkan / Giren</div><div class="num">${fmt(mc.monthTransferIn - mc.monthTransferOut)}</div></div>` +
    `<div class="cat-row" style="border-top:2px solid var(--hairline);padding-top:10px;"><div class="cat-name"><strong>Ay Sonu Nakit Kapanış</strong></div><div class="num" style="font-weight:800;font-size:15px;">${fmt(mc.closingCash)}</div></div>` +
    `<div class="field-hint" style="margin-top:8px;">Bu ay portföye yeni yatırılan ana para: <strong>${fmt(mc.newInvestmentCapital)}</strong></div>`;

  // Kategori Barları
  const byCat = new Map();
  for (const e of exp) {
    const k = e.raw.categoryId || e.label;
    if (!byCat.has(k)) byCat.set(k, { name: e.label, total: 0 });
    byCat.get(k).total = round2(byCat.get(k).total + e.amount);
  }
  const catArr = Array.from(byCat.values()).sort((a, b) => b.total - a.total);
  const maxCat = catArr[0]?.total || 1;
  $('#categoryBars').innerHTML = catArr.length
    ? catArr
        .map(
          c =>
            `<div class="bar-row"><div class="bar-top"><span class="name">${esc(c.name)}</span><span class="amt num">${fmt(c.total)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, Math.round((c.total / maxCat) * 100))}%"></div></div></div>`
        )
        .join('')
    : `<div class="empty" style="border:none;">Bu dönemde gider kaydı yok.</div>`;

  // Bankaya Göre Kıymetli Maden (normalize edilmiş)
  const bankArr = groupHoldingsByBank(S, S.personFilter);
  const maxBank = bankArr[0]?.total || 1;
  $('#bankBars').innerHTML = bankArr.length
    ? bankArr
        .map(b => {
          const isOpen = !!S.expandedBanks[b.key];
          return (
            `<div class="bar-row" data-bank="${esc(b.key)}">` +
            `<div class="bar-top bank-toggle" style="cursor:pointer;"><span class="name">${esc(b.name)} (${b.count})</span><span class="amt num">${fmt(b.total)} ${isOpen ? '▲' : '▼'}</span></div>` +
            `<div class="bar-track"><div class="bar-fill gold" style="width:${Math.max(4, Math.round((b.total / maxBank) * 100))}%"></div></div>` +
            (isOpen
              ? `<div style="margin-top:6px;padding-left:8px;border-left:2px solid var(--gold);">${b.holdings
                  .map(h => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><span>${esc(h.material)} · ${esc(personName(S, h.personId))}</span><span class="num">${fmt(h.value)}</span></div>`)
                  .join('')}</div>`
              : '') +
            `</div>`
          );
        })
        .join('')
    : `<div class="empty" style="border:none;">Kıymetli maden kaydı yok.</div>`;
  $('#bankBars').querySelectorAll('.bank-toggle').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const k = hdr.closest('.bar-row').dataset.bank;
      S.expandedBanks[k] = !S.expandedBanks[k];
      renderAnaliz();
    });
  });

  // Kaynağa Göre Kartlar
  let types = S.incomeTypes.filter(t => !t.archived);
  if (S.personFilter !== 'all') types = types.filter(t => t.personId === S.personFilter);
  const srcEl = $('#sourceCards');
  srcEl.innerHTML = types.length
    ? types
        .map(t => {
          const pInc = S.incomeEntries.filter(e => e.typeId === t.id && inRange(e.date, range)).reduce((a, e) => a + Number(e.amount || 0), 0);
          const pExp = S.expenseEntries.filter(e => e.paidFromTypeId === t.id && inRange(e.date, range)).reduce((a, e) => a + Number(e.amount || 0), 0);
          const allTime = computePotBalance(S, t.id);
          return (
            `<div class="source-card" style="cursor:default;">` +
            `<div style="font-weight:700;font-size:14px;margin-bottom:8px;">${esc(t.name)} · <span class="pot-person">${esc(personName(S, t.personId))}</span></div>` +
            `<div class="holding-bottom" style="grid-template-columns:repeat(3,1fr);margin-top:0;padding-top:8px;">` +
            `<div class="cell"><div class="l">Dönem Geliri</div><div class="v num">${fmt(pInc)}</div></div>` +
            `<div class="cell"><div class="l">Dönem Gideri</div><div class="v num">${fmt(pExp)}</div></div>` +
            `<div class="cell"><div class="l">Güncel Bakiye</div><div class="v num">${fmt(allTime.balance)}</div></div>` +
            `</div></div>`
          );
        })
        .join('')
    : `<div class="empty">Gelir kaynağı yok.</div>`;

  // Kişi Karşılaştırması
  const activePeople = S.people.filter(p => !p.archived);
  $('#personCompareGrid').innerHTML = activePeople
    .map(p => {
      const pov = computeOverview(S, p.id);
      return (
        `<div class="card">` +
        `<div class="card-title">${esc(p.name)}</div>` +
        `<div class="num" style="font-size:21px;font-weight:800;">${fmt(pov.netWorth)}</div>` +
        `<div style="font-size:12px;color:var(--ink-faint);margin-top:3px;">Nakit ${fmt(pov.cash)} · Portföy ${fmt(pov.investValue)}</div>` +
        `<div style="font-size:12px;margin-top:6px;">Açık K/Z: <span class="${pov.investProfit >= 0 ? 'profit-pos' : 'profit-neg'}">${pov.investProfit >= 0 ? '+' : ''}${fmt(pov.investProfit)}</span></div>` +
        `</div>`
      );
    })
    .join('');
}

// ---------- KAYITLAR & EKSTRE MUTABAKATI ----------
function getFilteredRecords() {
  let entries = unifiedEntries(S, S.personFilter, 'spender');
  if (S.recordFilter !== 'all') entries = entries.filter(e => e.kind === S.recordFilter);
  const q = normKey(S.recordSearch);
  if (q) {
    entries = entries.filter(
      e => normKey(e.label).includes(q) || normKey(e.sub).includes(q) || normKey(e.note).includes(q) || normKey(e.personName).includes(q)
    );
  }
  return entries;
}

function renderKayitlar() {
  renderPersonChips('kayitlarPersonChips', () => renderKayitlar());
  $$('#recordChips .chip').forEach(c => c.classList.toggle('active', c.dataset.rf === S.recordFilter));

  const entries = getFilteredRecords();
  const listEl = $('#recordsList');
  if (entries.length === 0) {
    listEl.innerHTML = `<div class="empty"><img src="./assets/empty-vault.png" alt="" class="empty-vault-img">Aramaya uyan işlem bulunamadı.</div>`;
    return;
  }
  let html = '';
  let lastMonth = null;
  for (const e of entries) {
    const ml = monthLabel(e.date);
    if (ml !== lastMonth) {
      html += `<div class="month-header">${esc(ml)}</div>`;
      lastMonth = ml;
    }
    html += txRowHtml(e);
  }
  listEl.innerHTML = `<div class="card" style="padding:8px 14px;"><div class="tx-list">${html}</div></div>`;
  bindTxRows(listEl);
}

// ---------- İŞLEM / VARLIK / SATIŞ / FİYAT SHEET'LERİ ----------
function fundingOptionsHtml(selectedId) {
  const types = S.incomeTypes.filter(t => !t.archived);
  return (
    `<option value=""${!selectedId ? ' selected' : ''}>— Açılış Kaydı / Nakitten Düşme —</option>` +
    types
      .map(t => {
        const b = computePotBalance(S, t.id);
        return `<option value="${t.id}"${t.id === selectedId ? ' selected' : ''}>${esc(t.name)} · ${esc(personName(S, t.personId))} (bakiye ${fmtTry(b.balance)})</option>`;
      })
      .join('')
  );
}

function openIncomeTypeSheet(id) {
  const isNew = !id;
  const defaultPerson = S.personFilter !== 'all' ? S.personFilter : S.addPersonId || S.people[0]?.id || '';
  const t = isNew ? { personId: defaultPerson, name: '', archived: false } : S.incomeTypes.find(x => x.id === id);
  if (!t) return;
  const persons = S.people.filter(p => !p.archived);
  const potB = isNew ? { balance: 0, income: 0, spent: 0 } : computePotBalance(S, t.id);

  openSheet(
    `<div class="sheet-title">${isNew ? 'Yeni Gelir Kaynağı' : 'Gelir Kaynağını Düzenle'}</div>` +
      `<div class="field"><label>Hesap Sahibi</label><select id="it_person">${persons.map(p => `<option value="${p.id}"${p.id === t.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Kaynak Adı</label><input type="text" id="it_name" value="${esc(t.name)}" placeholder="Örn: Maaş"></div>` +
      (!isNew ? `<div class="field-hint" style="margin-top:8px;">Mevcut Bakiye: <strong>${fmt(potB.balance)}</strong></div>` : '') +
      `<div class="sheet-actions">` +
      (isNew ? '' : `<button type="button" class="btn-ghost" id="it_archive">${t.archived ? 'Arşivden Çıkar' : 'Arşivle'}</button>`) +
      (isNew ? '' : `<button type="button" class="btn-danger" id="it_delete">Sil</button>`) +
      `<button type="button" class="btn-primary" id="it_save" style="margin-top:0;">Kaydet</button>` +
      `</div>`
  );

  $('#it_save').addEventListener('click', () => {
    const personId = $('#it_person').value;
    const name = $('#it_name').value.trim();
    if (!name) {
      toast('Kaynak adı gir');
      return;
    }
    runAtomic(
      $('#it_save'),
      draft => {
        if (isNew) {
          draft.income_types.push({ id: newId('it'), personId, name, archived: false, createdAt: new Date().toISOString() });
        } else {
          const item = draft.income_types.find(x => x.id === t.id);
          if (item) Object.assign(item, { personId, name });
        }
      },
      'Gelir kaynağı güncellendi',
      () => {
        closeSheet();
        renderView(S.view);
        toast(isNew ? 'Gelir kaynağı eklendi' : 'Güncellendi');
      }
    );
  });

  if (!isNew) {
    $('#it_archive').addEventListener('click', () => {
      runAtomic(
        $('#it_archive'),
        draft => {
          const item = draft.income_types.find(x => x.id === t.id);
          if (item) item.archived = !item.archived;
        },
        'Gelir kaynağı arşiv durumu',
        () => {
          closeSheet();
          renderView(S.view);
          toast('Güncellendi');
        }
      );
    });
    $('#it_delete').addEventListener('click', () => {
      const check = canDeleteEntity(S, 'income_types', t.id);
      if (!check.allowed) {
        toast(check.reason);
        return;
      }
      runAtomic(
        $('#it_delete'),
        draft => {
          draft.income_types = draft.income_types.filter(x => x.id !== t.id);
        },
        'Gelir kaynağı silindi',
        () => {
          closeSheet();
          renderView(S.view);
          toast('Silindi');
        }
      );
    });
  }
}

function openDebtSheet(id) {
  const isNew = !id;
  const d = isNew ? { personId: S.addPersonId, name: '', amount: '', note: '' } : S.debts.find(x => x.id === id);
  if (!d) return;
  const persons = S.people.filter(p => !p.archived);

  openSheet(
    `<div class="sheet-title">${isNew ? 'Yeni Borç / Kredi Kartı' : 'Borcu Düzenle'}</div>` +
      `<div class="field"><label>Kişi</label><select id="db_person">${persons.map(p => `<option value="${p.id}"${p.id === d.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Ad</label><input type="text" id="db_name" value="${esc(d.name)}" placeholder="Örn: Kredi Kartı Dönem Borcu"></div>` +
      `<div class="field"><label>Güncel Borç Tutarı (₺)</label><input type="text" inputmode="decimal" id="db_amount" class="num-input" value="${d.amount || ''}" placeholder="0,00"></div>` +
      `<div class="field"><label>Not</label><input type="text" id="db_note" value="${esc(d.note || '')}" placeholder="Örn: Son ödeme ayın 15'i"></div>` +
      `<div class="sheet-actions">` +
      (isNew ? '' : `<button type="button" class="btn-danger" id="db_delete">Sil</button>`) +
      `<button type="button" class="btn-primary" id="db_save" style="margin-top:0;">Kaydet</button>` +
      `</div>`
  );

  $('#db_save').addEventListener('click', () => {
    const personId = $('#db_person').value;
    const name = $('#db_name').value.trim();
    const amount = parseMoneyInput($('#db_amount').value);
    const note = $('#db_note').value.trim();
    if (!name) return toast('Borç adı gir');
    if (!Number.isFinite(amount) || amount < 0) return toast('Geçerli bir tutar gir');

    runAtomic(
      $('#db_save'),
      draft => {
        if (isNew) {
          draft.debts.push({ id: newId('db'), personId, name, amount: round2(amount), note, archived: false, createdAt: new Date().toISOString() });
        } else {
          const item = draft.debts.find(x => x.id === d.id);
          if (item) Object.assign(item, { personId, name, amount: round2(amount), note });
        }
      },
      'Borç kaydı güncellendi',
      () => {
        closeSheet();
        renderView(S.view);
        toast('Kaydedildi');
      }
    );
  });

  if (!isNew) {
    $('#db_delete').addEventListener('click', () => {
      runAtomic(
        $('#db_delete'),
        draft => {
          draft.debts = draft.debts.filter(x => x.id !== d.id);
        },
        'Borç silindi',
        () => {
          closeSheet();
          renderView(S.view);
          toast('Silindi');
        }
      );
    });
  }
}

function openEditTxSheet(kind, id) {
  const arr = kind === 'gider' ? S.expenseEntries : S.incomeEntries;
  const entry = arr.find(e => e.id === id);
  if (!entry) return;
  const persons = S.people.filter(p => !p.archived);

  openSheet(
    `<div class="sheet-title">${kind === 'gider' ? 'Gideri Düzenle' : 'Geliri Düzenle'}</div>` +
      `<div class="field"><label>Tutar (₺)</label><input type="text" inputmode="decimal" id="et_amount" class="num-input" value="${entry.amount}"></div>` +
      `<div class="field"><label>${kind === 'gider' ? 'Kimin Harcaması' : 'Kişi'}</label><select id="et_person">${persons.map(p => `<option value="${p.id}"${p.id === entry.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      (kind === 'gider'
        ? `<div class="field"><label>Kategori</label><select id="et_cat">${S.expenseCategories.map(c => `<option value="${c.id}"${c.id === entry.categoryId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` +
          `<div class="field"><label>Ödeme Kaynağı</label><select id="et_paidfrom">${S.incomeTypes.map(t => `<option value="${t.id}"${t.id === entry.paidFromTypeId ? ' selected' : ''}>${esc(t.name)} · ${esc(personName(S, t.personId))}</option>`).join('')}</select></div>`
        : `<div class="field"><label>Gelir Kaynağı</label><select id="et_type">${S.incomeTypes.map(t => `<option value="${t.id}"${t.id === entry.typeId ? ' selected' : ''}>${esc(t.name)} · ${esc(personName(S, t.personId))}</option>`).join('')}</select></div>`) +
      `<div class="field"><label>Tarih</label><input type="date" id="et_date" value="${entry.date}"></div>` +
      `<div class="field"><label>Not</label><input type="text" id="et_note" value="${esc(entry.note || '')}"></div>` +
      `<div class="sheet-actions"><button type="button" class="btn-danger" id="et_delete">Sil</button><button type="button" class="btn-primary" id="et_save" style="margin-top:0;">Kaydet</button></div>`
  );

  $('#et_save').addEventListener('click', () => {
    const amount = parseMoneyInput($('#et_amount').value);
    if (!(amount > 0)) return toast('Geçerli tutar gir');
    const personId = $('#et_person').value;
    const date = $('#et_date').value || entry.date;
    const note = $('#et_note').value.trim();

    runAtomic(
      $('#et_save'),
      draft => {
        const col = kind === 'gider' ? 'expense_entries' : 'income_entries';
        const row = draft[col].find(x => x.id === id);
        if (!row) return;
        row.amount = round2(amount);
        row.personId = personId;
        row.personName = personName(S, personId);
        row.date = date;
        row.note = note;
        if (kind === 'gider') {
          const cat = S.expenseCategories.find(c => c.id === $('#et_cat').value);
          const type = S.incomeTypes.find(t => t.id === $('#et_paidfrom').value);
          if (cat) {
            row.categoryId = cat.id;
            row.categoryName = cat.name;
          }
          if (type) {
            row.paidFromTypeId = type.id;
            row.paidFromTypeName = type.name;
          }
        } else {
          const type = S.incomeTypes.find(t => t.id === $('#et_type').value);
          if (type) {
            row.typeId = type.id;
            row.typeName = type.name;
          }
        }
      },
      'İşlem düzenlendi',
      () => {
        closeSheet();
        renderView(S.view);
        toast('Güncellendi');
      }
    );
  });

  $('#et_delete').addEventListener('click', () => {
    const btn = $('#et_delete');
    if (btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.textContent = 'Emin misin? Tekrar dokun';
      return;
    }
    runAtomic(
      btn,
      draft => {
        const col = kind === 'gider' ? 'expense_entries' : 'income_entries';
        draft[col] = draft[col].filter(x => x.id !== id);
      },
      'İşlem silindi',
      () => {
        closeSheet();
        renderView(S.view);
        toast('Silindi');
      }
    );
  });
}

function openTransferDetailSheet(id) {
  const tr = S.transfers.find(t => t.id === id);
  if (!tr) return;
  openSheet(
    `<div class="sheet-title">Transfer Detayı</div>` +
      `<div class="cat-row"><div class="cat-name">Tür</div><div>${esc(tr.label || tr.direction)}</div></div>` +
      `<div class="cat-row"><div class="cat-name">Tutar</div><div class="num" style="font-weight:700;">${fmt(tr.amount)}</div></div>` +
      `<div class="cat-row"><div class="cat-name">Tarih</div><div>${dayLabel(tr.date)}</div></div>` +
      `<div class="cat-row"><div class="cat-name">Not</div><div>${esc(tr.note || tr.sub || '—')}</div></div>` +
      `<div class="field-hint" style="margin-top:10px;">Yatırım alış/satışına bağlı transferler ilgili varlık/satış silinince otomatik temizlenir.</div>` +
      `<div class="sheet-actions"><button type="button" class="btn-danger" id="tr_del">Transferi Sil</button></div>`,
    { trackDirty: false }
  );
  $('#tr_del').addEventListener('click', () => {
    runAtomic(
      $('#tr_del'),
      draft => {
        draft.transfers = draft.transfers.filter(x => x.id !== id);
      },
      'Transfer silindi',
      () => {
        closeSheet();
        renderView(S.view);
        toast('Transfer silindi');
      }
    );
  });
}

// ---------- KIYMETLİ MADEN SHEET'LERİ ----------
function openHoldingSheet(id) {
  const isNew = !id;
  const h = isNew
    ? {
        personId: S.addPersonId,
        material: '',
        bank: '',
        quantity: '',
        unit: 'gram',
        purchasePrice: '',
        purchaseDate: todayStr(),
        currentPrice: '',
        note: '',
        incomeTypeId: ''
      }
    : S.savingsHoldings.find(x => x.id === id);
  if (!h) return;
  const persons = S.people.filter(p => !p.archived);

  openSheet(
    `<div class="sheet-title">${isNew ? 'Yeni Kıymetli Maden Alışı' : 'Varlığı Düzenle'}</div>` +
      `<div class="field"><label>Kişi</label><select id="h_person">${persons.map(p => `<option value="${p.id}"${p.id === h.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Materyal</label><input type="text" id="h_material" list="matOpts" value="${esc(h.material)}" placeholder="Örn: Gram Altın"><datalist id="matOpts">${MATERIAL_PRESETS.map(m => `<option value="${esc(m)}">`).join('')}</datalist></div>` +
      `<div class="field"><label>Banka / Saklama Yeri</label><input type="text" id="h_bank" value="${esc(h.bank)}" placeholder="Örn: Dünya Katılım"></div>` +
      `<div class="field"><label>Miktar & Birim</label><div style="display:flex;gap:8px;"><input type="text" inputmode="decimal" id="h_qty" class="num-input" value="${h.quantity || ''}" placeholder="0,00"><select id="h_unit" style="width:120px;flex:none;"><option value="gram"${h.unit === 'gram' ? ' selected' : ''}>gram</option><option value="adet"${h.unit === 'adet' ? ' selected' : ''}>adet</option></select></div></div>` +
      `<div class="field"><label>Alış Fiyatı (birim ₺ — hediye/sıfır maliyet için 0 girebilirsin)</label><input type="text" inputmode="decimal" id="h_price" class="num-input" value="${h.purchasePrice !== '' && h.purchasePrice != null ? h.purchasePrice : ''}" placeholder="0,00"></div>` +
      `<div class="field"><label>Ödeme Kaynağı / Nakit Bağlantısı</label><select id="h_incometype">${fundingOptionsHtml(h.incomeTypeId)}</select><div class="field-hint" id="h_fund_hint">${isNew ? 'Bir nakit kaynağı seçersen alış tutarı o nakitten otomatik transfer edilir (çift sayım olmaz). Önceden sahip olduğun varlıklar için "Açılış Kaydı" seç.' : 'Mevcut varlıklarda eski bakiye korunur.'}</div></div>` +
      `<div class="field"><label>Alış Tarihi</label><input type="date" id="h_date" value="${h.purchaseDate || todayStr()}"></div>` +
      `<div class="field"><label>Güncel Fiyat (opsiyonel, ₺)</label><input type="text" inputmode="decimal" id="h_cur" class="num-input" value="${h.currentPrice || ''}"></div>` +
      `<div class="field"><label>Not</label><input type="text" id="h_note" value="${esc(h.note || '')}"></div>` +
      `<div class="sheet-actions">${isNew ? '' : '<button type="button" class="btn-danger" id="h_del">Sil</button>'}<button type="button" class="btn-primary gold" id="h_save" style="margin-top:0;">Kaydet</button></div>`
  );

  $('#h_save').addEventListener('click', () => {
    const personId = $('#h_person').value;
    const material = $('#h_material').value.trim();
    const bank = $('#h_bank').value.trim();
    const quantity = parseMoneyInput($('#h_qty').value);
    const unit = $('#h_unit').value;
    const purchasePrice = parseMoneyInput($('#h_price').value);
    const incomeTypeId = $('#h_incometype').value || null;
    const purchaseDate = $('#h_date').value || todayStr();
    const currentPrice = parseMoneyInput($('#h_cur').value);
    const note = $('#h_note').value.trim();

    if (!material) return toast('Materyal adı gir');
    if (!(quantity > 0)) return toast('Geçerli miktar gir');
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) return toast('Alış fiyatı 0 veya pozitif olmalı');

    const totalCost = round2(quantity * purchasePrice);
    runAtomic(
      $('#h_save'),
      draft => {
        if (Number.isFinite(currentPrice) && currentPrice > 0) {
          const gp = draft.material_prices.find(p => materialPriceKey(p.material, p.bank) === materialPriceKey(material, bank));
          if (!gp) {
            draft.material_prices.push({
              id: newId('mp'),
              material,
              bank,
              price: round2(currentPrice),
              updatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString()
            });
          }
        }

        if (isNew) {
          const hid = newId('h');
          let linkedTransferId = null;
          if (incomeTypeId && totalCost > 0) {
            linkedTransferId = newId('tr');
            draft.transfers.push({
              id: linkedTransferId,
              direction: 'to_investment',
              personId,
              fromTypeId: incomeTypeId,
              toTypeId: null,
              amount: totalCost,
              date: purchaseDate,
              label: `Yatırım Alışı · ${material}`,
              sub: `${fmtNum(quantity)} ${unit} @ ${fmtTry(purchasePrice)}`,
              note,
              linkedId: hid,
              createdAt: new Date().toISOString()
            });
          }
          draft.savings_holdings.push({
            id: hid,
            personId,
            personName: personName(S, personId),
            incomeTypeId,
            linkedTransferId,
            fundingMode: linkedTransferId ? 'transfer' : 'opening',
            material,
            bank,
            quantity: round4(quantity),
            unit,
            purchasePrice,
            purchaseDate,
            currentPrice: Number.isFinite(currentPrice) ? currentPrice : 0,
            note,
            createdAt: new Date().toISOString()
          });
        } else {
          const item = draft.savings_holdings.find(x => x.id === h.id);
          if (item) {
            Object.assign(item, {
              personId,
              personName: personName(S, personId),
              incomeTypeId,
              material,
              bank,
              quantity: round4(quantity),
              unit,
              purchasePrice,
              purchaseDate,
              currentPrice: Number.isFinite(currentPrice) ? currentPrice : 0,
              note
            });
            if (item.linkedTransferId) {
              const tr = draft.transfers.find(t => t.id === item.linkedTransferId);
              if (tr && incomeTypeId && totalCost > 0) {
                tr.amount = totalCost;
                tr.fromTypeId = incomeTypeId;
                tr.date = purchaseDate;
                tr.personId = personId;
              }
            }
          }
        }
      },
      isNew ? 'Kıymetli maden alışı' : 'Kıymetli maden düzenlendi',
      () => {
        closeSheet();
        renderBirikim();
        toast(isNew ? 'Varlık eklendi' : 'Güncellendi');
      }
    );
  });

  if (!isNew) {
    $('#h_del').addEventListener('click', () => {
      const btn = $('#h_del');
      if (btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1';
        btn.textContent = 'Emin misin? Tekrar dokun';
        return;
      }
      runAtomic(
        btn,
        draft => {
          draft.savings_holdings = draft.savings_holdings.filter(x => x.id !== h.id);
          if (h.linkedTransferId) {
            draft.transfers = draft.transfers.filter(t => t.id !== h.linkedTransferId);
          }
        },
        'Kıymetli maden silindi',
        () => {
          closeSheet();
          renderBirikim();
          toast('Silindi');
        }
      );
    });
  }
}

function openMetalSaleSheet() {
  const persons = S.people.filter(p => !p.archived);
  const ml = computeMetalLedger(S);
  const availablePools = new Map();
  for (const h of ml.holdings) {
    if (h.remaining <= 1e-9) continue;
    const k = `${h.personId}||${materialPriceKey(h.material, h.bank)}`;
    if (!availablePools.has(k)) availablePools.set(k, { personId: h.personId, material: h.material, bank: h.bank, unit: h.unit, qty: 0 });
    availablePools.get(k).qty = round4(availablePools.get(k).qty + h.remaining);
  }
  const pools = Array.from(availablePools.values());
  if (pools.length === 0) {
    toast('Satılacak kıymetli maden bakiyesi yok');
    return;
  }

  openSheet(
    `<div class="sheet-title">Kıymetli Maden Satışı (FIFO)</div>` +
      `<div class="field-hint" style="margin-bottom:10px;">Satış en eski alıştan düşülür. Net satış tutarı seçeceğin nakit kaynağına otomatik aktarılır.</div>` +
      `<div class="field"><label>Satılacak Varlık Havuzu</label><select id="ms_pool">${pools.map((p, i) => `<option value="${i}">${esc(p.material)} · ${esc(p.bank || '—')} · ${esc(personName(S, p.personId))} (elde ${fmtNum(p.qty)} ${esc(p.unit)})</option>`).join('')}</select></div>` +
      `<div class="field"><label>Satış Miktarı</label><input type="text" inputmode="decimal" id="ms_qty" class="num-input" placeholder="0,00"></div>` +
      `<div class="field"><label>Birim Satış Fiyatı (₺)</label><input type="text" inputmode="decimal" id="ms_price" class="num-input" placeholder="0,00"></div>` +
      `<div class="field"><label>Satış Gelirinin Geçeceği Nakit Hesabı</label><select id="ms_to">${fundingOptionsHtml('')}</select></div>` +
      `<div class="field"><label>Tarih</label><input type="date" id="ms_date" value="${todayStr()}"></div>` +
      `<div class="field"><label>Not</label><input type="text" id="ms_note"></div>` +
      `<div class="field-hint" id="ms_preview"></div>` +
      `<div class="sheet-actions"><button type="button" class="btn-primary gold" id="ms_save" style="margin-top:0;">Satışı Kaydet</button></div>`
  );

  const updatePreview = () => {
    const p = pools[Number($('#ms_pool').value)];
    const qty = parseMoneyInput($('#ms_qty').value);
    const price = parseMoneyInput($('#ms_price').value);
    const pv = previewMetalSale(S, p.personId, p.material, p.bank, qty, price);
    const el = $('#ms_preview');
    if (!Number.isFinite(qty) || !Number.isFinite(price)) {
      el.textContent = '';
      return;
    }
    if (!pv.ok) {
      el.textContent = pv.reason === 'insufficient_units' ? `Yetersiz miktar — elde ${fmtNum(pv.available)} var.` : '';
      return;
    }
    el.innerHTML = `Maliyet: <strong>${fmtTry(pv.costBasis)}</strong> · Satış Geliri: <strong>${fmtTry(pv.proceeds)}</strong> · Net Kâr: <strong>${fmtTry(pv.netProfit)}</strong>`;
  };
  ['#ms_pool', '#ms_qty', '#ms_price'].forEach(sel => $(sel).addEventListener('input', updatePreview));

  $('#ms_save').addEventListener('click', () => {
    const p = pools[Number($('#ms_pool').value)];
    const qty = parseMoneyInput($('#ms_qty').value);
    const price = parseMoneyInput($('#ms_price').value);
    const toTypeId = $('#ms_to').value || null;
    const saleDate = $('#ms_date').value || todayStr();
    const note = $('#ms_note').value.trim();

    const pv = previewMetalSale(S, p.personId, p.material, p.bank, qty, price);
    if (!pv.ok) return toast(pv.reason === 'insufficient_units' ? `Elde sadece ${fmtNum(pv.available)} var` : 'Geçerli miktar/fiyat gir');

    runAtomic(
      $('#ms_save'),
      draft => {
        const sid = newId('ms');
        let linkedTransferId = null;
        if (toTypeId && pv.proceeds > 0) {
          linkedTransferId = newId('tr');
          draft.transfers.push({
            id: linkedTransferId,
            direction: 'to_cash',
            personId: p.personId,
            fromTypeId: null,
            toTypeId,
            amount: pv.proceeds,
            date: saleDate,
            label: `Maden Satışı · ${p.material}`,
            sub: `${fmtNum(qty)} ${p.unit} @ ${fmtTry(price)}`,
            note,
            linkedId: sid,
            createdAt: new Date().toISOString()
          });
        }
        draft.metal_sales.push({
          id: sid,
          personId: p.personId,
          material: p.material,
          bank: p.bank,
          unit: p.unit,
          quantity: round4(qty),
          salePrice: price,
          saleDate,
          toTypeId,
          linkedTransferId,
          note,
          createdAt: new Date().toISOString()
        });
      },
      'Kıymetli maden satışı',
      () => {
        closeSheet();
        renderBirikim();
        toast('Maden satışı kaydedildi');
      }
    );
  });
}

function openMetalSaleDetailSheet(id) {
  const s = S.metalSales.find(x => x.id === id);
  if (!s) return;
  openSheet(
    `<div class="sheet-title">Maden Satışı</div>` +
      `<div class="cat-row"><div class="cat-name">${esc(s.material)} (${esc(s.bank || '—')})</div><div>${fmtNum(s.quantity)} ${esc(s.unit)}</div></div>` +
      `<div class="cat-row"><div class="cat-name">Birim Satış Fiyatı</div><div class="num">${fmtTry(s.salePrice)}</div></div>` +
      `<div class="cat-row"><div class="cat-name">Tarih</div><div>${dayLabel(s.saleDate)}</div></div>` +
      `<div class="sheet-actions"><button type="button" class="btn-danger" id="ms_del">Satışı Geri Al (Sil)</button></div>`,
    { trackDirty: false }
  );
  $('#ms_del').addEventListener('click', () => {
    runAtomic(
      $('#ms_del'),
      draft => {
        draft.metal_sales = draft.metal_sales.filter(x => x.id !== id);
        if (s.linkedTransferId) draft.transfers = draft.transfers.filter(t => t.id !== s.linkedTransferId);
      },
      'Maden satışı geri alındı',
      () => {
        closeSheet();
        renderBirikim();
        toast('Satış geri alındı');
      }
    );
  });
}

// ---------- FİYAT GÜNCELLEME (MAKAS DEVRE KESİCİ + SARRAFİYE) ----------
function openPricesSheet() {
  const seen = new Map();
  for (const h of S.savingsHoldings) {
    const k = materialPriceKey(h.material, h.bank);
    if (!seen.has(k)) seen.set(k, { material: h.material, bank: h.bank });
  }
  const groups = Array.from(seen.values()).sort((a, b) => (a.material + a.bank).localeCompare(b.material + b.bank, 'tr'));

  if (groups.length === 0) {
    openSheet(`<div class="sheet-title">Fiyatları Güncelle</div><div class="empty">Önce Birikim'e en az bir kıymetli maden ekle.</div>`, { trackDirty: false });
    return;
  }

  openSheet(
    `<div class="sheet-title">Kıymetli Maden Fiyatları</div>` +
      `<div class="field-hint" style="margin-bottom:10px;">Canlı çekimde alış/satış makası <strong>%5 üzerindeyse</strong> (mesai dışı banka makası) hatalı zarar görünmemesi için otomatik koruma devreye girer.</div>` +
      `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">` +
      `<button type="button" class="btn-ghost" id="fetchPricesBtn" style="flex:1;">↻ Banka Kurlarını Çek</button>` +
      `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-soft);"><input type="checkbox" id="includeCoinsChk"> Sarrafiye tahmini</label>` +
      `</div>` +
      `<div id="fetchPricesStatus" class="field-hint" style="margin-bottom:12px;"></div>` +
      groups
        .map((g, i) => {
          const cur = getGroupPrice(S, g.material, g.bank);
          return (
            `<div class="cat-row" data-idx="${i}">` +
            `<div class="cat-name">${esc(g.material)}<div class="pot-sub">${esc(g.bank || 'Banka yok')}</div></div>` +
            `<input type="text" inputmode="decimal" class="num-input price-input" data-material="${esc(g.material)}" data-bank="${esc(g.bank || '')}" value="${cur != null ? cur : ''}" style="width:125px;min-height:42px;border-radius:10px;border:1px solid var(--hairline);background:var(--surface);color:var(--ink);padding:6px 10px;font-size:15px;">` +
            `</div>`
          );
        })
        .join('') +
      `<div class="sheet-actions"><button type="button" class="btn-primary gold" id="savePricesBtn" style="margin-top:0;">Tümünü Tek Seferde Kaydet</button></div>`
  );

  $('#fetchPricesBtn').addEventListener('click', async () => {
    const statusEl = $('#fetchPricesStatus');
    const btn = $('#fetchPricesBtn');
    btn.disabled = true;
    btn.textContent = 'Çekiliyor…';
    try {
      const res = await fetch(`../prices.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Bulunamadı');
      const data = await res.json();
      const includeCoins = $('#includeCoinsChk').checked;
      const { matches, skippedWarnings, analysis } = matchFetchedPrices(groups, data, { includeCoins });

      let filled = 0;
      $$('#sheetContent .price-input').forEach(inp => {
        const m = matches.find(x => materialPriceKey(x.material, x.bank) === materialPriceKey(inp.dataset.material, inp.dataset.bank));
        if (m) {
          inp.value = m.price;
          inp.style.borderColor = 'var(--gold)';
          filled++;
        }
      });

      const warnText = skippedWarnings.length
        ? `<div class="badge warn" style="margin-top:6px;display:block;white-space:normal;">Makas Koruması: ${skippedWarnings.map(w => `${esc(w.sourceLabel)} (%${w.spreadPct} makas)`).join(', ')} mesai dışı geniş makas nedeniyle atlandı.</div>`
        : '';
      const infoLine = analysis?.updatedAt ? `Kaynak zamanı: ${formatDateTime(analysis.updatedAt)}` : '';
      statusEl.innerHTML = `${filled} fiyat dolduruldu. ${infoLine}${warnText}`;
    } catch {
      statusEl.textContent = '../prices.json okunamadı (yerel veya ağ hatası).';
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Banka Kurlarını Çek';
    }
  });

  $('#savePricesBtn').addEventListener('click', () => {
    const inputs = $$('#sheetContent .price-input');
    const updates = [];
    for (const inp of inputs) {
      const price = parseMoneyInput(inp.value);
      if (Number.isFinite(price) && price > 0) {
        updates.push({ material: inp.dataset.material, bank: inp.dataset.bank, price: round2(price) });
      }
    }
    if (updates.length === 0) return toast('Geçerli fiyat gir');

    runAtomic(
      $('#savePricesBtn'),
      draft => {
        const nowIso = new Date().toISOString();
        for (const u of updates) {
          const key = materialPriceKey(u.material, u.bank);
          const existing = draft.material_prices.find(p => materialPriceKey(p.material, p.bank) === key);
          if (existing) {
            if (Number(existing.price) > 0 && Number(existing.price) !== u.price) {
              existing.previousPrice = Number(existing.price);
              existing.previousPriceAt = nowIso;
            }
            existing.price = u.price;
            existing.updatedAt = nowIso;
          } else {
            draft.material_prices.push({ id: newId('mp'), material: u.material, bank: u.bank, price: u.price, updatedAt: nowIso, createdAt: nowIso });
          }
        }
      },
      'Maden fiyatları güncellendi',
      () => {
        closeSheet();
        renderBirikim();
        toast(`${updates.length} fiyat tek seferde kaydedildi`);
      }
    );
  });
}

// ---------- YATIRIM FONU SHEET'LERİ ----------
function openFundLotSheet(id) {
  const isNew = !id;
  const ledger = computeFundLedger(S);
  const raw = isNew
    ? { personId: S.addPersonId, fundName: FUND_PRESETS[0] || '', quantity: '', purchasePrice: '', purchaseDate: todayStr(), note: '', incomeTypeId: '' }
    : S.fundLots.find(x => x.id === id);
  if (!raw) return;
  const computed = isNew ? null : ledger.lotById.get(id);
  const soldQty = computed ? computed.soldQuantity : 0;
  const identityLocked = !isNew && soldQty > 1e-9;
  const persons = S.people.filter(p => !p.archived);
  const curStopaj = raw.stopajRate != null ? Number(raw.stopajRate) : getFundStopajRate(S, raw.fundName);

  openSheet(
    `<div class="sheet-title">${isNew ? 'Yeni Fon Alışı' : 'Fon Alışını Düzenle'}</div>` +
      (identityLocked ? `<div class="field-hint" style="margin-bottom:8px;">Bu lottan ${fmtNum(soldQty, 4)} adet satılmış. Fiyat/stopaj değiştirirsen olay-tabanlı FIFO tüm satış kârlarını otomatik yeniden hesaplar!</div>` : '') +
      `<div class="field"><label>Kişi</label><select id="fl_person"${identityLocked ? ' disabled' : ''}>${persons.map(p => `<option value="${p.id}"${p.id === raw.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Fon Kodu / Adı</label><input type="text" id="fl_name" value="${esc(raw.fundName)}" placeholder="Örn: EP1"${identityLocked ? ' disabled' : ''}></div>` +
      `<div class="field"><label>Adet</label><input type="text" inputmode="decimal" id="fl_qty" class="num-input" value="${raw.quantity || ''}"></div>` +
      `<div class="field"><label>Alış Fiyatı (₺ — sıfır maliyet için 0)</label><input type="text" inputmode="decimal" id="fl_price" class="num-input" value="${raw.purchasePrice !== '' && raw.purchasePrice != null ? raw.purchasePrice : ''}"></div>` +
      `<div class="field"><label>Stopaj Oranı</label><select id="fl_stopaj">${STOPAJ_OPTIONS.map(o => `<option value="${o.val}"${Math.abs(o.val - curStopaj) < 0.001 ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Ödeme Kaynağı / Nakit Bağlantısı</label><select id="fl_incometype">${fundingOptionsHtml(raw.incomeTypeId)}</select></div>` +
      `<div class="field"><label>Alış Tarihi</label><input type="date" id="fl_date" value="${raw.purchaseDate || todayStr()}"></div>` +
      `<div class="field"><label>Not</label><input type="text" id="fl_note" value="${esc(raw.note || '')}"></div>` +
      `<div class="sheet-actions">${isNew || identityLocked ? '' : '<button type="button" class="btn-danger" id="fl_del">Sil</button>'}<button type="button" class="btn-primary gold" id="fl_save" style="margin-top:0;">Kaydet</button></div>`
  );

  $('#fl_save').addEventListener('click', () => {
    const personId = $('#fl_person').value;
    const fundName = $('#fl_name').value.trim();
    const quantity = parseMoneyInput($('#fl_qty').value);
    const purchasePrice = parseMoneyInput($('#fl_price').value);
    const stopajRate = Number($('#fl_stopaj').value);
    const incomeTypeId = $('#fl_incometype').value || null;
    const purchaseDate = $('#fl_date').value || todayStr();
    const note = $('#fl_note').value.trim();

    if (!fundName) return toast('Fon adı gir');
    if (!(quantity > 0) || quantity < soldQty - 1e-9) return toast(`Adet en az ${fmtNum(soldQty, 4)} olmalı`);
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) return toast('Alış fiyatı 0 veya pozitif olmalı');

    const totalCost = round2(quantity * purchasePrice);
    runAtomic(
      $('#fl_save'),
      draft => {
        // Fon varsayılan stopaj config'ini de güncelle
        const cfg = draft.fund_configs.find(c => fundKey(c.fundName) === fundKey(fundName));
        if (cfg) cfg.stopajRate = stopajRate;
        else draft.fund_configs.push({ id: newId('fc'), fundName, stopajRate });

        if (isNew) {
          const lid = newId('fl');
          let linkedTransferId = null;
          if (incomeTypeId && totalCost > 0) {
            linkedTransferId = newId('tr');
            draft.transfers.push({
              id: linkedTransferId,
              direction: 'to_investment',
              personId,
              fromTypeId: incomeTypeId,
              toTypeId: null,
              amount: totalCost,
              date: purchaseDate,
              label: `Fon Alışı · ${fundName}`,
              sub: `${fmtNum(quantity, 4)} adet @ ${fmtTry(purchasePrice)}`,
              note,
              linkedId: lid,
              createdAt: new Date().toISOString()
            });
          }
          draft.fund_lots.push({
            id: lid,
            personId,
            incomeTypeId,
            linkedTransferId,
            fundingMode: linkedTransferId ? 'transfer' : 'opening',
            fundName,
            quantity: round4(quantity),
            remainingQuantity: round4(quantity),
            purchasePrice,
            stopajRate,
            purchaseDate,
            note,
            createdAt: new Date().toISOString()
          });
        } else {
          const item = draft.fund_lots.find(x => x.id === raw.id);
          if (item) {
            Object.assign(item, {
              incomeTypeId,
              quantity: round4(quantity),
              remainingQuantity: round4(quantity - soldQty),
              purchasePrice,
              stopajRate,
              purchaseDate,
              note
            });
            if (!identityLocked) {
              item.personId = personId;
              item.fundName = fundName;
            }
          }
        }
      },
      isNew ? 'Fon alışı eklendi' : 'Fon lotu güncellendi',
      () => {
        closeSheet();
        renderBirikim();
        toast('Kaydedildi');
      }
    );
  });

  if (!isNew && !identityLocked) {
    $('#fl_del')?.addEventListener('click', () => {
      const btn = $('#fl_del');
      if (btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1';
        btn.textContent = 'Emin misin? Tekrar dokun';
        return;
      }
      runAtomic(
        btn,
        draft => {
          draft.fund_lots = draft.fund_lots.filter(x => x.id !== raw.id);
          if (raw.linkedTransferId) draft.transfers = draft.transfers.filter(t => t.id !== raw.linkedTransferId);
        },
        'Fon lotu silindi',
        () => {
          closeSheet();
          renderBirikim();
          toast('Silindi');
        }
      );
    });
  }
}

function openFundSaleSheet() {
  const persons = S.people.filter(p => !p.archived);
  const ledger = computeFundLedger(S);
  const fundNames = Array.from(new Set(ledger.lots.filter(l => l.remaining > 1e-9).map(l => l.fundName)));
  if (fundNames.length === 0) return toast('Satılacak fon lotu yok');

  openSheet(
    `<div class="sheet-title">Fon Satışı (Atomik FIFO)</div>` +
      `<div class="field-hint" style="margin-bottom:10px;">Satış en eski lottan FIFO ile düşülür, stopaj hesaplanır ve nakde geçen tutar tek atomik işlemde kaydedilir.</div>` +
      `<div class="field"><label>Kişi</label><select id="fs_person">${persons.map(p => `<option value="${p.id}"${p.id === S.addPersonId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Fon</label><input type="text" id="fs_name" list="fSellOpts" value="${esc(fundNames[0])}"><datalist id="fSellOpts">${fundNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>` +
      `<div class="field"><label>Satış Adedi</label><input type="text" inputmode="decimal" id="fs_qty" class="num-input" placeholder="0,0000"></div>` +
      `<div class="field"><label>Satış Fiyatı (₺)</label><input type="text" inputmode="decimal" id="fs_price" class="num-input" placeholder="0,0000"></div>` +
      `<div class="field"><label>Ekstredeki Gerçek Stopaj (opsiyonel — boşsa otomatik hesaplanır)</label><input type="text" inputmode="decimal" id="fs_actual_stopaj" class="num-input" placeholder="Otomatik"></div>` +
      `<div class="field"><label>Paranın Aktarılacağı Nakit Hesabı</label><select id="fs_to">${fundingOptionsHtml('')}</select></div>` +
      `<div class="field"><label>Tarih</label><input type="date" id="fs_date" value="${todayStr()}"></div>` +
      `<div class="field"><label>Not</label><input type="text" id="fs_note"></div>` +
      `<div id="fs_preview" class="card" style="margin-top:12px;padding:12px;background:var(--surface-2);display:none;"></div>` +
      `<div class="sheet-actions"><button type="button" class="btn-primary gold" id="fs_save" style="margin-top:0;">Satışı Kaydet</button></div>`
  );

  const updatePreview = () => {
    const personId = $('#fs_person').value;
    const fundName = $('#fs_name').value.trim();
    const qty = parseMoneyInput($('#fs_qty').value);
    const price = parseMoneyInput($('#fs_price').value);
    const actualStopaj = parseMoneyInput($('#fs_actual_stopaj').value);
    const box = $('#fs_preview');
    const pv = previewFundSale(S, personId, fundName, qty, price);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) {
      box.style.display = 'none';
      return;
    }
    box.style.display = '';
    if (!pv.ok) {
      box.innerHTML = `<span style="color:var(--expense);font-weight:700;">Yetersiz adet: Elde ${fmtNum(pv.available, 4)} adet var.</span>`;
      return;
    }
    const stopaj = Number.isFinite(actualStopaj) && actualStopaj >= 0 ? round2(actualStopaj) : pv.stopaj;
    const netProfit = round2(pv.grossProfit - stopaj);
    const netProceeds = round2(pv.proceeds - stopaj);
    box.innerHTML =
      `<div style="font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:6px;">` +
      `<div>Satılan: <strong>${fmtNum(qty, 4)}</strong></div><div>Kalan: <strong>${fmtNum(pv.remainingAfter, 4)}</strong></div>` +
      `<div>Maliyet: <strong>${fmtTry(pv.costBasis)}</strong></div><div>Brüt Kâr: <strong>${fmtTry(pv.grossProfit)}</strong></div>` +
      `<div>Stopaj: <strong>${fmtTry(stopaj)}</strong></div><div>Nakde Geçen: <strong style="color:var(--income);">${fmtTry(netProceeds)}</strong></div>` +
      `</div>`;
  };
  ['#fs_person', '#fs_name', '#fs_qty', '#fs_price', '#fs_actual_stopaj'].forEach(sel => $(sel).addEventListener('input', updatePreview));

  $('#fs_save').addEventListener('click', () => {
    const personId = $('#fs_person').value;
    const fundName = $('#fs_name').value.trim();
    const qty = parseMoneyInput($('#fs_qty').value);
    const price = parseMoneyInput($('#fs_price').value);
    const actualStopajRaw = $('#fs_actual_stopaj').value.trim();
    const actualStopaj = actualStopajRaw ? parseMoneyInput(actualStopajRaw) : null;
    const toTypeId = $('#fs_to').value || null;
    const saleDate = $('#fs_date').value || todayStr();
    const note = $('#fs_note').value.trim();

    const pv = previewFundSale(S, personId, fundName, qty, price);
    if (!pv.ok) return toast(pv.reason === 'insufficient_units' ? `Elde ${fmtNum(pv.available, 4)} adet var` : 'Geçerli adet/fiyat gir');

    const finalStopaj = actualStopaj != null && Number.isFinite(actualStopaj) && actualStopaj >= 0 ? round2(actualStopaj) : pv.stopaj;
    const netProceeds = round2(pv.proceeds - finalStopaj);
    const netProfit = round2(pv.grossProfit - finalStopaj);

    runAtomic(
      $('#fs_save'),
      draft => {
        const sid = newId('fs');
        let linkedTransferId = null;
        if (toTypeId && netProceeds > 0) {
          linkedTransferId = newId('tr');
          draft.transfers.push({
            id: linkedTransferId,
            direction: 'to_cash',
            personId,
            fromTypeId: null,
            toTypeId,
            amount: netProceeds,
            date: saleDate,
            label: `Fon Satışı · ${fundName}`,
            sub: `${fmtNum(qty, 4)} adet @ ${fmtTry(price)} (stopaj sonrası)`,
            note,
            linkedId: sid,
            createdAt: new Date().toISOString()
          });
        }
        draft.fund_sales.push({
          id: sid,
          personId,
          fundName,
          quantity: round4(qty),
          salePrice: price,
          saleDate,
          toTypeId,
          linkedTransferId,
          note,
          costBasis: pv.costBasis,
          proceeds: pv.proceeds,
          grossProfit: pv.grossProfit,
          stopaj: finalStopaj,
          actualStopaj: actualStopaj != null && Number.isFinite(actualStopaj) ? round2(actualStopaj) : null,
          netProfit,
          lotBreakdown: pv.lotBreakdown,
          createdAt: new Date().toISOString()
        });
      },
      'Fon satışı (atomik)',
      () => {
        closeSheet();
        renderBirikim();
        toast('Fon satışı kaydedildi');
      }
    );
  });
}

function openFundSaleDetailSheet(id) {
  const ledger = computeFundLedger(S);
  const s = ledger.sales.find(x => x.id === id);
  if (!s) return;

  openSheet(
    `<div class="sheet-title">Fon Satış Detayı · ${esc(s.fundName)}</div>` +
      `<div class="cat-row"><div class="cat-name">Adet × Fiyat</div><div class="num">${fmtNum(s.quantity, 4)} × ${fmtTry(s.salePrice)}</div></div>` +
      `<div class="cat-row"><div class="cat-name">Maliyet (FIFO)</div><div class="num">${fmtTry(s.costBasis)}</div></div>` +
      `<div class="cat-row"><div class="cat-name">Tahmini Stopaj</div><div class="num">${fmtTry(s.estimatedStopaj)}</div></div>` +
      `<div class="field"><label>Ekstredeki Gerçek Stopaj (₺ — düzeltmek için değiştir)</label><input type="text" inputmode="decimal" id="fsd_stopaj" class="num-input" value="${s.hasActualStopaj ? s.stopaj : ''}" placeholder="Tahmini: ${s.estimatedStopaj}"></div>` +
      `<div class="sheet-actions"><button type="button" class="btn-danger" id="fsd_del">Satışı Geri Al</button><button type="button" class="btn-primary gold" id="fsd_save" style="margin-top:0;">Stopajı Güncelle</button></div>`
  );

  $('#fsd_save').addEventListener('click', () => {
    const rawVal = $('#fsd_stopaj').value.trim();
    const parsed = rawVal ? parseMoneyInput(rawVal) : null;
    if (rawVal && (!Number.isFinite(parsed) || parsed < 0)) return toast('Geçerli stopaj tutarı gir');

    runAtomic(
      $('#fsd_save'),
      draft => {
        const item = draft.fund_sales.find(x => x.id === id);
        if (!item) return;
        item.actualStopaj = parsed != null ? round2(parsed) : null;
        if (item.linkedTransferId) {
          const tr = draft.transfers.find(t => t.id === item.linkedTransferId);
          const effectiveStopaj = item.actualStopaj != null ? item.actualStopaj : s.estimatedStopaj;
          if (tr) tr.amount = round2(s.proceeds - effectiveStopaj);
        }
      },
      'Ekstre stopajı güncellendi',
      () => {
        closeSheet();
        renderBirikim();
        toast('Güncellendi');
      }
    );
  });

  $('#fsd_del').addEventListener('click', () => {
    const btn = $('#fsd_del');
    if (btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.textContent = 'Emin misin? Tekrar dokun';
      return;
    }
    runAtomic(
      btn,
      draft => {
        draft.fund_sales = draft.fund_sales.filter(x => x.id !== id);
        if (s.linkedTransferId) draft.transfers = draft.transfers.filter(t => t.id !== s.linkedTransferId);
      },
      'Fon satışı geri alındı',
      () => {
        closeSheet();
        renderBirikim();
        toast('Satış geri alındı');
      }
    );
  });
}

function openFundPricesSheet() {
  const names = Array.from(new Set(S.fundLots.map(l => l.fundName).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr'));
  if (names.length === 0) return toast('Önce bir fon alışı ekle');

  openSheet(
    `<div class="sheet-title">Fon Fiyatları & Stopaj</div>` +
      `<div class="field-hint" style="margin-bottom:12px;">Tüm fon fiyatlarını tek seferde girip kaydedebilirsin.</div>` +
      names
        .map(name => {
          const cur = getFundPrice(S, name);
          const rate = getFundStopajRate(S, name);
          return (
            `<div class="cat-row">` +
            `<div class="cat-name">${esc(name)}<div class="pot-sub">Varsayılan Stopaj: %${fmtNum(rate * 100, 1)}</div></div>` +
            `<input type="text" inputmode="decimal" class="num-input fp-inp" data-fund="${esc(name)}" value="${cur != null ? cur : ''}" placeholder="₺" style="width:125px;min-height:42px;border-radius:10px;border:1px solid var(--hairline);background:var(--surface);color:var(--ink);padding:6px 10px;font-size:15px;">` +
            `</div>`
          );
        })
        .join('') +
      `<div class="sheet-actions"><button type="button" class="btn-primary gold" id="fp_save" style="margin-top:0;">Tümünü Kaydet</button></div>`
  );

  $('#fp_save').addEventListener('click', () => {
    const updates = [];
    $$('#sheetContent .fp-inp').forEach(inp => {
      const val = parseMoneyInput(inp.value);
      if (Number.isFinite(val) && val > 0) updates.push({ fundName: inp.dataset.fund, price: round4(val) });
    });
    if (updates.length === 0) return toast('Geçerli fiyat gir');

    runAtomic(
      $('#fp_save'),
      draft => {
        const nowIso = new Date().toISOString();
        for (const u of updates) {
          const existing = draft.fund_prices.find(p => fundKey(p.fundName) === fundKey(u.fundName));
          if (existing) {
            if (Number(existing.price) > 0 && Number(existing.price) !== u.price) {
              existing.previousPrice = Number(existing.price);
              existing.previousPriceAt = nowIso;
            }
            existing.price = u.price;
            existing.updatedAt = nowIso;
          } else {
            draft.fund_prices.push({ id: newId('fp'), fundName: u.fundName, price: u.price, updatedAt: nowIso, createdAt: nowIso });
          }
        }
      },
      'Fon fiyatları güncellendi',
      () => {
        closeSheet();
        renderBirikim();
        toast(`${updates.length} fon fiyatı güncellendi`);
      }
    );
  });
}

// ---------- CSV EKSTRE MUTABAKATI ----------
function openCsvReconcileSheet() {
  const activeTypes = S.incomeTypes.filter(t => !t.archived);
  const defaultCat = S.expenseCategories.find(c => !c.archived);
  if (activeTypes.length === 0 || !defaultCat) return toast('Önce gelir kaynağı ve gider kategorisi tanımla');

  openSheet(
    `<div class="sheet-title">Banka CSV Ekstre Mutabakatı</div>` +
      `<div class="field-hint" style="margin-bottom:10px;">Bankadan indirdiğin CSV dosyasını seç; tarih (±2 gün) ve tutara göre mevcut kayıtlarla otomatik eşleştirip eksik hareketleri tek tıkla içeri aktar.</div>` +
      `<div class="field"><label>Hangi Hesap Ekstresi?</label><select id="csv_pot">${activeTypes.map(t => `<option value="${t.id}">${esc(t.name)} · ${esc(personName(S, t.personId))}</option>`).join('')}</select></div>` +
      `<div class="field"><label>CSV Dosyası Seç</label><input type="file" id="csv_file" accept=".csv,text/csv"></div>` +
      `<div id="csv_preview" style="margin-top:12px;"></div>` +
      `<div class="sheet-actions" id="csv_actions" style="display:none;"><button type="button" class="btn-primary" id="csv_import_btn" style="margin-top:0;">Seçilen Eksik Satırları Aktar</button></div>`
  );

  let parsedRows = [];
  $('#csv_file').addEventListener('change', async ev => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const existing = unifiedEntries(S, 'all', 'account');
    parsedRows = parseBankCsvAndMatch(text, existing);
    const box = $('#csv_preview');
    if (parsedRows.length === 0) {
      box.innerHTML = `<div class="empty">Okunabilir tarih/tutar satırı bulunamadı.</div>`;
      $('#csv_actions').style.display = 'none';
      return;
    }
    const matchedCount = parsedRows.filter(r => r.matchedEntry).length;
    box.innerHTML =
      `<div class="field-hint" style="margin-bottom:8px;">Toplam <strong>${parsedRows.length}</strong> hareket · <strong>${matchedCount}</strong> eşleşti · <strong>${parsedRows.length - matchedCount}</strong> yeni/eksik.</div>` +
      parsedRows
        .map(
          (r, i) =>
            `<label class="cat-row" style="cursor:pointer;">` +
            `<input type="checkbox" class="csv-chk" data-idx="${i}" ${r.matchedEntry ? '' : 'checked'}>` +
            `<div class="cat-name">${esc(r.description)}<div class="pot-sub">${dayLabel(r.date)} · ${r.matchedEntry ? '<span style="color:var(--income);">Eşleşti ✓</span>' : '<span style="color:var(--warn);">Kayıtlarda yok</span>'}</div></div>` +
            `<div class="num" style="font-weight:700;color:${r.kind === 'gelir' ? 'var(--income)' : 'var(--expense)'};">${r.kind === 'gelir' ? '+' : '−'}${fmtTry(r.amount)}</div>` +
            `</label>`
        )
        .join('');
    $('#csv_actions').style.display = 'flex';
  });

  $('#csv_import_btn').addEventListener('click', () => {
    const pot = S.incomeTypes.find(t => t.id === $('#csv_pot').value);
    if (!pot) return;
    const selected = $$('#csv_preview .csv-chk:checked').map(chk => parsedRows[Number(chk.dataset.idx)]);
    if (selected.length === 0) return toast('Aktarılacak satır seç');

    runAtomic(
      $('#csv_import_btn'),
      draft => {
        const nowIso = new Date().toISOString();
        for (const r of selected) {
          if (r.kind === 'gelir') {
            draft.income_entries.push({
              id: newId('inc'),
              typeId: pot.id,
              typeName: pot.name,
              personId: pot.personId,
              personName: personName(S, pot.personId),
              amount: r.amount,
              date: r.date,
              note: `[Ekstre] ${r.description}`,
              createdAt: nowIso
            });
          } else {
            draft.expense_entries.push({
              id: newId('exp'),
              categoryId: defaultCat.id,
              categoryName: defaultCat.name,
              paidFromTypeId: pot.id,
              paidFromTypeName: pot.name,
              personId: pot.personId,
              personName: personName(S, pot.personId),
              amount: r.amount,
              date: r.date,
              note: `[Ekstre] ${r.description}`,
              createdAt: nowIso
            });
          }
        }
      },
      `CSV ekstre aktarımı (${selected.length} kayıt)`,
      () => {
        closeSheet();
        renderView(S.view);
        toast(`${selected.length} hareket aktarıldı`);
      }
    );
  });
}

// ---------- AYARLAR SHEET'İ ----------
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function openSettingsSheet() {
  const ghCfg = getGithubConfig();
  const hasPin = Boolean(localStorage.getItem(PIN_HASH_KEY));

  const entityRow = (col, item, extra = '') =>
    `<div class="cat-row">` +
    `<div class="cat-name${item.archived ? ' archived' : ''}">${esc(item.name)}${extra ? ` <span class="pot-sub">${esc(extra)}</span>` : ''}</div>` +
    `<button type="button" class="icon-btn compact" data-act="arch" data-col="${col}" data-id="${item.id}" title="Arşivle">⇄</button>` +
    `<button type="button" class="icon-btn compact danger" data-act="del" data-col="${col}" data-id="${item.id}" title="Sil">✕</button>` +
    `</div>`;

  openSheet(
    `<div class="sheet-title">Ayarlar & Güvenlik</div>` +
      `<div class="section-title">Kişiler</div>` +
      `<div class="card" style="padding:8px 12px;">` +
      S.people.map(p => entityRow('people', p)).join('') +
      `<div class="add-row"><input type="text" id="st_new_person" placeholder="Yeni kişi adı"><button type="button" id="st_add_person">Ekle</button></div></div>` +
      `<div class="section-title">Gider Kategorileri</div>` +
      `<div class="card" style="padding:8px 12px;">` +
      S.expenseCategories.map(c => entityRow('expense_categories', c)).join('') +
      `<div class="add-row"><input type="text" id="st_new_cat" placeholder="Yeni kategori adı"><button type="button" id="st_add_cat">Ekle</button></div></div>` +
      `<div class="section-title">USD/TRY Kuru & Güvenlik</div>` +
      `<div class="card">` +
      `<div class="field" style="margin-top:0;"><label>USD Görünüm Kuru (₺)</label><div style="display:flex;gap:8px;"><input type="text" inputmode="decimal" id="st_usd" value="${S.usdTry}" class="num-input" style="min-height:42px;"><button type="button" class="btn-ghost" id="st_save_usd" style="min-height:42px;">Kaydet</button></div></div>` +
      `<div class="field"><label>Uygulama PIN Kilidi (4 Haneli)</label><div style="display:flex;gap:8px;"><input type="password" inputmode="numeric" maxlength="4" id="st_pin" placeholder="${hasPin ? 'Yeni PIN veya kaldır' : '4 haneli PIN'}"><button type="button" class="btn-ghost" id="st_save_pin">${hasPin ? 'Güncelle' : 'Kilitle'}</button>${hasPin ? '<button type="button" class="btn-danger" id="st_clear_pin">Kaldır</button>' : ''}</div></div>` +
      `</div>` +
      `<div class="section-title">Yedekleme (JSON)</div>` +
      `<div class="card" style="display:flex;gap:8px;flex-wrap:wrap;">` +
      `<button type="button" class="btn-ghost" id="st_export_json" style="flex:1;">Tam Yedek İndir (.json)</button>` +
      `<label class="btn-ghost" style="flex:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;">Yedekten Geri Yükle<input type="file" id="st_import_json" accept=".json,application/json" style="display:none;"></label>` +
      `</div>` +
      `<div class="section-title">GitHub Senkronizasyonu</div>` +
      `<div class="card">` +
      (ghCfg
        ? `<div class="field-hint" style="margin-bottom:10px;">Bağlı: <strong>${esc(ghCfg.owner)}/${esc(ghCfg.repo)}</strong> (Fine-Grained PAT önerilir).</div><button type="button" class="btn-danger" id="gh_disconnect" style="width:100%;">Bu Cihazdan Bağlantıyı Kaldır</button>`
        : `<div class="field-hint" style="margin-bottom:10px;">Yalnızca ilgili <strong>private</strong> repo için Contents: Read & Write yetkili Fine-Grained PAT kullan.</div>` +
          `<div class="field" style="margin-top:0;"><input type="text" id="gh_repo" placeholder="kullanici-adi/repo-adi"></div>` +
          `<div class="field"><input type="password" id="gh_token" placeholder="Fine-Grained Personal Access Token"></div>` +
          `<button type="button" class="btn-primary" id="gh_connect">GitHub'a Bağlan</button>`) +
      `</div>`,
    { trackDirty: false }
  );

  // Arşivle & Referans Bütünlüğü Korumalı Silme
  $$('#sheetContent [data-act="arch"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { col, id } = btn.dataset;
      runAtomic(
        btn,
        draft => {
          const item = draft[col].find(x => x.id === id);
          if (item) item.archived = !item.archived;
        },
        'Arşiv durumu değiştirildi',
        () => {
          openSettingsSheet();
          renderView(S.view);
        }
      );
    });
  });

  $$('#sheetContent [data-act="del"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { col, id } = btn.dataset;
      const check = canDeleteEntity(S, col, id);
      if (!check.allowed) return toast(check.reason);
      runAtomic(
        btn,
        draft => {
          draft[col] = draft[col].filter(x => x.id !== id);
        },
        'Kayıt silindi',
        () => {
          openSettingsSheet();
          renderView(S.view);
          toast('Silindi');
        }
      );
    });
  });

  $('#st_add_person').addEventListener('click', () => {
    const name = $('#st_new_person').value.trim();
    if (!name) return;
    runAtomic(
      $('#st_add_person'),
      draft => {
        draft.people.push({ id: newId('p'), name, archived: false, createdAt: new Date().toISOString() });
      },
      'Kişi eklendi',
      () => {
        openSettingsSheet();
        renderView(S.view);
      }
    );
  });

  $('#st_add_cat').addEventListener('click', () => {
    const name = $('#st_new_cat').value.trim();
    if (!name) return;
    runAtomic(
      $('#st_add_cat'),
      draft => {
        draft.expense_categories.push({ id: newId('ec'), name, archived: false, createdAt: new Date().toISOString() });
      },
      'Kategori eklendi',
      () => {
        openSettingsSheet();
        renderView(S.view);
      }
    );
  });

  $('#st_save_usd').addEventListener('click', () => {
    const val = parseMoneyInput($('#st_usd').value);
    if (!(val > 0)) return toast('Geçerli kur gir');
    S.usdTry = val;
    try {
      localStorage.setItem(USD_RATE_KEY, String(val));
    } catch {}
    renderView(S.view);
    toast('USD kuru kaydedildi');
  });

  $('#st_save_pin').addEventListener('click', async () => {
    const pin = $('#st_pin').value.trim();
    if (!/^\d{4}$/.test(pin)) return toast('4 haneli rakam gir');
    const hash = await sha256Hex(pin);
    localStorage.setItem(PIN_HASH_KEY, hash);
    toast('PIN kilidi aktif edildi');
    openSettingsSheet();
  });

  $('#st_clear_pin')?.addEventListener('click', () => {
    localStorage.removeItem(PIN_HASH_KEY);
    toast('PIN kilidi kaldırıldı');
    openSettingsSheet();
  });

  $('#st_export_json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S.store.exportSnapshot(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kelo-finans-yedek-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Tam yedek indirildi');
  });

  $('#st_import_json').addEventListener('change', async ev => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      await S.store.replaceAll(json);
      loadStateFromStore();
      closeSheet();
      renderView(S.view);
      toast('Yedek başarıyla geri yüklendi');
    } catch {
      toast('Geçersiz yedek JSON dosyası');
    }
  });

  $('#gh_disconnect')?.addEventListener('click', () => {
    clearGithubConfig();
    closeSheet();
    toast('GitHub bağlantısı kaldırıldı');
    setTimeout(() => location.reload(), 500);
  });

  $('#gh_connect')?.addEventListener('click', async () => {
    const raw = $('#gh_repo').value.trim();
    const token = $('#gh_token').value.trim();
    const parts = raw.split('/').map(s => s.trim()).filter(Boolean);
    if (parts.length !== 2) return toast('Repo "kullanici/repo" biçiminde olmalı');
    if (!token) return toast('Token gir');
    const cfg = { owner: parts[0], repo: parts[1], token, path: 'data.json' };
    const api = new GithubApi(cfg);
    const res = await api.testConnection();
    if (!res.ok) return toast(res.error);
    setGithubConfig(cfg);
    closeSheet();
    toast('GitHub bağlandı, yenileniyor…');
    setTimeout(() => location.reload(), 500);
  });
}

// ---------- STATİK EVENT BAĞLANTILARI ----------
function bindStatic() {
  $$('.tab').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
  $('#sheetOverlay').addEventListener('click', e => {
    if (e.target.id === 'sheetOverlay') requestCloseSheet();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#sheetOverlay')?.classList.contains('open')) {
      requestCloseSheet();
    }
  });

  $('#syncBtnTop').addEventListener('click', triggerManualSync);
  $('#syncBtnSide').addEventListener('click', triggerManualSync);
  $('#privacyBtnTop').addEventListener('click', togglePrivacy);
  $('#privacyBtnSide').addEventListener('click', togglePrivacy);
  $('#themeBtnTop').addEventListener('click', cycleTheme);
  $('#themeBtnSide').addEventListener('click', cycleTheme);
  $('#settingsBtnTop').addEventListener('click', openSettingsSheet);
  $('#settingsBtnSide').addEventListener('click', openSettingsSheet);
  $('#currencyToggleBtn').addEventListener('click', toggleCurrency);

  $('#kpiCashBtn').addEventListener('click', () => openDrilldownSheet('cash'));
  $('#kpiPortfolioBtn').addEventListener('click', () => openDrilldownSheet('portfolio'));
  $('#kpiMonthBtn').addEventListener('click', () => openDrilldownSheet('month'));
  $('#goAllRecordsBtn').addEventListener('click', () => setView('kayitlar'));

  $('#addIncomeTypeQuickBtn').addEventListener('click', () => openIncomeTypeSheet(null));
  $('#addDebtQuickBtn').addEventListener('click', () => openDebtSheet(null));

  // Ekle formu
  $$('#addModeTabs button').forEach(b =>
    b.addEventListener('click', () => {
      S.addMode = b.dataset.mode;
      applyAddMode();
    })
  );
  $('#f_person').addEventListener('change', e => {
    S.addPersonId = e.target.value;
    renderEkle();
  });
  $$('#quickAmounts .quick-amt-btn').forEach(b =>
    b.addEventListener('click', () => {
      const cur = parseMoneyInput($('#f_amount').value);
      const next = (Number.isFinite(cur) ? cur : 0) + Number(b.dataset.add);
      $('#f_amount').value = String(next).replace('.', ',');
    })
  );
  $('#qa_cat_btn').addEventListener('click', () => {
    const name = $('#qa_cat_input').value.trim();
    if (!name) return;
    runAtomic(
      $('#qa_cat_btn'),
      draft => {
        draft.expense_categories.push({ id: newId('ec'), name, archived: false, createdAt: new Date().toISOString() });
      },
      'Kategori eklendi',
      () => {
        $('#qa_cat_input').value = '';
        renderEkle();
        toast('Kategori eklendi');
      }
    );
  });
  $('#qa_inc_btn').addEventListener('click', () => {
    const name = $('#qa_inc_input').value.trim();
    if (!name) return;
    runAtomic(
      $('#qa_inc_btn'),
      draft => {
        draft.income_types.push({ id: newId('it'), name, personId: S.addPersonId, archived: false, createdAt: new Date().toISOString() });
      },
      'Gelir kaynağı eklendi',
      () => {
        $('#qa_inc_input').value = '';
        renderEkle();
        toast('Gelir kaynağı eklendi');
      }
    );
  });

  $('#entryForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const amount = parseMoneyInput($('#f_amount').value);
    if (!(amount > 0)) return toast('Geçerli bir tutar gir');
    const date = $('#f_date').value || todayStr();
    const note = $('#f_note').value.trim();
    const personId = $('#f_person').value || S.addPersonId;

    if (S.addMode === 'gider') {
      const cat = S.expenseCategories.find(c => c.id === $('#f_category').value);
      const paidFrom = S.incomeTypes.find(t => t.id === $('#f_paidfrom').value);
      if (!cat || !paidFrom) return toast('Kategori ve kaynak seç');
      try {
        localStorage.setItem(LAST_SOURCE_KEY, paidFrom.id);
      } catch {}
      runAtomic(
        $('#submitBtn'),
        draft => {
          draft.expense_entries.push({
            id: newId('exp'),
            categoryId: cat.id,
            categoryName: cat.name,
            paidFromTypeId: paidFrom.id,
            paidFromTypeName: paidFrom.name,
            personId,
            personName: personName(S, personId),
            amount: round2(amount),
            date,
            note,
            createdAt: new Date().toISOString()
          });
        },
        'Gider kaydedildi',
        () => {
          $('#f_amount').value = '';
          $('#f_note').value = '';
          renderEkle();
          toast('Gider kaydedildi ✓');
        }
      );
    } else if (S.addMode === 'gelir') {
      const type = S.incomeTypes.find(t => t.id === $('#f_incometype').value);
      if (!type) return toast('Gelir kaynağı seç');
      runAtomic(
        $('#submitBtn'),
        draft => {
          draft.income_entries.push({
            id: newId('inc'),
            typeId: type.id,
            typeName: type.name,
            personId: type.personId,
            personName: personName(S, type.personId),
            amount: round2(amount),
            date,
            note,
            createdAt: new Date().toISOString()
          });
        },
        'Gelir kaydedildi',
        () => {
          $('#f_amount').value = '';
          $('#f_note').value = '';
          renderEkle();
          toast('Gelir kaydedildi ✓');
        }
      );
    } else {
      const fromT = S.incomeTypes.find(t => t.id === $('#f_tr_from').value);
      const toT = S.incomeTypes.find(t => t.id === $('#f_tr_to').value);
      if (!fromT || !toT || fromT.id === toT.id) return toast('Farklı iki hesap seç');
      runAtomic(
        $('#submitBtn'),
        draft => {
          draft.transfers.push({
            id: newId('tr'),
            direction: 'pot_to_pot',
            personId,
            fromTypeId: fromT.id,
            toTypeId: toT.id,
            amount: round2(amount),
            date,
            label: `Transfer: ${fromT.name} → ${toT.name}`,
            sub: `${personName(S, fromT.personId)} → ${personName(S, toT.personId)}`,
            note,
            createdAt: new Date().toISOString()
          });
        },
        'Hesaplar arası transfer',
        () => {
          $('#f_amount').value = '';
          $('#f_note').value = '';
          renderEkle();
          toast('Transfer kaydedildi ✓');
        }
      );
    }
  });

  // Birikim
  $$('#birikimSubTabs button').forEach(b =>
    b.addEventListener('click', () => {
      S.birikimSubView = b.dataset.sub;
      renderBirikim();
    })
  );
  $$('#fundTxTabs button').forEach(b =>
    b.addEventListener('click', () => {
      S.fundTxView = b.dataset.sub;
      renderBirikim();
    })
  );
  $('#addHoldingBtn').addEventListener('click', () => openHoldingSheet(null));
  $('#addMetalSaleBtn').addEventListener('click', openMetalSaleSheet);
  $('#updatePricesBtn').addEventListener('click', openPricesSheet);
  $('#addFundLotBtn').addEventListener('click', () => openFundLotSheet(null));
  $('#addFundSaleBtn').addEventListener('click', openFundSaleSheet);
  $('#updateFundPriceBtn').addEventListener('click', openFundPricesSheet);

  // Analiz
  $$('#periodChips .chip').forEach(c =>
    c.addEventListener('click', () => {
      S.reportPeriod = c.dataset.period;
      renderAnaliz();
    })
  );
  $$('#scopeChips .chip').forEach(c =>
    c.addEventListener('click', () => {
      S.reportScope = c.dataset.scope;
      renderAnaliz();
    })
  );
  $('#monthlyClosePicker').addEventListener('change', e => {
    if (e.target.value) {
      S.monthlyCloseYm = e.target.value;
      renderAnaliz();
    }
  });

  // Kayıtlar
  $('#recordSearchInput').addEventListener('input', e => {
    S.recordSearch = e.target.value;
    renderKayitlar();
  });
  $$('#recordChips .chip').forEach(c =>
    c.addEventListener('click', () => {
      S.recordFilter = c.dataset.rf;
      renderKayitlar();
    })
  );
  $('#importCsvBtn').addEventListener('click', openCsvReconcileSheet);
  $('#exportCsvBtn').addEventListener('click', () => {
    const csv = buildTransactionsCsv(getFilteredRecords());
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kelo-finans-hareketler-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV dışa aktarıldı');
  });
}

// ---------- BAŞLATMA ----------
async function checkPinLock() {
  const savedHash = localStorage.getItem(PIN_HASH_KEY);
  if (!savedHash) return;
  const screen = $('#pinLockScreen');
  screen.classList.add('open');

  return new Promise(resolve => {
    const attempt = async () => {
      const val = $('#pinUnlockInput').value.trim();
      const h = await sha256Hex(val);
      if (h === savedHash) {
        screen.classList.remove('open');
        resolve();
      } else {
        $('#pinUnlockErr').textContent = 'Hatalı PIN kodu';
      }
    };
    $('#pinUnlockBtn').addEventListener('click', attempt);
    $('#pinUnlockInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') attempt();
    });
  });
}

async function boot() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
  S.privacy = localStorage.getItem(PRIVACY_KEY) === '1';
  const savedUsd = parseFloat(localStorage.getItem(USD_RATE_KEY));
  if (savedUsd > 0) S.usdTry = savedUsd;
  ['#privacyBtnTop', '#privacyBtnSide'].forEach(sel => $(sel)?.classList.toggle('active', S.privacy));

  await checkPinLock();

  const ghCfg = getGithubConfig();
  const gh = ghCfg ? new GithubApi(ghCfg) : null;
  S.store = new StoreLayer(gh);
  S.store.onStatusChange(updateSyncIndicators);

  if (gh) {
    try {
      await S.store.initFromGithub();
    } catch (e) {
      console.error('GitHub ilk yükleme başarısız', e);
      S.store.syncStatus = 'error';
      updateSyncIndicators({ status: 'error', lastSyncedAt: S.store.lastSyncedAt, pendingCount: S.store.pendingCount });
    }
  } else {
    updateSyncIndicators({ status: 'local', lastSyncedAt: null, pendingCount: 0 });
  }

  loadStateFromStore();
  await seedIfNeeded();

  bindStatic();
  $('#f_date').value = todayStr();
  setView('ozet');

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
