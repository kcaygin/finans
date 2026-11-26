// Kelo-Finans — Atelier Wealth (Gemini Edition)
// Ergonomik, sade, hızlı işlem odaklı ve tam mutabakatlı uygulama denetleyicisi.

import {
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

import { monthlyTrendSvg } from './charts.js';

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
  view: 'kasa',
  personFilter: 'all',
  addPersonId: null,
  portfoyTab: 'all',
  reportPeriod: 'thisMonth',
  reportScope: 'spender',
  recordFilter: 'all',
  recordSearch: '',
  monthlyCloseYm: todayStr().slice(0, 7),
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

function fmtShort(n) {
  if (S.privacy) return '••••';
  let val = Number(n) || 0;
  let sym = '₺';
  if (S.currency === 'USD' && S.usdTry > 0) {
    val = val / S.usdTry;
    sym = '$';
  }
  const sign = val < 0 ? '−' : '';
  return `${sign}${sym}${Math.abs(val).toLocaleString('tr-TR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`;
}

function fmtRich(n, opts = {}) {
  if (S.privacy && !opts.raw) return '••••';
  const full = fmt(n, opts);
  const idx = full.lastIndexOf(',');
  if (idx === -1) return esc(full);
  return `${esc(full.slice(0, idx))}<span class="krs">${esc(full.slice(idx))}</span>`;
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

// ---------- Kategori & Varlık İkonları ----------
function categoryIconSvg(name, kind) {
  const n = normKey(name);
  if (kind === 'metal' || /altın|altin|gümüş|gumus/.test(n)) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17l2-10h10l2 10H5Z"/><path d="M8 7l1-3h6l1 3"/></svg>';
  }
  if (kind === 'fund') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>';
  }
  if (kind === 'transfer') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/></svg>';
  }
  if (kind === 'gelir') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v14m0 0-5-5m5 5 5-5"/><path d="M5 20h14"/></svg>';
  }
  if (/market|gıda|gida|yiyecek/.test(n)) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/><path d="M3 4h2l2.4 11h10.8l2-7H6.5"/></svg>';
  }
  if (/elektrik|su|fatura|doğalgaz|internet/.test(n)) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8Z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10h18"/></svg>';
}

// ---------- Senkron Durumu ----------
function updateSyncIndicators(info) {
  const dots = ['#syncDotTop', '#syncDotSide'];
  const banner = $('#syncBanner');
  let cls = 'sync-badge';
  let text = 'Bu cihazda kayıtlı';

  if (info.status === 'synced') {
    cls = 'sync-badge synced';
    text = info.lastSyncedAt ? `Eşitlendi · ${formatDateTime(info.lastSyncedAt)}` : 'Eşitlendi';
  } else if (info.status === 'pending') {
    cls = 'sync-badge pending';
    text = `${info.pendingCount} bekleyen işlem`;
  } else if (info.status === 'error') {
    cls = 'sync-badge error';
    text = 'Çevrimdışı önbellek';
  }

  dots.forEach(sel => {
    const el = $(sel);
    if (el) el.className = cls;
  });
  const sideLbl = $('#syncLabelSide');
  if (sideLbl) sideLbl.textContent = text;

  if (banner) {
    if (info.status === 'pending') {
      banner.className = 'banner warn show';
      banner.innerHTML = `<span><strong>${info.pendingCount} işlem</strong> cihazda saklanıyor (henüz eşitlenmedi).</span><button type="button" class="chip" id="bannerSyncBtn" style="min-height:30px;padding:4px 10px;">Eşitle</button>`;
      $('#bannerSyncBtn')?.addEventListener('click', triggerManualSync);
    } else if (info.status === 'error') {
      banner.className = 'banner err show';
      banner.innerHTML = `<span>GitHub bağlantısı kurulamadı — önbellekten çalışılıyor.</span><button type="button" class="chip" id="bannerSyncBtn" style="min-height:30px;padding:4px 10px;">Dene</button>`;
      $('#bannerSyncBtn')?.addEventListener('click', triggerManualSync);
    } else {
      banner.className = 'banner';
      banner.innerHTML = '';
    }
  }
}

async function triggerManualSync() {
  if (!S.store) return;
  if (!S.store.gh) return toast('GitHub bağlı değil — Ayarlar\'dan bağlanabilirsin');
  toast('Eşitleniyor…');
  const res = await S.store.syncNow();
  if (res.ok) {
    loadStateFromStore();
    renderAllChrome();
    renderView(S.view);
    toast('GitHub ile eşitlendi ✓');
  } else {
    toast(res.error || 'Eşitlenemedi');
  }
}

// ---------- Tema, Gizlilik & Para Birimi ----------
const THEME_ICONS = {
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17Z" fill="currentColor" stroke="none"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5Z"/></svg>'
};

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'dark') root.setAttribute('data-theme', 'dark');
  else if (mode === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  const btn = $('#themeBtnSide');
  if (btn) btn.innerHTML = THEME_ICONS[mode] || THEME_ICONS.auto;
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
  ['#privacyBtnTop', '#privacyBtnSide'].forEach(sel => $(sel)?.classList.toggle('active', S.privacy));
  renderView(S.view);
  toast(S.privacy ? 'Gizlilik modu açık' : 'Tutarlar görünür');
}

function toggleCurrency() {
  S.currency = S.currency === 'TRY' ? 'USD' : 'TRY';
  $('#currencyToggleBtn').textContent = S.currency === 'USD' ? '$ USD' : '₺ TRY';
  renderView(S.view);
}

// ---------- State Yükleme ----------
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
  if (S.people.length > 0 && S.incomeTypes.length > 0 && S.expenseCategories.length > 0) return;
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
      for (const d of [
        { name: 'Maaş', personId: me.id },
        { name: 'Maaş', personId: baba.id },
        { name: 'Buğday Parası', personId: baba.id }
      ]) {
        draft.income_types.push({ id: newId('it'), ...d, archived: false, createdAt: new Date().toISOString() });
      }
    }
    if (draft.expense_categories.length === 0) {
      for (const name of ['Market', 'Fatura', 'Harçlık', 'Ulaşım']) {
        draft.expense_categories.push({ id: newId('ec'), name, archived: false, createdAt: new Date().toISOString() });
      }
    }
  }, 'KFT Atelier başlangıç verileri');
  loadStateFromStore();
}

// ---------- Sheet & Atomik İşlem Yardımcıları ----------
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

  const handle = $('#sheetHandle');
  if (handle) {
    let startY = 0;
    let deltaY = 0;
    handle.addEventListener('touchstart', e => {
      startY = e.touches[0].clientY;
      deltaY = 0;
      content.style.transition = 'none';
    }, { passive: true });
    handle.addEventListener('touchmove', e => {
      deltaY = Math.max(0, e.touches[0].clientY - startY);
      content.style.transform = `translateY(${deltaY}px)`;
    }, { passive: true });
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
        '<span>Kaydedilmemiş taslak var. Çıkılsın mı?</span>' +
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
    toast(e?.message || 'Kaydedilemedi — bağlantıyı kontrol et');
  } finally {
    S.inFlight = false;
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

// ---------- Üst Kişi Değiştirici ----------
function renderAllChrome() {
  const label = S.personFilter === 'all' ? 'Tüm Aile' : personName(S, S.personFilter);
  if ($('#personLabelTop')) $('#personLabelTop').textContent = label;
  if ($('#personLabelSide')) $('#personLabelSide').textContent = label;
}

function openPersonSwitcherSheet() {
  const active = S.people.filter(p => !p.archived);
  openSheet(
    `<div class="sheet-title">Görünüm Kapsamı</div>` +
      `<div class="field-hint" style="margin-bottom:12px;">Seçtiğin kişi tüm ekranlarda (Kasa, Portföy, Akış, İçgörü) uygulanır.</div>` +
      `<div style="display:flex;flex-direction:column;gap:8px;">` +
      `<button type="button" class="select-pill${S.personFilter === 'all' ? ' active' : ''}" data-ps="all" style="justify-content:space-between;width:100%;min-height:46px;"><span>Tüm Aile</span><span>${S.personFilter === 'all' ? '✓' : ''}</span></button>` +
      active
        .map(
          p =>
            `<button type="button" class="select-pill${S.personFilter === p.id ? ' active' : ''}" data-ps="${p.id}" style="justify-content:space-between;width:100%;min-height:46px;"><span>${esc(p.name)}</span><span>${S.personFilter === p.id ? '✓' : ''}</span></button>`
        )
        .join('') +
      `</div>` +
      `<div class="sheet-actions"><button type="button" class="btn-ghost" id="ps_manage">Kişileri Yönet</button></div>`,
    { trackDirty: false }
  );

  $$('#sheetContent [data-ps]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.personFilter = btn.dataset.ps;
      if (S.personFilter !== 'all') S.addPersonId = S.personFilter;
      closeSheet();
      renderAllChrome();
      renderView(S.view);
    });
  });
  $('#ps_manage').addEventListener('click', openSettingsSheet);
}

// ---------- Navigasyon ----------
function setView(v) {
  S.view = v;
  $$('.view').forEach(el => el.classList.remove('active'));
  $(`#view-${v}`)?.classList.add('active');
  $$('.dock-tab').forEach(el => el.classList.toggle('active', el.dataset.view === v));
  renderView(v);
}

function renderView(v) {
  if (v === 'kasa') renderKasa();
  else if (v === 'portfoy') renderPortfoy();
  else if (v === 'akis') renderAkis();
  else if (v === 'icgoru') renderIcgoru();
}

// ---------- 1. KASA (ANA EKRAN) ----------
function renderKasa() {
  const ov = computeOverview(S, S.personFilter);
  const range = periodRange('thisMonth');
  const monthEntries = unifiedEntries(S, S.personFilter, 'spender').filter(e => inRange(e.date, range));
  const incM = monthEntries.filter(e => e.kind === 'gelir').reduce((a, e) => a + e.amount, 0);
  const expM = monthEntries.filter(e => e.kind === 'gider').reduce((a, e) => a + e.amount, 0);
  const netM = round2(incM - expM);

  $('#heroTitleLabel').textContent = ov.totalDebts > 0 ? 'Net Servet' : 'Toplam Servet';
  $('#heroNetWorth').innerHTML = fmtRich(ov.netWorth);
  const kzSign = ov.investProfit >= 0 ? '+' : '';
  $('#heroSubLine').textContent =
    ov.totalDebts > 0
      ? `Brüt Varlık ${fmtShort(ov.grossTotal)} · Borç ${fmtShort(ov.totalDebts)} · Açık K/Z ${kzSign}${fmtShort(ov.investProfit)}`
      : `Ana Para ${fmtShort(ov.totalPrincipal)} · Açık K/Z ${kzSign}${fmtShort(ov.investProfit)}`;

  $('#kpiCashVal').textContent = fmtShort(ov.cash);
  $('#kpiPortfolioVal').textContent = fmtShort(ov.investValue);
  $('#kpiMonthVal').textContent = `${netM >= 0 ? '+' : ''}${fmtShort(netM)}`;

  // İnce Jewel Dağılım Şeridi
  const posTotal = Math.max(0, ov.cash) + Math.max(0, ov.fundValue) + Math.max(0, ov.metalValue);
  const pct = v => (posTotal > 0 ? (Math.max(0, v) / posTotal) * 100 : 0);
  $('#allocCard').innerHTML =
    `<div class="alloc-bar">` +
    `<div class="alloc-seg cash" style="width:${pct(ov.cash)}%"></div>` +
    `<div class="alloc-seg fund" style="width:${pct(ov.fundValue)}%"></div>` +
    `<div class="alloc-seg metal" style="width:${pct(ov.metalValue)}%"></div>` +
    `</div>` +
    `<div class="alloc-items">` +
    `<div class="alloc-item"><div class="l"><span class="dot cash"></span>Nakit</div><div class="v num">${fmtShort(ov.cash)}</div></div>` +
    `<div class="alloc-item"><div class="l"><span class="dot fund"></span>Fonlar</div><div class="v num">${fmtShort(ov.fundValue)}</div></div>` +
    `<div class="alloc-item"><div class="l"><span class="dot metal"></span>Maden</div><div class="v num">${fmtShort(ov.metalValue)}</div></div>` +
    `</div>`;

  // Yatay Kaydırılabilir Hesap Kartları (Kumbaralar)
  let types = S.incomeTypes.filter(t => !t.archived);
  if (S.personFilter !== 'all') types = types.filter(t => t.personId === S.personFilter);
  const rail = $('#accountRail');
  if (types.length === 0) {
    rail.innerHTML = `<div class="empty" style="width:100%;">Henüz hesap yok. "+ Ekle" ile ilk gelir kaynağını oluştur.</div>`;
  } else {
    rail.innerHTML = types
      .map(t => {
        const b = computePotBalance(S, t.id);
        const inv = incomeTypeInvestmentStats(S, t.id, ov.fundLedger, ov.metalLedger);
        return (
          `<div class="account-tile" data-acct="${t.id}">` +
          `<div class="a-top"><div><div class="a-name">${esc(t.name)}</div><div class="a-owner">${esc(personName(S, t.personId))}</div></div>` +
          `<span style="font-size:12px;opacity:0.45;">›</span></div>` +
          `<div><div class="a-bal num ${b.balance < 0 ? 'neg' : ''}">${fmtRich(b.balance)}</div>` +
          `<div class="a-sub">${inv.hasInvestment ? `Yatırım: ${fmtShort(inv.value)}` : `Gelen ${fmtShort(b.income)}`}</div></div>` +
          `</div>`
        );
      })
      .join('');
    rail.querySelectorAll('.account-tile').forEach(tile => {
      tile.addEventListener('click', () => openIncomeTypeSheet(tile.dataset.acct));
    });
  }

  // Borçlar (Kompakt)
  let debts = S.debts.filter(d => !d.archived);
  if (S.personFilter !== 'all') debts = debts.filter(d => d.personId === S.personFilter);
  const debtStrip = $('#debtStrip');
  if (debts.length === 0) {
    debtStrip.innerHTML = `<div style="font-size:12px;color:var(--ink-faint);padding:2px 4px;">Kayıtlı borç veya kart bakiyesi yok.</div>`;
  } else {
    debtStrip.innerHTML = `<div class="surface-card" style="padding:4px 14px;">${debts
      .map(
        d =>
          `<div class="cat-row" data-debt="${d.id}" style="cursor:pointer;">` +
          `<div class="cat-name">${esc(d.name)} <span class="pot-sub">· ${esc(personName(S, d.personId))}</span></div>` +
          `<div class="num profit-neg">−${fmt(d.amount)}</div></div>`
      )
      .join('')}</div>`;
    debtStrip.querySelectorAll('[data-debt]').forEach(r => r.addEventListener('click', () => openDebtSheet(r.dataset.debt)));
  }

  // Son Hareketler
  const recent = unifiedEntries(S, S.personFilter, 'spender').slice(0, 6);
  const listEl = $('#recentList');
  if (recent.length === 0) {
    listEl.innerHTML = `<div class="empty" style="border:none;"><img src="./assets/empty-vault.png" alt="" class="empty-vault-img">Henüz işlem yok. Aşağıdaki <strong>+</strong> ile ilk kaydını gir.</div>`;
  } else {
    listEl.innerHTML = recent.map(e => txRowHtml(e)).join('');
    bindTxRows(listEl);
  }
}

function txRowHtml(e) {
  const sign = e.kind === 'gider' ? '−' : e.kind === 'gelir' ? '+' : '⇄';
  return (
    `<div class="tx-row" data-kind="${e.kind}" data-id="${e.id}">` +
    `<div class="tx-ico ${e.kind}">${categoryIconSvg(e.label, e.kind)}</div>` +
    `<div class="tx-main"><div class="tx-label">${esc(e.label)}</div>` +
    `<div class="tx-sub">${esc((e.sub ? e.sub + ' · ' : '') + e.personName + ' · ' + dayLabel(e.date))}</div></div>` +
    `<div class="tx-amt num ${e.kind}">${sign}${fmt(e.amount)}</div>` +
    `</div>`
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

// ---------- KEYPAD-FIRST HIZLI İŞLEM ÇEKMECESİ ----------
function openQuickEntrySheet(defaultMode = 'gider') {
  const persons = S.people.filter(p => !p.archived);
  const cats = S.expenseCategories.filter(c => !c.archived);
  const allTypes = S.incomeTypes.filter(t => !t.archived);
  const lastSrc = localStorage.getItem(LAST_SOURCE_KEY);

  let mode = defaultMode;
  let selectedPersonId = S.personFilter !== 'all' ? S.personFilter : S.addPersonId || persons[0]?.id || '';
  let selectedCatId = cats[0]?.id || '';
  let selectedPaidId = allTypes.some(t => t.id === lastSrc) ? lastSrc : allTypes[0]?.id || '';
  let selectedIncTypeId = (allTypes.find(t => t.personId === selectedPersonId) || allTypes[0])?.id || '';
  let selectedFromId = allTypes[0]?.id || '';
  let selectedToId = (allTypes[1] || allTypes[0])?.id || '';

  openSheet(
    `<div class="sheet-title">Yeni İşlem</div>` +
      `<div class="segmented" id="qe_tabs">` +
      `<button type="button" data-m="gider">Gider</button>` +
      `<button type="button" data-m="gelir">Gelir</button>` +
      `<button type="button" data-m="transfer">Transfer</button>` +
      `</div>` +
      `<div class="entry-amount-stage">` +
      `<input type="text" inputmode="decimal" id="qe_amount" class="entry-amount-input" placeholder="₺0,00">` +
      `<div class="quick-amounts">` +
      `<button type="button" class="quick-amt-btn" data-add="100">+100</button>` +
      `<button type="button" class="quick-amt-btn" data-add="250">+250</button>` +
      `<button type="button" class="quick-amt-btn" data-add="500">+500</button>` +
      `<button type="button" class="quick-amt-btn" data-add="1000">+1.000</button>` +
      `</div></div>` +
      `<div id="qe_cat_block" class="field"><label>Kategori</label><div class="pill-grid" id="qe_cat_pills"></div></div>` +
      `<div id="qe_acct_block" class="field"><label id="qe_acct_lbl">Hesap / Kaynak</label><div class="pill-grid" id="qe_acct_pills"></div></div>` +
      `<div id="qe_tr_to_block" class="field" style="display:none;"><label>Hedef Hesap</label><div class="pill-grid" id="qe_tr_to_pills"></div></div>` +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">` +
      `<div class="field"><label>Kişi</label><select id="qe_person">${persons.map(p => `<option value="${p.id}"${p.id === selectedPersonId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Tarih</label><input type="date" id="qe_date" value="${todayStr()}"></div>` +
      `</div>` +
      `<div class="field"><label>Not (opsiyonel)</label><input type="text" id="qe_note" placeholder="Örn: Market, kahve, fatura…"></div>` +
      `<button type="button" class="btn-primary expense" id="qe_submit">Gideri Kaydet</button>`
  );

  const renderPills = () => {
    $$('#qe_tabs button').forEach(b => b.classList.toggle('active', b.dataset.m === mode));
    const isExp = mode === 'gider';
    const isInc = mode === 'gelir';
    const isTrf = mode === 'transfer';

    $('#qe_cat_block').style.display = isExp ? '' : 'none';
    $('#qe_tr_to_block').style.display = isTrf ? '' : 'none';
    $('#qe_acct_lbl').textContent = isExp ? 'Ödeme Hesabı' : isInc ? 'Gelir Kaynağı' : 'Çıkış Hesabı';

    const curCats = S.expenseCategories.filter(c => !c.archived);
    $('#qe_cat_pills').innerHTML =
      curCats
        .map(c => `<button type="button" class="select-pill${c.id === selectedCatId ? ' active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`)
        .join('') + `<button type="button" class="select-pill" id="qe_add_cat">+ Yeni</button>`;

    $$('#qe_cat_pills [data-cat]').forEach(b =>
      b.addEventListener('click', () => {
        selectedCatId = b.dataset.cat;
        renderPills();
      })
    );
    $('#qe_add_cat').addEventListener('click', () => {
      const name = prompt('Yeni gider kategorisi adı:');
      if (!name || !name.trim()) return;
      runAtomic(
        null,
        draft => {
          const nid = newId('ec');
          draft.expense_categories.push({ id: nid, name: name.trim(), archived: false, createdAt: new Date().toISOString() });
          selectedCatId = nid;
        },
        'Kategori eklendi',
        () => renderPills()
      );
    });

    const curTypes = S.incomeTypes.filter(t => !t.archived);
    const activeAcct = isExp ? selectedPaidId : isInc ? selectedIncTypeId : selectedFromId;
    $('#qe_acct_pills').innerHTML = curTypes
      .map(t => {
        const bal = computePotBalance(S, t.id).balance;
        return `<button type="button" class="select-pill${t.id === activeAcct ? ' active' : ''}" data-acct="${t.id}">${esc(t.name)} · ${esc(personName(S, t.personId))} <span class="num" style="opacity:0.7;">(${fmtShort(bal)})</span></button>`;
      })
      .join('');

    $$('#qe_acct_pills [data-acct]').forEach(b =>
      b.addEventListener('click', () => {
        if (isExp) selectedPaidId = b.dataset.acct;
        else if (isInc) selectedIncTypeId = b.dataset.acct;
        else selectedFromId = b.dataset.acct;
        renderPills();
      })
    );

    if (isTrf) {
      $('#qe_tr_to_pills').innerHTML = curTypes
        .map(t => `<button type="button" class="select-pill${t.id === selectedToId ? ' active' : ''}" data-to="${t.id}">${esc(t.name)} · ${esc(personName(S, t.personId))}</button>`)
        .join('');
      $$('#qe_tr_to_pills [data-to]').forEach(b =>
        b.addEventListener('click', () => {
          selectedToId = b.dataset.to;
          renderPills();
        })
      );
    }

    const btn = $('#qe_submit');
    btn.className = `btn-primary ${isExp ? 'expense' : isInc ? 'income' : 'gold'}`;
    btn.textContent = isExp ? 'Gideri Kaydet' : isInc ? 'Geliri Kaydet' : 'Transferi Kaydet';
  };

  $$('#qe_tabs button').forEach(b =>
    b.addEventListener('click', () => {
      mode = b.dataset.m;
      renderPills();
    })
  );
  $$('#sheetContent .quick-amt-btn').forEach(b =>
    b.addEventListener('click', () => {
      const cur = parseMoneyInput($('#qe_amount').value);
      const next = (Number.isFinite(cur) ? cur : 0) + Number(b.dataset.add);
      $('#qe_amount').value = String(next).replace('.', ',');
      S.sheetDirty = true;
    })
  );
  $('#qe_person').addEventListener('change', e => {
    selectedPersonId = e.target.value;
  });

  renderPills();
  setTimeout(() => $('#qe_amount')?.focus(), 60);

  $('#qe_submit').addEventListener('click', () => {
    const amount = parseMoneyInput($('#qe_amount').value);
    if (!(amount > 0)) return toast('Geçerli bir tutar gir');
    const date = $('#qe_date').value || todayStr();
    const note = $('#qe_note').value.trim();
    const personId = $('#qe_person').value || selectedPersonId;

    if (mode === 'gider') {
      const cat = S.expenseCategories.find(c => c.id === selectedCatId);
      const paid = S.incomeTypes.find(t => t.id === selectedPaidId);
      if (!cat || !paid) return toast('Kategori ve hesap seç');
      try {
        localStorage.setItem(LAST_SOURCE_KEY, paid.id);
      } catch {}
      runAtomic(
        $('#qe_submit'),
        draft => {
          draft.expense_entries.push({
            id: newId('exp'),
            categoryId: cat.id,
            categoryName: cat.name,
            paidFromTypeId: paid.id,
            paidFromTypeName: paid.name,
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
          closeSheet();
          renderView(S.view);
          toast('Gider kaydedildi ✓');
        }
      );
    } else if (mode === 'gelir') {
      const type = S.incomeTypes.find(t => t.id === selectedIncTypeId);
      if (!type) return toast('Gelir kaynağı seç');
      runAtomic(
        $('#qe_submit'),
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
          closeSheet();
          renderView(S.view);
          toast('Gelir kaydedildi ✓');
        }
      );
    } else {
      const fromT = S.incomeTypes.find(t => t.id === selectedFromId);
      const toT = S.incomeTypes.find(t => t.id === selectedToId);
      if (!fromT || !toT || fromT.id === toT.id) return toast('Farklı iki hesap seç');
      runAtomic(
        $('#qe_submit'),
        draft => {
          draft.transfers.push({
            id: newId('tr'),
            direction: 'pot_to_pot',
            personId,
            fromTypeId: fromT.id,
            toTypeId: toT.id,
            amount: round2(amount),
            date,
            label: `${fromT.name} → ${toT.name}`,
            sub: `${personName(S, fromT.personId)} → ${personName(S, toT.personId)}`,
            note,
            createdAt: new Date().toISOString()
          });
        },
        'Hesaplar arası transfer',
        () => {
          closeSheet();
          renderView(S.view);
          toast('Transfer kaydedildi ✓');
        }
      );
    }
  });
}

// ---------- 2. PORTFÖY (GRUPLU POZİSYON VİTRİNİ) ----------
function renderPortfoy() {
  const ov = computeOverview(S, S.personFilter);
  const kzCls = ov.investProfit >= 0 ? 'profit-pos' : 'profit-neg';
  const kzSign = ov.investProfit >= 0 ? '+' : '';
  const relCls = ov.realizedProfit >= 0 ? 'profit-pos' : 'profit-neg';
  const relSign = ov.realizedProfit >= 0 ? '+' : '';

  $('#portfoyHeroCard').innerHTML =
    `<div class="card-title"><span>Portföy Değeri</span><span class="badge gold">Net Likidasyon ${fmt(ov.investNetLiquidation)}</span></div>` +
    `<div class="num" style="font-size:30px;font-weight:800;letter-spacing:-0.02em;">${fmtRich(ov.investValue)}</div>` +
    `<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-soft);margin-top:6px;">` +
    `<span>Ana Para: <strong class="num">${fmt(ov.investCost)}</strong></span>` +
    `<span>Açık K/Z: <strong class="num ${kzCls}">${kzSign}${fmt(ov.investProfit)}</strong></span>` +
    `<span>Realize K/Z: <strong class="num ${relCls}">${relSign}${fmt(ov.realizedProfit)}</strong></span>` +
    `</div>`;

  $$('#portfoyFilterTabs button').forEach(b => b.classList.toggle('active', b.dataset.pf === S.portfoyTab));

  const listEl = $('#portfoyList');
  const allocEl = $('#portfoyAllocCard');

  // Dağılım yan kartı
  const metalPct = ov.investValue > 0 ? Math.round((ov.metalValue / ov.investValue) * 100) : 0;
  const fundPct = ov.investValue > 0 ? 100 - metalPct : 0;
  allocEl.innerHTML =
    `<div class="card-title">Varlık Dağılımı & Hızlı İşlemler</div>` +
    `<div class="bar-row"><div class="bar-top"><span class="name">Kıymetli Maden</span><span class="amt num">${fmt(ov.metalValue)} (%${metalPct})</span></div><div class="bar-track"><div class="bar-fill gold" style="width:${metalPct}%"></div></div></div>` +
    `<div class="bar-row"><div class="bar-top"><span class="name">Yatırım Fonları</span><span class="amt num">${fmt(ov.fundValue)} (%${fundPct})</span></div><div class="bar-track"><div class="bar-fill" style="width:${fundPct}%"></div></div></div>` +
    `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">` +
    `<button type="button" class="btn-ghost" id="p_buy_metal" style="flex:1;min-height:40px;font-size:12.5px;">+ Maden Al</button>` +
    `<button type="button" class="btn-ghost" id="p_buy_fund" style="flex:1;min-height:40px;font-size:12.5px;">+ Fon Al</button>` +
    `<button type="button" class="btn-ghost" id="p_sell_any" style="flex:1;min-height:40px;font-size:12.5px;">Satış Yap</button>` +
    `</div>`;

  $('#p_buy_metal').addEventListener('click', () => openHoldingSheet(null));
  $('#p_buy_fund').addEventListener('click', () => openFundLotSheet(null));
  $('#p_sell_any').addEventListener('click', openSellSelectorSheet);

  if (S.portfoyTab === 'sales') {
    const fSales = ov.fundLedger.sales
      .filter(s => S.personFilter === 'all' || s.personId === S.personFilter)
      .map(s => ({ kind: 'fund_sale', date: s.saleDate, title: `${s.fundName} Fon Satışı`, sub: `${fmtNum(s.quantity, 4)} adet · Stopaj ${fmtTry(s.stopaj)}`, netProfit: s.netProfit, proceeds: s.netProceeds, id: s.id }));
    const mSales = ov.metalLedger.sales
      .filter(s => S.personFilter === 'all' || s.personId === S.personFilter)
      .map(s => ({ kind: 'metal_sale', date: s.saleDate, title: `${s.material} Satışı`, sub: `${fmtNum(s.quantity)} ${s.unit} · ${s.bank || '—'}`, netProfit: s.netProfit, proceeds: s.proceeds, id: s.id }));
    const allSales = fSales.concat(mSales).sort((a, b) => (a.date < b.date ? 1 : -1));

    if (allSales.length === 0) {
      listEl.innerHTML = `<div class="empty" style="border:none;">Henüz gerçekleşmiş satış kaydı yok.</div>`;
    } else {
      listEl.innerHTML = allSales
        .map(
          s =>
            `<div class="position-row" data-stype="${s.kind}" data-sid="${s.id}">` +
            `<div class="tx-ico ${s.kind === 'fund_sale' ? 'fund' : 'metal'}">${categoryIconSvg(s.title, s.kind === 'fund_sale' ? 'fund' : 'metal')}</div>` +
            `<div class="tx-main"><div class="tx-label">${esc(s.title)}</div><div class="tx-sub">${dayLabel(s.date)} · ${esc(s.sub)}</div></div>` +
            `<div class="position-right"><div class="position-val num">${fmt(s.proceeds)}</div><div class="position-pnl num ${s.netProfit >= 0 ? 'profit-pos' : 'profit-neg'}">${s.netProfit >= 0 ? '+' : ''}${fmt(s.netProfit)} kâr</div></div>` +
            `</div>`
        )
        .join('');
      listEl.querySelectorAll('.position-row').forEach(r =>
        r.addEventListener('click', () => {
          if (r.dataset.stype === 'fund_sale') openFundSaleDetailSheet(r.dataset.sid);
          else openMetalSaleDetailSheet(r.dataset.sid);
        })
      );
    }
    return;
  }

  // Pozisyonları grupla: Maden (material + normKey(bank)), Fon (fundKey(fundName))
  const positions = [];
  if (S.portfoyTab === 'all' || S.portfoyTab === 'metal') {
    const mMap = new Map();
    for (const h of ov.metalLedger.holdings) {
      if (S.personFilter !== 'all' && h.personId !== S.personFilter) continue;
      if (h.remaining <= 1e-9) continue;
      const k = materialPriceKey(h.material, h.bank);
      if (!mMap.has(k)) {
        mMap.set(k, {
          type: 'metal',
          key: k,
          material: h.material,
          bank: h.bank,
          unit: h.unit,
          qty: 0,
          cost: 0,
          value: 0,
          priceStatus: h.priceStatus,
          items: []
        });
      }
      const p = mMap.get(k);
      p.qty = round4(p.qty + h.remaining);
      p.cost = round2(p.cost + h.cost);
      p.value = round2(p.value + h.value);
      p.items.push(h);
    }
    positions.push(...mMap.values());
  }

  if (S.portfoyTab === 'all' || S.portfoyTab === 'fund') {
    const fMap = new Map();
    for (const l of ov.fundLedger.lots) {
      if (S.personFilter !== 'all' && l.personId !== S.personFilter) continue;
      if (l.remaining <= 1e-9) continue;
      const k = fundKey(l.fundName);
      if (!fMap.has(k)) {
        fMap.set(k, {
          type: 'fund',
          key: k,
          fundName: l.fundName,
          unit: 'adet',
          qty: 0,
          cost: 0,
          value: 0,
          netLiq: 0,
          hasPrice: l.hasPrice,
          items: []
        });
      }
      const p = fMap.get(k);
      p.qty = round4(p.qty + l.remaining);
      p.cost = round2(p.cost + l.cost);
      p.value = round2(p.value + l.value);
      p.netLiq = round2(p.netLiq + l.netLiquidationValue);
      p.items.push(l);
    }
    positions.push(...fMap.values());
  }

  positions.sort((a, b) => b.value - a.value);

  if (positions.length === 0) {
    listEl.innerHTML = `<div class="empty" style="border:none;"><img src="./assets/empty-vault.png" alt="" class="empty-vault-img">Bu görünümde açık pozisyon yok.</div>`;
    return;
  }

  listEl.innerHTML = positions
    .map((p, idx) => {
      const profit = round2(p.value - p.cost);
      const pct = p.cost > 0 ? (profit / p.cost) * 100 : 0;
      const sign = profit >= 0 ? '+' : '';
      const title = p.type === 'metal' ? p.material : `${p.fundName} Fonu`;
      const subtitle =
        p.type === 'metal'
          ? `${p.bank || 'Banka yok'} · ${fmtNum(p.qty)} ${p.unit}`
          : `${fmtNum(p.qty, 4)} adet · ${p.items.length} lot`;
      const badge =
        p.type === 'metal'
          ? p.priceStatus === 'live_group'
            ? ''
            : ' <span class="badge warn">Maliyetten</span>'
          : p.hasPrice
            ? ''
            : ' <span class="badge warn">Fiyat Eksik</span>';

      return (
        `<div class="position-row" data-pidx="${idx}">` +
        `<div class="tx-ico ${p.type}">${categoryIconSvg(title, p.type)}</div>` +
        `<div class="tx-main"><div class="tx-label">${esc(title)}${badge}</div><div class="tx-sub">${esc(subtitle)}</div></div>` +
        `<div class="position-right"><div class="position-val num">${fmt(p.value)}</div>` +
        `<div class="position-pnl num ${profit >= 0 ? 'profit-pos' : 'profit-neg'}">${sign}${fmt(profit)} (${sign}${fmtNum(pct, 1)}%)</div></div>` +
        `</div>`
      );
    })
    .join('');

  listEl.querySelectorAll('.position-row').forEach(row => {
    row.addEventListener('click', () => openAssetDetailSheet(positions[Number(row.dataset.pidx)]));
  });
}

function openAssetDetailSheet(pos) {
  if (!pos) return;
  const profit = round2(pos.value - pos.cost);
  const title = pos.type === 'metal' ? `${pos.material} · ${pos.bank || '—'}` : `${pos.fundName} Yatırım Fonu`;

  openSheet(
    `<div class="sheet-title">${esc(title)}</div>` +
      `<div class="stat-row" style="margin:10px 0 14px;">` +
      `<div class="stat-tile"><div class="l">Toplam Miktar</div><div class="v num">${fmtNum(pos.qty, pos.type === 'fund' ? 4 : 2)} ${esc(pos.unit)}</div></div>` +
      `<div class="stat-tile"><div class="l">Güncel Değer</div><div class="v num">${fmt(pos.value)}</div></div>` +
      `<div class="stat-tile"><div class="l">Ana Para</div><div class="v num">${fmt(pos.cost)}</div></div>` +
      `<div class="stat-tile"><div class="l">Açık K/Z</div><div class="v num ${profit >= 0 ? 'income' : 'expense'}">${profit >= 0 ? '+' : ''}${fmt(profit)}</div></div>` +
      `</div>` +
      `<div style="display:flex;gap:8px;margin-bottom:14px;">` +
      `<button type="button" class="btn-primary gold" id="ad_add" style="flex:1;margin-top:0;">+ Alış</button>` +
      `<button type="button" class="btn-ghost" id="ad_sell" style="flex:1;">Satış (FIFO)</button>` +
      `<button type="button" class="btn-ghost" id="ad_price" style="flex:1;">Fiyat</button>` +
      `</div>` +
      `<div class="card-title">Alış Lotları (Düzenlemek için dokun)</div>` +
      pos.items
        .map(
          it =>
            `<div class="cat-row" data-lotid="${it.id}" style="cursor:pointer;">` +
            `<div class="cat-name">${dayLabel(it.purchaseDate)} · ${esc(personName(S, it.personId))}<div class="pot-sub">Kalan ${fmtNum(it.remaining, pos.type === 'fund' ? 4 : 2)} @ ${fmtTry(it.purchasePrice)}</div></div>` +
            `<div class="num" style="font-weight:700;">${fmt(it.value)}</div>` +
            `</div>`
        )
        .join(''),
    { trackDirty: false }
  );

  $('#ad_add').addEventListener('click', () => (pos.type === 'metal' ? openHoldingSheet(null) : openFundLotSheet(null)));
  $('#ad_sell').addEventListener('click', () => (pos.type === 'metal' ? openMetalSaleSheet() : openFundSaleSheet()));
  $('#ad_price').addEventListener('click', () => (pos.type === 'metal' ? openPricesSheet() : openFundPricesSheet()));
  $$('#sheetContent [data-lotid]').forEach(row => {
    row.addEventListener('click', () => (pos.type === 'metal' ? openHoldingSheet(row.dataset.lotid) : openFundLotSheet(row.dataset.lotid)));
  });
}

function openBuyAssetSelectorSheet() {
  openSheet(
    `<div class="sheet-title">Hangi Varlık Türü?</div>` +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">` +
      `<button type="button" class="btn-primary gold" id="bs_metal" style="margin-top:0;">Kıymetli Maden</button>` +
      `<button type="button" class="btn-primary" id="bs_fund" style="margin-top:0;">Yatırım Fonu</button>` +
      `</div>`,
    { trackDirty: false }
  );
  $('#bs_metal').addEventListener('click', () => openHoldingSheet(null));
  $('#bs_fund').addEventListener('click', () => openFundLotSheet(null));
}

function openSellSelectorSheet() {
  openSheet(
    `<div class="sheet-title">Hangi Varlığı Satacaksın?</div>` +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">` +
      `<button type="button" class="btn-primary gold" id="ss_metal" style="margin-top:0;">Maden Satışı</button>` +
      `<button type="button" class="btn-primary" id="ss_fund" style="margin-top:0;">Fon Satışı</button>` +
      `</div>`,
    { trackDirty: false }
  );
  $('#ss_metal').addEventListener('click', openMetalSaleSheet);
  $('#ss_fund').addEventListener('click', openFundSaleSheet);
}

// ---------- 3. AKIŞ (AKILLI DEFTER) ----------
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

function renderAkis() {
  $$('#recordChips .chip').forEach(c => c.classList.toggle('active', c.dataset.rf === S.recordFilter));
  const entries = getFilteredRecords();
  const listEl = $('#recordsList');

  if (entries.length === 0) {
    listEl.innerHTML = `<div class="empty"><img src="./assets/empty-vault.png" alt="" class="empty-vault-img">Aramaya uyan hareket bulunamadı.</div>`;
    return;
  }

  let html = '';
  let lastMonth = null;
  for (const e of entries) {
    const ml = monthLabel(e.date);
    if (ml !== lastMonth) {
      if (lastMonth !== null) html += `</div></div>`;
      html += `<div class="month-header"><span>${esc(ml)}</span></div><div class="surface-card" style="padding:4px 14px;"><div class="tx-list">`;
      lastMonth = ml;
    }
    html += txRowHtml(e);
  }
  if (lastMonth !== null) html += `</div></div>`;

  listEl.innerHTML = html;
  bindTxRows(listEl);
}

// ---------- 4. İÇGÖRÜ (ANALİZ & AYLIK KAPANIŞ) ----------
function renderIcgoru() {
  $$('#periodChips .chip').forEach(c => c.classList.toggle('active', c.dataset.period === S.reportPeriod));
  $$('#scopeChips .chip').forEach(c => c.classList.toggle('active', c.dataset.scope === S.reportScope));

  const range = periodRange(S.reportPeriod);
  const scoped = unifiedEntries(S, S.personFilter, S.reportScope).filter(e => inRange(e.date, range));
  const incSum = round2(scoped.filter(e => e.kind === 'gelir').reduce((a, e) => a + e.amount, 0));
  const exp = scoped.filter(e => e.kind === 'gider');
  const expSum = round2(exp.reduce((a, e) => a + e.amount, 0));
  const net = round2(incSum - expSum);

  $('#repIncome').textContent = fmtShort(incSum);
  $('#repExpense').textContent = fmtShort(expSum);
  const netEl = $('#repNet');
  netEl.textContent = `${net >= 0 ? '+' : ''}${fmtShort(net)}`;
  netEl.className = `v num ${net >= 0 ? 'income' : 'expense'}`;

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

  const picker = $('#monthlyClosePicker');
  if (picker && !picker.value) picker.value = S.monthlyCloseYm;
  const mc = computeMonthlyClose(S, S.monthlyCloseYm, S.personFilter);
  $('#monthlyCloseBox').innerHTML =
    `<div class="cat-row"><div class="cat-name">Ay Başı Nakit</div><div class="num">${fmt(mc.openingCash)}</div></div>` +
    `<div class="cat-row"><div class="cat-name profit-pos">+ Gelirler</div><div class="num profit-pos">+${fmt(mc.monthIncome)}</div></div>` +
    `<div class="cat-row"><div class="cat-name profit-neg">− Giderler</div><div class="num profit-neg">−${fmt(mc.monthExpense)}</div></div>` +
    `<div class="cat-row"><div class="cat-name">⇄ Yatırım Transferi</div><div class="num">${fmt(mc.monthTransferIn - mc.monthTransferOut)}</div></div>` +
    `<div class="cat-row" style="border-top:2px solid var(--hairline);"><div class="cat-name"><strong>Ay Sonu Nakit</strong></div><div class="num" style="font-weight:800;">${fmt(mc.closingCash)}</div></div>` +
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
        .map(c => {
          const share = expSum > 0 ? (c.total / expSum) * 100 : 0;
          return `<div class="bar-row"><div class="bar-top"><span class="name">${esc(c.name)} <span style="opacity:0.55;">(%${fmtNum(share, 0)})</span></span><span class="amt num">${fmt(c.total)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, Math.round((c.total / maxCat) * 100))}%"></div></div></div>`;
        })
        .join('')
    : `<div class="empty" style="border:none;">Bu dönemde gider yok.</div>`;

  // Bankaya Göre Maden
  const bankArr = groupHoldingsByBank(S, S.personFilter);
  const maxBank = bankArr[0]?.total || 1;
  $('#bankBars').innerHTML = bankArr.length
    ? bankArr
        .map(
          b =>
            `<div class="bar-row"><div class="bar-top"><span class="name">${esc(b.name)} (${b.count})</span><span class="amt num">${fmt(b.total)}</span></div><div class="bar-track"><div class="bar-fill gold" style="width:${Math.max(4, Math.round((b.total / maxBank) * 100))}%"></div></div></div>`
        )
        .join('')
    : `<div class="empty" style="border:none;">Kıymetli maden kaydı yok.</div>`;
}

// ---------- DRILLDOWN & YARDIMCI SHEET'LER ----------
function openDrilldownSheet(mode) {
  const ov = computeOverview(S, S.personFilter);
  if (mode === 'cash') {
    const rows = unifiedEntries(S, S.personFilter, 'account').slice(0, 30);
    openSheet(
      `<div class="sheet-title">Nakit Mutabakatı · ${fmt(ov.cash)}</div>` +
        `<div class="field-hint" style="margin-bottom:10px;">Nakit bakiyesini oluşturan son 30 hareket.</div>` +
        `<div class="tx-list">${rows.length ? rows.map(txRowHtml).join('') : '<div class="empty">Hareket yok.</div>'}</div>`,
      { trackDirty: false }
    );
    bindTxRows($('#sheetContent'));
  } else if (mode === 'portfolio') {
    const srcRows = principalBySource(S, S.personFilter, ov);
    openSheet(
      `<div class="sheet-title">Portföy Özeti · ${fmt(ov.investValue)}</div>` +
        `<div class="field-hint" style="margin-bottom:10px;">Stopaj sonrası Net Likidasyon: <strong>${fmt(ov.investNetLiquidation)}</strong></div>` +
        srcRows
          .map(
            r =>
              `<div class="cat-row"><div class="cat-name">${esc(r.name)}</div><div class="num" style="font-weight:700;">${fmt(r.amount)}</div></div>`
          )
          .join('') +
        `<div class="sheet-actions"><button type="button" class="btn-primary" id="dd_go_portfoy" style="margin-top:0;">Portföy Vitrinini Aç</button></div>`,
      { trackDirty: false }
    );
    $('#dd_go_portfoy').addEventListener('click', () => {
      closeSheet();
      setView('portfoy');
    });
  } else {
    const range = periodRange('thisMonth');
    const rows = unifiedEntries(S, S.personFilter, 'spender').filter(e => inRange(e.date, range));
    openSheet(
      `<div class="sheet-title">Bu Ay Nakit Akışı</div>` +
        `<div class="tx-list">${rows.length ? rows.map(txRowHtml).join('') : '<div class="empty">Bu ay işlem yok.</div>'}</div>`,
      { trackDirty: false }
    );
    bindTxRows($('#sheetContent'));
  }
}

function fundingOptionsHtml(selectedId) {
  const types = S.incomeTypes.filter(t => !t.archived);
  return (
    `<option value=""${!selectedId ? ' selected' : ''}>— Açılış Kaydı / Nakitten Düşme —</option>` +
    types
      .map(t => `<option value="${t.id}"${t.id === selectedId ? ' selected' : ''}>${esc(t.name)} · ${esc(personName(S, t.personId))} (${fmtTry(computePotBalance(S, t.id).balance)})</option>`)
      .join('')
  );
}

function openIncomeTypeSheet(id) {
  const isNew = !id;
  const defaultPerson = S.personFilter !== 'all' ? S.personFilter : S.addPersonId || S.people[0]?.id || '';
  const t = isNew ? { personId: defaultPerson, name: '', archived: false } : S.incomeTypes.find(x => x.id === id);
  if (!t) return;
  const persons = S.people.filter(p => !p.archived);
  const potB = isNew ? { balance: 0 } : computePotBalance(S, t.id);

  openSheet(
    `<div class="sheet-title">${isNew ? 'Yeni Hesap / Gelir Kaynağı' : esc(t.name)}</div>` +
      (!isNew ? `<div class="field-hint" style="margin-bottom:8px;">Mevcut Bakiye: <strong>${fmt(potB.balance)}</strong></div>` : '') +
      `<div class="field"><label>Hesap Sahibi</label><select id="it_person">${persons.map(p => `<option value="${p.id}"${p.id === t.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Ad</label><input type="text" id="it_name" value="${esc(t.name)}" placeholder="Örn: Maaş"></div>` +
      `<div class="sheet-actions">` +
      (isNew ? '' : `<button type="button" class="btn-ghost" id="it_arch">${t.archived ? 'Arşivden Çıkar' : 'Arşivle'}</button>`) +
      (isNew ? '' : `<button type="button" class="btn-danger" id="it_del">Sil</button>`) +
      `<button type="button" class="btn-primary" id="it_save" style="margin-top:0;">Kaydet</button>` +
      `</div>`
  );

  $('#it_save').addEventListener('click', () => {
    const personId = $('#it_person').value;
    const name = $('#it_name').value.trim();
    if (!name) return toast('Ad gir');
    runAtomic(
      $('#it_save'),
      draft => {
        if (isNew) draft.income_types.push({ id: newId('it'), personId, name, archived: false, createdAt: new Date().toISOString() });
        else {
          const item = draft.income_types.find(x => x.id === t.id);
          if (item) Object.assign(item, { personId, name });
        }
      },
      'Hesap güncellendi',
      () => {
        closeSheet();
        renderView(S.view);
        toast('Kaydedildi');
      }
    );
  });

  if (!isNew) {
    $('#it_arch').addEventListener('click', () => {
      runAtomic($('#it_arch'), draft => {
        const item = draft.income_types.find(x => x.id === t.id);
        if (item) item.archived = !item.archived;
      }, 'Arşiv güncellendi', () => {
        closeSheet();
        renderView(S.view);
      });
    });
    $('#it_del').addEventListener('click', () => {
      const check = canDeleteEntity(S, 'income_types', t.id);
      if (!check.allowed) return toast(check.reason);
      runAtomic($('#it_del'), draft => {
        draft.income_types = draft.income_types.filter(x => x.id !== t.id);
      }, 'Hesap silindi', () => {
        closeSheet();
        renderView(S.view);
        toast('Silindi');
      });
    });
  }
}

function openDebtSheet(id) {
  const isNew = !id;
  const d = isNew ? { personId: S.addPersonId, name: '', amount: '', note: '' } : S.debts.find(x => x.id === id);
  if (!d) return;
  const persons = S.people.filter(p => !p.archived);

  openSheet(
    `<div class="sheet-title">${isNew ? 'Borç / Kredi Kartı Ekle' : 'Borcu Düzenle'}</div>` +
      `<div class="field"><label>Kişi</label><select id="db_person">${persons.map(p => `<option value="${p.id}"${p.id === d.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Ad</label><input type="text" id="db_name" value="${esc(d.name)}" placeholder="Örn: Kredi Kartı"></div>` +
      `<div class="field"><label>Güncel Tutar (₺)</label><input type="text" inputmode="decimal" id="db_amount" class="num-input" value="${d.amount || ''}" placeholder="0,00"></div>` +
      `<div class="field"><label>Not</label><input type="text" id="db_note" value="${esc(d.note || '')}"></div>` +
      `<div class="sheet-actions">${isNew ? '' : '<button type="button" class="btn-danger" id="db_del">Sil</button>'}<button type="button" class="btn-primary" id="db_save" style="margin-top:0;">Kaydet</button></div>`
  );

  $('#db_save').addEventListener('click', () => {
    const personId = $('#db_person').value;
    const name = $('#db_name').value.trim();
    const amount = parseMoneyInput($('#db_amount').value);
    const note = $('#db_note').value.trim();
    if (!name || !Number.isFinite(amount) || amount < 0) return toast('Geçerli ad ve tutar gir');
    runAtomic($('#db_save'), draft => {
      if (isNew) draft.debts.push({ id: newId('db'), personId, name, amount: round2(amount), note, archived: false, createdAt: new Date().toISOString() });
      else Object.assign(draft.debts.find(x => x.id === d.id), { personId, name, amount: round2(amount), note });
    }, 'Borç kaydı', () => {
      closeSheet();
      renderView(S.view);
      toast('Kaydedildi');
    });
  });

  if (!isNew) {
    $('#db_del').addEventListener('click', () => {
      runAtomic($('#db_del'), draft => {
        draft.debts = draft.debts.filter(x => x.id !== d.id);
      }, 'Borç silindi', () => {
        closeSheet();
        renderView(S.view);
        toast('Silindi');
      });
    });
  }
}

function openEditTxSheet(kind, id) {
  const entry = (kind === 'gider' ? S.expenseEntries : S.incomeEntries).find(e => e.id === id);
  if (!entry) return;
  const persons = S.people.filter(p => !p.archived);

  openSheet(
    `<div class="sheet-title">${kind === 'gider' ? 'Gideri Düzenle' : 'Geliri Düzenle'}</div>` +
      `<div class="field"><label>Tutar (₺)</label><input type="text" inputmode="decimal" id="et_amount" class="num-input" value="${entry.amount}"></div>` +
      `<div class="field"><label>Kişi</label><select id="et_person">${persons.map(p => `<option value="${p.id}"${p.id === entry.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      (kind === 'gider'
        ? `<div class="field"><label>Kategori</label><select id="et_cat">${S.expenseCategories.map(c => `<option value="${c.id}"${c.id === entry.categoryId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` +
          `<div class="field"><label>Ödeme Hesabı</label><select id="et_paid">${S.incomeTypes.map(t => `<option value="${t.id}"${t.id === entry.paidFromTypeId ? ' selected' : ''}>${esc(t.name)} · ${esc(personName(S, t.personId))}</option>`).join('')}</select></div>`
        : `<div class="field"><label>Gelir Kaynağı</label><select id="et_type">${S.incomeTypes.map(t => `<option value="${t.id}"${t.id === entry.typeId ? ' selected' : ''}>${esc(t.name)} · ${esc(personName(S, t.personId))}</option>`).join('')}</select></div>`) +
      `<div class="field"><label>Tarih</label><input type="date" id="et_date" value="${entry.date}"></div>` +
      `<div class="field"><label>Not</label><input type="text" id="et_note" value="${esc(entry.note || '')}"></div>` +
      `<div class="sheet-actions"><button type="button" class="btn-danger" id="et_del">Sil</button><button type="button" class="btn-primary" id="et_save" style="margin-top:0;">Kaydet</button></div>`
  );

  $('#et_save').addEventListener('click', () => {
    const amount = parseMoneyInput($('#et_amount').value);
    if (!(amount > 0)) return toast('Geçerli tutar gir');
    const personId = $('#et_person').value;
    const date = $('#et_date').value || entry.date;
    const note = $('#et_note').value.trim();

    runAtomic($('#et_save'), draft => {
      const col = kind === 'gider' ? 'expense_entries' : 'income_entries';
      const row = draft[col].find(x => x.id === id);
      if (!row) return;
      Object.assign(row, { amount: round2(amount), personId, personName: personName(S, personId), date, note });
      if (kind === 'gider') {
        const cat = S.expenseCategories.find(c => c.id === $('#et_cat').value);
        const type = S.incomeTypes.find(t => t.id === $('#et_paid').value);
        if (cat) { row.categoryId = cat.id; row.categoryName = cat.name; }
        if (type) { row.paidFromTypeId = type.id; row.paidFromTypeName = type.name; }
      } else {
        const type = S.incomeTypes.find(t => t.id === $('#et_type').value);
        if (type) { row.typeId = type.id; row.typeName = type.name; }
      }
    }, 'İşlem güncellendi', () => {
      closeSheet();
      renderView(S.view);
      toast('Güncellendi');
    });
  });

  $('#et_del').addEventListener('click', () => {
    const btn = $('#et_del');
    if (btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.textContent = 'Emin misin? Tekrar dokun';
      return;
    }
    runAtomic(btn, draft => {
      const col = kind === 'gider' ? 'expense_entries' : 'income_entries';
      draft[col] = draft[col].filter(x => x.id !== id);
    }, 'İşlem silindi', () => {
      closeSheet();
      renderView(S.view);
      toast('Silindi');
    });
  });
}

function openTransferDetailSheet(id) {
  const tr = S.transfers.find(t => t.id === id);
  if (!tr) return;
  openSheet(
    `<div class="sheet-title">Transfer</div>` +
      `<div class="cat-row"><div class="cat-name">${esc(tr.label || tr.direction)}</div><div class="num" style="font-weight:700;">${fmt(tr.amount)}</div></div>` +
      `<div class="cat-row"><div class="cat-name">Tarih</div><div>${dayLabel(tr.date)}</div></div>` +
      `<div class="cat-row"><div class="cat-name">Detay</div><div>${esc(tr.note || tr.sub || '—')}</div></div>` +
      `<div class="sheet-actions"><button type="button" class="btn-danger" id="tr_del">Transferi Sil</button></div>`,
    { trackDirty: false }
  );
  $('#tr_del').addEventListener('click', () => {
    runAtomic($('#tr_del'), draft => {
      draft.transfers = draft.transfers.filter(x => x.id !== id);
    }, 'Transfer silindi', () => {
      closeSheet();
      renderView(S.view);
      toast('Silindi');
    });
  });
}

// ---------- MADEN & FON SHEET'LERİ ----------
function openHoldingSheet(id) {
  const isNew = !id;
  const h = isNew
    ? { personId: S.addPersonId, material: '', bank: '', quantity: '', unit: 'gram', purchasePrice: '', purchaseDate: todayStr(), currentPrice: '', note: '', incomeTypeId: '' }
    : S.savingsHoldings.find(x => x.id === id);
  if (!h) return;
  const persons = S.people.filter(p => !p.archived);

  openSheet(
    `<div class="sheet-title">${isNew ? 'Kıymetli Maden Alışı' : 'Maden Kaydını Düzenle'}</div>` +
      `<div class="field"><label>Kişi</label><select id="h_person">${persons.map(p => `<option value="${p.id}"${p.id === h.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Materyal</label><input type="text" id="h_material" list="matOpts" value="${esc(h.material)}" placeholder="Örn: Gram Altın"><datalist id="matOpts">${MATERIAL_PRESETS.map(m => `<option value="${esc(m)}">`).join('')}</datalist></div>` +
      `<div class="field"><label>Banka / Yer</label><input type="text" id="h_bank" value="${esc(h.bank)}" placeholder="Örn: Dünya Katılım"></div>` +
      `<div class="field"><label>Miktar & Birim</label><div style="display:flex;gap:8px;"><input type="text" inputmode="decimal" id="h_qty" class="num-input" value="${h.quantity || ''}" placeholder="0,00"><select id="h_unit" style="width:110px;flex:none;"><option value="gram"${h.unit === 'gram' ? ' selected' : ''}>gram</option><option value="adet"${h.unit === 'adet' ? ' selected' : ''}>adet</option></select></div></div>` +
      `<div class="field"><label>Alış Fiyatı (birim ₺ — hediye için 0)</label><input type="text" inputmode="decimal" id="h_price" class="num-input" value="${h.purchasePrice !== '' && h.purchasePrice != null ? h.purchasePrice : ''}" placeholder="0,00"></div>` +
      `<div class="field"><label>Ödeme Hesabı</label><select id="h_incometype">${fundingOptionsHtml(h.incomeTypeId)}</select></div>` +
      `<div class="field"><label>Tarih</label><input type="date" id="h_date" value="${h.purchaseDate || todayStr()}"></div>` +
      `<div class="field"><label>Güncel Fiyat (opsiyonel)</label><input type="text" inputmode="decimal" id="h_cur" class="num-input" value="${h.currentPrice || ''}"></div>` +
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

    if (!material || !(quantity > 0) || !Number.isFinite(purchasePrice) || purchasePrice < 0) {
      return toast('Geçerli materyal, miktar ve alış fiyatı gir');
    }

    const totalCost = round2(quantity * purchasePrice);
    runAtomic($('#h_save'), draft => {
      if (Number.isFinite(currentPrice) && currentPrice > 0) {
        const gp = draft.material_prices.find(p => materialPriceKey(p.material, p.bank) === materialPriceKey(material, bank));
        if (!gp) draft.material_prices.push({ id: newId('mp'), material, bank, price: round2(currentPrice), updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
      }
      if (isNew) {
        const hid = newId('h');
        let linkedTransferId = null;
        if (incomeTypeId && totalCost > 0) {
          linkedTransferId = newId('tr');
          draft.transfers.push({
            id: linkedTransferId, direction: 'to_investment', personId, fromTypeId: incomeTypeId, toTypeId: null,
            amount: totalCost, date: purchaseDate, label: `Maden Alışı · ${material}`, sub: `${fmtNum(quantity)} ${unit} @ ${fmtTry(purchasePrice)}`, note, linkedId: hid, createdAt: new Date().toISOString()
          });
        }
        draft.savings_holdings.push({
          id: hid, personId, personName: personName(S, personId), incomeTypeId, linkedTransferId, fundingMode: linkedTransferId ? 'transfer' : 'opening',
          material, bank, quantity: round4(quantity), unit, purchasePrice, purchaseDate, currentPrice: Number.isFinite(currentPrice) ? currentPrice : 0, note, createdAt: new Date().toISOString()
        });
      } else {
        const item = draft.savings_holdings.find(x => x.id === h.id);
        if (item) {
          Object.assign(item, { personId, personName: personName(S, personId), incomeTypeId, material, bank, quantity: round4(quantity), unit, purchasePrice, purchaseDate, currentPrice: Number.isFinite(currentPrice) ? currentPrice : 0, note });
          if (item.linkedTransferId) {
            const tr = draft.transfers.find(t => t.id === item.linkedTransferId);
            if (tr && incomeTypeId && totalCost > 0) { tr.amount = totalCost; tr.fromTypeId = incomeTypeId; tr.date = purchaseDate; tr.personId = personId; }
          }
        }
      }
    }, isNew ? 'Maden alışı' : 'Maden düzenlendi', () => {
      closeSheet();
      renderView(S.view);
      toast('Kaydedildi ✓');
    });
  });

  if (!isNew) {
    $('#h_del').addEventListener('click', () => {
      const btn = $('#h_del');
      if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = 'Emin misin? Tekrar dokun'; return; }
      runAtomic(btn, draft => {
        draft.savings_holdings = draft.savings_holdings.filter(x => x.id !== h.id);
        if (h.linkedTransferId) draft.transfers = draft.transfers.filter(t => t.id !== h.linkedTransferId);
      }, 'Maden silindi', () => {
        closeSheet();
        renderView(S.view);
        toast('Silindi');
      });
    });
  }
}

function openMetalSaleSheet() {
  const ml = computeMetalLedger(S);
  const poolMap = new Map();
  for (const h of ml.holdings) {
    if (h.remaining <= 1e-9) continue;
    const k = `${h.personId}||${materialPriceKey(h.material, h.bank)}`;
    if (!poolMap.has(k)) poolMap.set(k, { personId: h.personId, material: h.material, bank: h.bank, unit: h.unit, qty: 0 });
    poolMap.get(k).qty = round4(poolMap.get(k).qty + h.remaining);
  }
  const pools = Array.from(poolMap.values());
  if (pools.length === 0) return toast('Satılacak kıymetli maden yok');

  openSheet(
    `<div class="sheet-title">Maden Satışı (FIFO)</div>` +
      `<div class="field"><label>Varlık Havuzu</label><select id="ms_pool">${pools.map((p, i) => `<option value="${i}">${esc(p.material)} · ${esc(p.bank || '—')} (${fmtNum(p.qty)} ${esc(p.unit)})</option>`).join('')}</select></div>` +
      `<div class="field"><label>Satış Miktarı</label><input type="text" inputmode="decimal" id="ms_qty" class="num-input"></div>` +
      `<div class="field"><label>Birim Satış Fiyatı (₺)</label><input type="text" inputmode="decimal" id="ms_price" class="num-input"></div>` +
      `<div class="field"><label>Aktarılacak Nakit Hesabı</label><select id="ms_to">${fundingOptionsHtml('')}</select></div>` +
      `<div class="field"><label>Tarih</label><input type="date" id="ms_date" value="${todayStr()}"></div>` +
      `<div class="field-hint" id="ms_preview"></div>` +
      `<div class="sheet-actions"><button type="button" class="btn-primary gold" id="ms_save" style="margin-top:0;">Satışı Kaydet</button></div>`
  );

  const upd = () => {
    const p = pools[Number($('#ms_pool').value)];
    const pv = previewMetalSale(S, p.personId, p.material, p.bank, parseMoneyInput($('#ms_qty').value), parseMoneyInput($('#ms_price').value));
    $('#ms_preview').innerHTML = pv.ok ? `Maliyet ${fmtTry(pv.costBasis)} · Net Kâr <strong>${fmtTry(pv.netProfit)}</strong>` : '';
  };
  ['#ms_pool', '#ms_qty', '#ms_price'].forEach(s => $(s).addEventListener('input', upd));

  $('#ms_save').addEventListener('click', () => {
    const p = pools[Number($('#ms_pool').value)];
    const qty = parseMoneyInput($('#ms_qty').value);
    const price = parseMoneyInput($('#ms_price').value);
    const toTypeId = $('#ms_to').value || null;
    const saleDate = $('#ms_date').value || todayStr();
    const pv = previewMetalSale(S, p.personId, p.material, p.bank, qty, price);
    if (!pv.ok) return toast('Geçerli miktar/fiyat gir');

    runAtomic($('#ms_save'), draft => {
      const sid = newId('ms');
      let linkedTransferId = null;
      if (toTypeId && pv.proceeds > 0) {
        linkedTransferId = newId('tr');
        draft.transfers.push({
          id: linkedTransferId, direction: 'to_cash', personId: p.personId, fromTypeId: null, toTypeId,
          amount: pv.proceeds, date: saleDate, label: `Maden Satışı · ${p.material}`, sub: `${fmtNum(qty)} ${p.unit}`, linkedId: sid, createdAt: new Date().toISOString()
        });
      }
      draft.metal_sales.push({ id: sid, personId: p.personId, material: p.material, bank: p.bank, unit: p.unit, quantity: round4(qty), salePrice: price, saleDate, toTypeId, linkedTransferId, createdAt: new Date().toISOString() });
    }, 'Maden satışı', () => {
      closeSheet();
      renderView(S.view);
      toast('Satış kaydedildi ✓');
    });
  });
}

function openMetalSaleDetailSheet(id) {
  const s = S.metalSales.find(x => x.id === id);
  if (!s) return;
  openSheet(
    `<div class="sheet-title">Maden Satışı · ${esc(s.material)}</div>` +
      `<div class="cat-row"><div class="cat-name">${fmtNum(s.quantity)} ${esc(s.unit)} @ ${fmtTry(s.salePrice)}</div><div>${dayLabel(s.saleDate)}</div></div>` +
      `<div class="sheet-actions"><button type="button" class="btn-danger" id="ms_del">Satışı Geri Al</button></div>`,
    { trackDirty: false }
  );
  $('#ms_del').addEventListener('click', () => {
    runAtomic($('#ms_del'), draft => {
      draft.metal_sales = draft.metal_sales.filter(x => x.id !== id);
      if (s.linkedTransferId) draft.transfers = draft.transfers.filter(t => t.id !== s.linkedTransferId);
    }, 'Maden satışı geri alındı', () => {
      closeSheet();
      renderView(S.view);
      toast('Geri alındı');
    });
  });
}

function openPricesSheet() {
  const seen = new Map();
  for (const h of S.savingsHoldings) {
    const k = materialPriceKey(h.material, h.bank);
    if (!seen.has(k)) seen.set(k, { material: h.material, bank: h.bank });
  }
  const groups = Array.from(seen.values());
  if (groups.length === 0) return toast('Önce bir kıymetli maden ekle');

  openSheet(
    `<div class="sheet-title">Banka Kurları & Fiyat Güncelleme</div>` +
      `<div class="field-hint" style="margin-bottom:10px;">Alış/satış makası <strong>%5 üzerindeyse</strong> mesai dışı hatalı düşüşleri önlemek için otomatik koruma uygulanır.</div>` +
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">` +
      `<button type="button" class="btn-ghost" id="fetchPricesBtn" style="flex:1;">↻ Kurları Çek</button>` +
      `<label style="display:flex;align-items:center;gap:5px;font-size:12px;"><input type="checkbox" id="includeCoinsChk"> Sarrafiye</label>` +
      `</div><div id="fetchPricesStatus" class="field-hint" style="margin-bottom:10px;"></div>` +
      groups.map(g => {
        const cur = getGroupPrice(S, g.material, g.bank);
        return `<div class="cat-row"><div class="cat-name">${esc(g.material)}<div class="pot-sub">${esc(g.bank || '—')}</div></div><input type="text" inputmode="decimal" class="num-input price-input" data-material="${esc(g.material)}" data-bank="${esc(g.bank || '')}" value="${cur != null ? cur : ''}" style="width:120px;min-height:40px;border-radius:10px;border:1px solid var(--hairline);background:var(--surface);color:var(--ink);padding:6px 10px;font-size:15px;"></div>`;
      }).join('') +
      `<div class="sheet-actions"><button type="button" class="btn-primary gold" id="savePricesBtn" style="margin-top:0;">Tümünü Kaydet</button></div>`
  );

  $('#fetchPricesBtn').addEventListener('click', async () => {
    const st = $('#fetchPricesStatus');
    try {
      const res = await fetch(`../prices.json?t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      const { matches, skippedWarnings, analysis } = matchFetchedPrices(groups, data, { includeCoins: $('#includeCoinsChk').checked });
      let filled = 0;
      $$('#sheetContent .price-input').forEach(inp => {
        const m = matches.find(x => materialPriceKey(x.material, x.bank) === materialPriceKey(inp.dataset.material, inp.dataset.bank));
        if (m) { inp.value = m.price; inp.style.borderColor = 'var(--gold)'; filled++; }
      });
      st.innerHTML = `${filled} fiyat dolduruldu (${formatDateTime(analysis?.updatedAt)}).` +
        (skippedWarnings.length ? `<div class="badge warn" style="margin-top:6px;display:block;white-space:normal;">Makas Koruması: ${skippedWarnings.map(w => `${esc(w.sourceLabel)} (%${w.spreadPct} makas)`).join(', ')} atlandı.</div>` : '');
    } catch {
      st.textContent = 'prices.json okunamadı.';
    }
  });

  $('#savePricesBtn').addEventListener('click', () => {
    const updates = [];
    $$('#sheetContent .price-input').forEach(inp => {
      const p = parseMoneyInput(inp.value);
      if (Number.isFinite(p) && p > 0) updates.push({ material: inp.dataset.material, bank: inp.dataset.bank, price: round2(p) });
    });
    if (updates.length === 0) return toast('Geçerli fiyat gir');
    runAtomic($('#savePricesBtn'), draft => {
      const nowIso = new Date().toISOString();
      for (const u of updates) {
        const key = materialPriceKey(u.material, u.bank);
        const ex = draft.material_prices.find(p => materialPriceKey(p.material, p.bank) === key);
        if (ex) {
          if (Number(ex.price) > 0 && Number(ex.price) !== u.price) { ex.previousPrice = Number(ex.price); ex.previousPriceAt = nowIso; }
          ex.price = u.price; ex.updatedAt = nowIso;
        } else {
          draft.material_prices.push({ id: newId('mp'), material: u.material, bank: u.bank, price: u.price, updatedAt: nowIso, createdAt: nowIso });
        }
      }
    }, 'Fiyatlar güncellendi', () => {
      closeSheet();
      renderView(S.view);
      toast(`${updates.length} fiyat kaydedildi ✓`);
    });
  });
}

function openFundLotSheet(id) {
  const isNew = !id;
  const ledger = computeFundLedger(S);
  const raw = isNew ? { personId: S.addPersonId, fundName: FUND_PRESETS[0] || '', quantity: '', purchasePrice: '', purchaseDate: todayStr(), note: '', incomeTypeId: '' } : S.fundLots.find(x => x.id === id);
  if (!raw) return;
  const soldQty = isNew ? 0 : (ledger.lotById.get(id)?.soldQuantity || 0);
  const locked = !isNew && soldQty > 1e-9;
  const persons = S.people.filter(p => !p.archived);
  const curStopaj = raw.stopajRate != null ? Number(raw.stopajRate) : getFundStopajRate(S, raw.fundName);

  openSheet(
    `<div class="sheet-title">${isNew ? 'Yatırım Fonu Alışı' : 'Fon Lotunu Düzenle'}</div>` +
      `<div class="field"><label>Kişi</label><select id="fl_person"${locked ? ' disabled' : ''}>${persons.map(p => `<option value="${p.id}"${p.id === raw.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Fon Kodu</label><input type="text" id="fl_name" value="${esc(raw.fundName)}"${locked ? ' disabled' : ''}></div>` +
      `<div class="field"><label>Adet</label><input type="text" inputmode="decimal" id="fl_qty" class="num-input" value="${raw.quantity || ''}"></div>` +
      `<div class="field"><label>Alış Fiyatı (₺)</label><input type="text" inputmode="decimal" id="fl_price" class="num-input" value="${raw.purchasePrice !== '' && raw.purchasePrice != null ? raw.purchasePrice : ''}"></div>` +
      `<div class="field"><label>Stopaj Oranı</label><select id="fl_stopaj">${STOPAJ_OPTIONS.map(o => `<option value="${o.val}"${Math.abs(o.val - curStopaj) < 0.001 ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Ödeme Hesabı</label><select id="fl_incometype">${fundingOptionsHtml(raw.incomeTypeId)}</select></div>` +
      `<div class="field"><label>Tarih</label><input type="date" id="fl_date" value="${raw.purchaseDate || todayStr()}"></div>` +
      `<div class="sheet-actions">${isNew || locked ? '' : '<button type="button" class="btn-danger" id="fl_del">Sil</button>'}<button type="button" class="btn-primary gold" id="fl_save" style="margin-top:0;">Kaydet</button></div>`
  );

  $('#fl_save').addEventListener('click', () => {
    const personId = $('#fl_person').value;
    const fundName = $('#fl_name').value.trim();
    const quantity = parseMoneyInput($('#fl_qty').value);
    const purchasePrice = parseMoneyInput($('#fl_price').value);
    const stopajRate = Number($('#fl_stopaj').value);
    const incomeTypeId = $('#fl_incometype').value || null;
    const purchaseDate = $('#fl_date').value || todayStr();

    if (!fundName || !(quantity > 0) || quantity < soldQty - 1e-9 || !Number.isFinite(purchasePrice) || purchasePrice < 0) {
      return toast('Geçerli fon, adet ve alış fiyatı gir');
    }
    const totalCost = round2(quantity * purchasePrice);
    runAtomic($('#fl_save'), draft => {
      const cfg = draft.fund_configs.find(c => fundKey(c.fundName) === fundKey(fundName));
      if (cfg) cfg.stopajRate = stopajRate;
      else draft.fund_configs.push({ id: newId('fc'), fundName, stopajRate });

      if (isNew) {
        const lid = newId('fl');
        let linkedTransferId = null;
        if (incomeTypeId && totalCost > 0) {
          linkedTransferId = newId('tr');
          draft.transfers.push({
            id: linkedTransferId, direction: 'to_investment', personId, fromTypeId: incomeTypeId, toTypeId: null,
            amount: totalCost, date: purchaseDate, label: `Fon Alışı · ${fundName}`, sub: `${fmtNum(quantity, 4)} adet`, linkedId: lid, createdAt: new Date().toISOString()
          });
        }
        draft.fund_lots.push({
          id: lid, personId, incomeTypeId, linkedTransferId, fundingMode: linkedTransferId ? 'transfer' : 'opening',
          fundName, quantity: round4(quantity), remainingQuantity: round4(quantity), purchasePrice, stopajRate, purchaseDate, createdAt: new Date().toISOString()
        });
      } else {
        const item = draft.fund_lots.find(x => x.id === raw.id);
        if (item) {
          Object.assign(item, { incomeTypeId, quantity: round4(quantity), remainingQuantity: round4(quantity - soldQty), purchasePrice, stopajRate, purchaseDate });
          if (!locked) { item.personId = personId; item.fundName = fundName; }
        }
      }
    }, 'Fon lotu kaydedildi', () => {
      closeSheet();
      renderView(S.view);
      toast('Kaydedildi ✓');
    });
  });

  if (!isNew && !locked) {
    $('#fl_del')?.addEventListener('click', () => {
      runAtomic($('#fl_del'), draft => {
        draft.fund_lots = draft.fund_lots.filter(x => x.id !== raw.id);
        if (raw.linkedTransferId) draft.transfers = draft.transfers.filter(t => t.id !== raw.linkedTransferId);
      }, 'Fon lotu silindi', () => {
        closeSheet();
        renderView(S.view);
        toast('Silindi');
      });
    });
  }
}

function openFundSaleSheet() {
  const persons = S.people.filter(p => !p.archived);
  const ledger = computeFundLedger(S);
  const fundNames = Array.from(new Set(ledger.lots.filter(l => l.remaining > 1e-9).map(l => l.fundName)));
  if (fundNames.length === 0) return toast('Satılacak fon lotu yok');

  openSheet(
    `<div class="sheet-title">Fon Satışı (FIFO)</div>` +
      `<div class="field"><label>Kişi</label><select id="fs_person">${persons.map(p => `<option value="${p.id}"${p.id === S.addPersonId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` +
      `<div class="field"><label>Fon</label><input type="text" id="fs_name" value="${esc(fundNames[0])}"></div>` +
      `<div class="field"><label>Satış Adedi</label><input type="text" inputmode="decimal" id="fs_qty" class="num-input"></div>` +
      `<div class="field"><label>Satış Fiyatı (₺)</label><input type="text" inputmode="decimal" id="fs_price" class="num-input"></div>` +
      `<div class="field"><label>Ekstre Stopajı (opsiyonel)</label><input type="text" inputmode="decimal" id="fs_actual" class="num-input" placeholder="Otomatik"></div>` +
      `<div class="field"><label>Aktarılacak Nakit Hesabı</label><select id="fs_to">${fundingOptionsHtml('')}</select></div>` +
      `<div class="field"><label>Tarih</label><input type="date" id="fs_date" value="${todayStr()}"></div>` +
      `<div id="fs_preview" class="field-hint"></div>` +
      `<div class="sheet-actions"><button type="button" class="btn-primary gold" id="fs_save" style="margin-top:0;">Satışı Kaydet</button></div>`
  );

  const upd = () => {
    const pv = previewFundSale(S, $('#fs_person').value, $('#fs_name').value.trim(), parseMoneyInput($('#fs_qty').value), parseMoneyInput($('#fs_price').value));
    $('#fs_preview').innerHTML = pv.ok ? `Maliyet ${fmtTry(pv.costBasis)} · Stopaj ${fmtTry(pv.stopaj)} · Nakde geçen <strong>${fmtTry(pv.netProceeds)}</strong>` : '';
  };
  ['#fs_person', '#fs_name', '#fs_qty', '#fs_price'].forEach(s => $(s).addEventListener('input', upd));

  $('#fs_save').addEventListener('click', () => {
    const personId = $('#fs_person').value;
    const fundName = $('#fs_name').value.trim();
    const qty = parseMoneyInput($('#fs_qty').value);
    const price = parseMoneyInput($('#fs_price').value);
    const actualRaw = $('#fs_actual').value.trim();
    const actualStopaj = actualRaw ? parseMoneyInput(actualRaw) : null;
    const toTypeId = $('#fs_to').value || null;
    const saleDate = $('#fs_date').value || todayStr();
    const pv = previewFundSale(S, personId, fundName, qty, price);
    if (!pv.ok) return toast('Geçerli adet ve fiyat gir');

    const finalStopaj = actualStopaj != null && Number.isFinite(actualStopaj) ? round2(actualStopaj) : pv.stopaj;
    const netProceeds = round2(pv.proceeds - finalStopaj);

    runAtomic($('#fs_save'), draft => {
      const sid = newId('fs');
      let linkedTransferId = null;
      if (toTypeId && netProceeds > 0) {
        linkedTransferId = newId('tr');
        draft.transfers.push({
          id: linkedTransferId, direction: 'to_cash', personId, fromTypeId: null, toTypeId,
          amount: netProceeds, date: saleDate, label: `Fon Satışı · ${fundName}`, sub: `${fmtNum(qty, 4)} adet`, linkedId: sid, createdAt: new Date().toISOString()
        });
      }
      draft.fund_sales.push({
        id: sid, personId, fundName, quantity: round4(qty), salePrice: price, saleDate, toTypeId, linkedTransferId,
        costBasis: pv.costBasis, proceeds: pv.proceeds, grossProfit: pv.grossProfit, stopaj: finalStopaj,
        actualStopaj: actualStopaj != null && Number.isFinite(actualStopaj) ? round2(actualStopaj) : null,
        netProfit: round2(pv.grossProfit - finalStopaj), lotBreakdown: pv.lotBreakdown, createdAt: new Date().toISOString()
      });
    }, 'Fon satışı', () => {
      closeSheet();
      renderView(S.view);
      toast('Satış kaydedildi ✓');
    });
  });
}

function openFundSaleDetailSheet(id) {
  const s = computeFundLedger(S).sales.find(x => x.id === id);
  if (!s) return;
  openSheet(
    `<div class="sheet-title">Fon Satışı · ${esc(s.fundName)}</div>` +
      `<div class="cat-row"><div class="cat-name">${fmtNum(s.quantity, 4)} adet @ ${fmtTry(s.salePrice)}</div><div>${dayLabel(s.saleDate)}</div></div>` +
      `<div class="cat-row"><div class="cat-name">Tahmini Stopaj</div><div class="num">${fmtTry(s.estimatedStopaj)}</div></div>` +
      `<div class="field"><label>Ekstre Stopajı (₺)</label><input type="text" inputmode="decimal" id="fsd_stopaj" class="num-input" value="${s.hasActualStopaj ? s.stopaj : ''}" placeholder="${s.estimatedStopaj}"></div>` +
      `<div class="sheet-actions"><button type="button" class="btn-danger" id="fsd_del">Geri Al</button><button type="button" class="btn-primary gold" id="fsd_save" style="margin-top:0;">Güncelle</button></div>`
  );
  $('#fsd_save').addEventListener('click', () => {
    const rawVal = $('#fsd_stopaj').value.trim();
    const parsed = rawVal ? parseMoneyInput(rawVal) : null;
    runAtomic($('#fsd_save'), draft => {
      const item = draft.fund_sales.find(x => x.id === id);
      if (item) {
        item.actualStopaj = parsed != null && Number.isFinite(parsed) ? round2(parsed) : null;
        if (item.linkedTransferId) {
          const tr = draft.transfers.find(t => t.id === item.linkedTransferId);
          if (tr) tr.amount = round2(s.proceeds - (item.actualStopaj != null ? item.actualStopaj : s.estimatedStopaj));
        }
      }
    }, 'Stopaj güncellendi', () => {
      closeSheet();
      renderView(S.view);
      toast('Güncellendi');
    });
  });
  $('#fsd_del').addEventListener('click', () => {
    runAtomic($('#fsd_del'), draft => {
      draft.fund_sales = draft.fund_sales.filter(x => x.id !== id);
      if (s.linkedTransferId) draft.transfers = draft.transfers.filter(t => t.id !== s.linkedTransferId);
    }, 'Fon satışı geri alındı', () => {
      closeSheet();
      renderView(S.view);
      toast('Geri alındı');
    });
  });
}

function openFundPricesSheet() {
  const names = Array.from(new Set(S.fundLots.map(l => l.fundName).filter(Boolean))).sort();
  if (names.length === 0) return toast('Önce bir fon lotu ekle');

  openSheet(
    `<div class="sheet-title">Fon Fiyatları</div>` +
      names.map(name => `<div class="cat-row"><div class="cat-name">${esc(name)}</div><input type="text" inputmode="decimal" class="num-input fp-inp" data-fund="${esc(name)}" value="${getFundPrice(S, name) || ''}" style="width:120px;min-height:40px;border-radius:10px;border:1px solid var(--hairline);background:var(--surface);color:var(--ink);padding:6px 10px;font-size:15px;"></div>`).join('') +
      `<div class="sheet-actions"><button type="button" class="btn-primary gold" id="fp_save" style="margin-top:0;">Tümünü Kaydet</button></div>`
  );
  $('#fp_save').addEventListener('click', () => {
    const updates = [];
    $$('#sheetContent .fp-inp').forEach(inp => {
      const val = parseMoneyInput(inp.value);
      if (Number.isFinite(val) && val > 0) updates.push({ fundName: inp.dataset.fund, price: round4(val) });
    });
    if (updates.length === 0) return toast('Geçerli fiyat gir');
    runAtomic($('#fp_save'), draft => {
      const nowIso = new Date().toISOString();
      for (const u of updates) {
        const ex = draft.fund_prices.find(p => fundKey(p.fundName) === fundKey(u.fundName));
        if (ex) { ex.previousPrice = Number(ex.price); ex.previousPriceAt = nowIso; ex.price = u.price; ex.updatedAt = nowIso; }
        else draft.fund_prices.push({ id: newId('fp'), fundName: u.fundName, price: u.price, updatedAt: nowIso, createdAt: nowIso });
      }
    }, 'Fon fiyatları güncellendi', () => {
      closeSheet();
      renderView(S.view);
      toast('Güncellendi ✓');
    });
  });
}

// ---------- CSV EKSTRE MUTABAKATI ----------
function openCsvReconcileSheet() {
  const activeTypes = S.incomeTypes.filter(t => !t.archived);
  const defaultCat = S.expenseCategories.find(c => !c.archived);
  if (activeTypes.length === 0 || !defaultCat) return toast('Önce hesap ve kategori tanımla');

  openSheet(
    `<div class="sheet-title">Banka CSV Ekstre Mutabakatı</div>` +
      `<div class="field"><label>Hesap</label><select id="csv_pot">${activeTypes.map(t => `<option value="${t.id}">${esc(t.name)} · ${esc(personName(S, t.personId))}</option>`).join('')}</select></div>` +
      `<div class="field"><label>CSV Dosyası</label><input type="file" id="csv_file" accept=".csv,text/csv"></div>` +
      `<div id="csv_preview" style="margin-top:10px;"></div>` +
      `<div class="sheet-actions" id="csv_actions" style="display:none;"><button type="button" class="btn-primary" id="csv_import_btn" style="margin-top:0;">Eksik Satırları Aktar</button></div>`
  );

  let parsed = [];
  $('#csv_file').addEventListener('change', async ev => {
    const file = ev.target.files?.[0];
    if (!file) return;
    parsed = parseBankCsvAndMatch(await file.text(), unifiedEntries(S, 'all', 'account'));
    $('#csv_preview').innerHTML = parsed.length
      ? parsed.map((r, i) => `<label class="cat-row"><input type="checkbox" class="csv-chk" data-idx="${i}" ${r.matchedEntry ? '' : 'checked'}><div class="cat-name">${esc(r.description)}<div class="pot-sub">${dayLabel(r.date)} · ${r.matchedEntry ? 'Eşleşti ✓' : 'Yeni'}</div></div><div class="num">${fmtTry(r.amount)}</div></label>`).join('')
      : `<div class="empty">Okunabilir satır yok.</div>`;
    $('#csv_actions').style.display = parsed.length ? 'flex' : 'none';
  });

  $('#csv_import_btn').addEventListener('click', () => {
    const pot = S.incomeTypes.find(t => t.id === $('#csv_pot').value);
    const sel = $$('#csv_preview .csv-chk:checked').map(c => parsed[Number(c.dataset.idx)]);
    if (!pot || sel.length === 0) return toast('Satır seç');
    runAtomic($('#csv_import_btn'), draft => {
      const nowIso = new Date().toISOString();
      for (const r of sel) {
        if (r.kind === 'gelir') draft.income_entries.push({ id: newId('inc'), typeId: pot.id, typeName: pot.name, personId: pot.personId, personName: personName(S, pot.personId), amount: r.amount, date: r.date, note: `[Ekstre] ${r.description}`, createdAt: nowIso });
        else draft.expense_entries.push({ id: newId('exp'), categoryId: defaultCat.id, categoryName: defaultCat.name, paidFromTypeId: pot.id, paidFromTypeName: pot.name, personId: pot.personId, personName: personName(S, pot.personId), amount: r.amount, date: r.date, note: `[Ekstre] ${r.description}`, createdAt: nowIso });
      }
    }, 'Ekstre aktarımı', () => {
      closeSheet();
      renderView(S.view);
      toast(`${sel.length} hareket aktarıldı`);
    });
  });
}

// ---------- AYARLAR & MENÜ SHEET'İ ----------
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function openSettingsSheet() {
  const ghCfg = getGithubConfig();
  const hasPin = Boolean(localStorage.getItem(PIN_HASH_KEY));
  const curTheme = localStorage.getItem(THEME_KEY) || 'auto';

  const entityRow = (col, item) =>
    `<div class="cat-row"><div class="cat-name${item.archived ? ' archived' : ''}">${esc(item.name)}</div>` +
    `<button type="button" class="chip" data-act="arch" data-col="${col}" data-id="${item.id}" style="min-height:30px;padding:4px 9px;font-size:11px;">${item.archived ? 'Çıkar' : 'Arşiv'}</button>` +
    `<button type="button" class="chip" data-act="del" data-col="${col}" data-id="${item.id}" style="min-height:30px;padding:4px 9px;font-size:11px;color:var(--expense);">Sil</button></div>`;

  openSheet(
    `<div class="sheet-title">Atelier Ayarlar</div>` +
      `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 14px;">` +
      `<button type="button" class="btn-ghost" id="st_sync_btn" style="flex:1;min-height:40px;font-size:13px;">↻ Şimdi Eşitle</button>` +
      `<button type="button" class="btn-ghost" id="st_theme_btn" style="flex:1;min-height:40px;font-size:13px;">Tema: ${curTheme === 'auto' ? 'Sistem' : curTheme === 'dark' ? 'Koyu' : 'Açık'}</button>` +
      `</div>` +
      `<div class="field"><label>Kişiler</label></div>` +
      `<div class="surface-card" style="padding:6px 12px;">${S.people.map(p => entityRow('people', p)).join('')}<div class="add-row"><input type="text" id="st_new_p" placeholder="Yeni kişi"><button type="button" id="st_add_p">Ekle</button></div></div>` +
      `<div class="field"><label>Gider Kategorileri</label></div>` +
      `<div class="surface-card" style="padding:6px 12px;">${S.expenseCategories.map(c => entityRow('expense_categories', c)).join('')}<div class="add-row"><input type="text" id="st_new_c" placeholder="Yeni kategori"><button type="button" id="st_add_c">Ekle</button></div></div>` +
      `<div class="field"><label>USD/TRY Kuru & PIN Kilidi</label></div>` +
      `<div class="surface-card">` +
      `<div style="display:flex;gap:8px;"><input type="text" inputmode="decimal" id="st_usd" value="${S.usdTry}" class="num-input" style="flex:1;min-height:40px;border-radius:10px;border:1px solid var(--hairline);background:var(--bg);color:var(--ink);padding:6px 10px;"><button type="button" class="btn-ghost" id="st_save_usd" style="min-height:40px;">Kur Kaydet</button></div>` +
      `<div style="display:flex;gap:8px;margin-top:8px;"><input type="password" inputmode="numeric" maxlength="4" id="st_pin" placeholder="${hasPin ? 'Yeni PIN' : '4 haneli PIN'}" style="flex:1;min-height:40px;border-radius:10px;border:1px solid var(--hairline);background:var(--bg);color:var(--ink);padding:6px 10px;"><button type="button" class="btn-ghost" id="st_save_pin" style="min-height:40px;">PIN</button>${hasPin ? '<button type="button" class="btn-danger" id="st_clear_pin" style="min-height:40px;">Kaldır</button>' : ''}</div>` +
      `</div>` +
      `<div class="field"><label>Yedekleme (JSON)</label></div>` +
      `<div style="display:flex;gap:8px;"><button type="button" class="btn-ghost" id="st_exp_json" style="flex:1;">Yedek İndir</button><label class="btn-ghost" style="flex:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;">Geri Yükle<input type="file" id="st_imp_json" accept=".json" style="display:none;"></label></div>` +
      `<div class="field"><label>GitHub Senkronizasyonu</label></div>` +
      `<div class="surface-card">` +
      (ghCfg
        ? `<div class="field-hint" style="margin-bottom:8px;">Bağlı: <strong>${esc(ghCfg.owner)}/${esc(ghCfg.repo)}</strong></div><button type="button" class="btn-danger" id="gh_disc" style="width:100%;">Bağlantıyı Kaldır</button>`
        : `<input type="text" id="gh_repo" placeholder="kullanici/repo" style="width:100%;min-height:40px;border-radius:10px;border:1px solid var(--hairline);background:var(--bg);color:var(--ink);padding:6px 10px;margin-bottom:8px;">` +
          `<input type="password" id="gh_token" placeholder="Fine-Grained PAT" style="width:100%;min-height:40px;border-radius:10px;border:1px solid var(--hairline);background:var(--bg);color:var(--ink);padding:6px 10px;">` +
          `<button type="button" class="btn-primary" id="gh_conn">Bağlan</button>`) +
      `</div>` +
      `<div style="display:flex;gap:10px;justify-content:center;margin-top:16px;font-size:12px;">` +
      `<a href="../yedek/" style="color:var(--ink-faint);">Eski Sürüm Yedeği ↗</a>` +
      `<a href="../" style="color:var(--ink-faint);">Diğer Sürüm ↗</a>` +
      `</div>`,
    { trackDirty: false }
  );

  $('#st_sync_btn').addEventListener('click', triggerManualSync);
  $('#st_theme_btn').addEventListener('click', () => {
    cycleTheme();
    openSettingsSheet();
  });

  $$('#sheetContent [data-act="arch"]').forEach(btn =>
    btn.addEventListener('click', () => {
      const { col, id } = btn.dataset;
      runAtomic(btn, draft => {
        const it = draft[col].find(x => x.id === id);
        if (it) it.archived = !it.archived;
      }, 'Arşiv', () => {
        openSettingsSheet();
        renderView(S.view);
      });
    })
  );
  $$('#sheetContent [data-act="del"]').forEach(btn =>
    btn.addEventListener('click', () => {
      const { col, id } = btn.dataset;
      const check = canDeleteEntity(S, col, id);
      if (!check.allowed) return toast(check.reason);
      runAtomic(btn, draft => {
        draft[col] = draft[col].filter(x => x.id !== id);
      }, 'Silindi', () => {
        openSettingsSheet();
        renderView(S.view);
      });
    })
  );

  $('#st_add_p').addEventListener('click', () => {
    const name = $('#st_new_p').value.trim();
    if (!name) return;
    runAtomic($('#st_add_p'), draft => {
      draft.people.push({ id: newId('p'), name, archived: false, createdAt: new Date().toISOString() });
    }, 'Kişi eklendi', () => {
      openSettingsSheet();
      renderView(S.view);
    });
  });

  $('#st_add_c').addEventListener('click', () => {
    const name = $('#st_new_c').value.trim();
    if (!name) return;
    runAtomic($('#st_add_c'), draft => {
      draft.expense_categories.push({ id: newId('ec'), name, archived: false, createdAt: new Date().toISOString() });
    }, 'Kategori eklendi', () => {
      openSettingsSheet();
      renderView(S.view);
    });
  });

  $('#st_save_usd').addEventListener('click', () => {
    const val = parseMoneyInput($('#st_usd').value);
    if (!(val > 0)) return toast('Geçerli kur gir');
    S.usdTry = val;
    try { localStorage.setItem(USD_RATE_KEY, String(val)); } catch {}
    renderView(S.view);
    toast('USD kuru kaydedildi');
  });

  $('#st_save_pin').addEventListener('click', async () => {
    const pin = $('#st_pin').value.trim();
    if (!/^\d{4}$/.test(pin)) return toast('4 haneli rakam gir');
    localStorage.setItem(PIN_HASH_KEY, await sha256Hex(pin));
    toast('PIN kilidi aktif');
    openSettingsSheet();
  });
  $('#st_clear_pin')?.addEventListener('click', () => {
    localStorage.removeItem(PIN_HASH_KEY);
    toast('PIN kaldırıldı');
    openSettingsSheet();
  });

  $('#st_exp_json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S.store.exportSnapshot(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kelo-finans-yedek-${todayStr()}.json`;
    a.click();
    toast('Yedek indirildi');
  });

  $('#st_imp_json').addEventListener('change', async ev => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      await S.store.replaceAll(JSON.parse(await f.text()));
      loadStateFromStore();
      closeSheet();
      renderView(S.view);
      toast('Yedek geri yüklendi');
    } catch {
      toast('Geçersiz JSON');
    }
  });

  $('#gh_disc')?.addEventListener('click', () => {
    clearGithubConfig();
    closeSheet();
    setTimeout(() => location.reload(), 400);
  });

  $('#gh_conn')?.addEventListener('click', async () => {
    const parts = $('#gh_repo').value.trim().split('/').map(s => s.trim()).filter(Boolean);
    const token = $('#gh_token').value.trim();
    if (parts.length !== 2 || !token) return toast('Repo ve token gir');
    const cfg = { owner: parts[0], repo: parts[1], token, path: 'data.json' };
    const res = await new GithubApi(cfg).testConnection();
    if (!res.ok) return toast(res.error);
    setGithubConfig(cfg);
    closeSheet();
    setTimeout(() => location.reload(), 400);
  });
}

// ---------- STATİK EVENT BAĞLANTILARI ----------
function bindStatic() {
  $$('.dock-tab').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
  $('#dockFabBtn').addEventListener('click', () => openQuickEntrySheet('gider'));
  $('#quickAddSideBtn').addEventListener('click', () => openQuickEntrySheet('gider'));

  $('#personSwitcherTop').addEventListener('click', openPersonSwitcherSheet);
  $('#personSwitcherSide').addEventListener('click', openPersonSwitcherSheet);
  $('#syncTapTop').addEventListener('click', triggerManualSync);
  $('#syncBtnSide').addEventListener('click', triggerManualSync);
  $('#privacyBtnTop').addEventListener('click', togglePrivacy);
  $('#privacyBtnSide').addEventListener('click', togglePrivacy);
  $('#themeBtnSide').addEventListener('click', cycleTheme);
  $('#settingsBtnTop').addEventListener('click', openSettingsSheet);
  $('#settingsBtnSide').addEventListener('click', openSettingsSheet);
  $('#currencyToggleBtn').addEventListener('click', toggleCurrency);

  $('#sheetOverlay').addEventListener('click', e => {
    if (e.target.id === 'sheetOverlay') requestCloseSheet();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#sheetOverlay')?.classList.contains('open')) requestCloseSheet();
  });

  // Kasa
  $('#kpiCashBtn').addEventListener('click', () => openDrilldownSheet('cash'));
  $('#kpiPortfolioBtn').addEventListener('click', () => openDrilldownSheet('portfolio'));
  $('#kpiMonthBtn').addEventListener('click', () => openDrilldownSheet('month'));
  $$('.ribbon-btn[data-qa]').forEach(b => b.addEventListener('click', () => openQuickEntrySheet(b.dataset.qa)));
  $('#qaBuyAssetBtn').addEventListener('click', openBuyAssetSelectorSheet);
  $('#addAccountBtn').addEventListener('click', () => openIncomeTypeSheet(null));
  $('#addDebtBtn').addEventListener('click', () => openDebtSheet(null));
  $('#goAllAkisBtn').addEventListener('click', () => setView('akis'));

  // Portföy
  $$('#portfoyFilterTabs button').forEach(b =>
    b.addEventListener('click', () => {
      S.portfoyTab = b.dataset.pf;
      renderPortfoy();
    })
  );
  $('#portfoyPricesBtn').addEventListener('click', openPricesSheet);
  $('#portfoyAddBtn').addEventListener('click', openBuyAssetSelectorSheet);

  // Akış
  $('#recordSearchInput').addEventListener('input', e => {
    S.recordSearch = e.target.value;
    renderAkis();
  });
  $$('#recordChips .chip').forEach(c =>
    c.addEventListener('click', () => {
      S.recordFilter = c.dataset.rf;
      renderAkis();
    })
  );
  $('#importCsvBtn').addEventListener('click', openCsvReconcileSheet);
  $('#exportCsvBtn').addEventListener('click', () => {
    const csv = buildTransactionsCsv(getFilteredRecords());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `kelo-finans-${todayStr()}.csv`;
    a.click();
    toast('CSV indirildi');
  });

  // İçgörü
  $$('#periodChips .chip').forEach(c =>
    c.addEventListener('click', () => {
      S.reportPeriod = c.dataset.period;
      renderIcgoru();
    })
  );
  $$('#scopeChips .chip').forEach(c =>
    c.addEventListener('click', () => {
      S.reportScope = c.dataset.scope;
      renderIcgoru();
    })
  );
  $('#monthlyClosePicker').addEventListener('change', e => {
    if (e.target.value) {
      S.monthlyCloseYm = e.target.value;
      renderIcgoru();
    }
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
      if ((await sha256Hex($('#pinUnlockInput').value.trim())) === savedHash) {
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
  renderAllChrome();
  bindStatic();
  setView('kasa');

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
