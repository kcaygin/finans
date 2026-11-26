// Kelo-Finans — Gemini Edition
// Saf, yan etkisiz finansal hesaplama ve mutabakat motoru (Tarayıcı + Node.js testleri ile tam uyumlu).

export const DEFAULT_FUND_STOPAJ = 0.175;
export const SPREAD_WARNING_THRESHOLD = 0.05; // %5 üzeri alış/satış makası uyarısı

// Sarrafiye altınların gram has altın eşdeğerleri (22 ayar gram bazlı tahmini değerleme için opsiyonel katsayılar)
export const COIN_GRAM_MULTIPLIERS = {
  'çeyrek altın': 1.6065,
  'ceyrek altin': 1.6065,
  'yarım altın': 3.213,
  'yarim altin': 3.213,
  'tam altın': 6.426,
  'tam altin': 6.426,
  'cumhuriyet altını': 6.615,
  'cumhuriyet altini': 6.615,
  'ata altın': 6.615,
  'ata altin': 6.615
};

export function round2(n) {
  const v = Number(n) || 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function round4(n) {
  const v = Number(n) || 0;
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

/**
 * Türkçe ve uluslararası sayı girişlerini güvenli biçimde çözümler.
 * Örn: "125,50" -> 125.5, "12.345,67" -> 12345.67, "12,345.67" -> 12345.67
 */
export function parseMoneyInput(val) {
  if (typeof val === 'number') return Number.isFinite(val) ? val : NaN;
  if (val == null) return NaN;
  let s = String(val).trim().replace(/\s+/g, '').replace(/₺|TL|\$/gi, '');
  if (!s) return NaN;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Son görülen ayraç ondalık ayraçtır
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Tek virgül varsa ondalık; birden fazla virgül varsa binlik ayracı kabul et
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length !== 3) {
      s = parts[0] + '.' + parts[1];
    } else if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      // "1,250" belirsizliği: TR kullanımında genelde 1.250 veya ondalık olabilir; 3 haneli ondalık (fon adedi) olabilir
      s = parts[0] + '.' + parts[1];
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2) {
      s = s.replace(/\./g, '');
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function normKey(str) {
  return String(str || '').trim().toLocaleLowerCase('tr-TR');
}

export function materialPriceKey(material, bank) {
  return normKey(material) + '||' + normKey(bank);
}

export function fundKey(name) {
  return normKey(name);
}

export function todayStr(now = new Date()) {
  const pad = x => String(x).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function periodRange(period, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = x => String(x).padStart(2, '0');
  const ymd = (yy, mm, dd) => `${yy}-${pad(mm + 1)}-${pad(dd)}`;
  if (period === 'thisMonth') {
    const last = new Date(y, m + 1, 0).getDate();
    return [ymd(y, m, 1), ymd(y, m, last)];
  }
  if (period === 'lastMonth') {
    const pm = m === 0 ? 11 : m - 1;
    const py = m === 0 ? y - 1 : y;
    const last = new Date(py, pm + 1, 0).getDate();
    return [ymd(py, pm, 1), ymd(py, pm, last)];
  }
  if (period === 'thisYear') {
    return [`${y}-01-01`, `${y}-12-31`];
  }
  return [null, null];
}

export function inRange(dateStr, range) {
  if (!range || !range[0]) return true;
  if (!dateStr) return false;
  return dateStr >= range[0] && dateStr <= range[1];
}

export function personName(state, id) {
  const p = (state.people || []).find(x => x.id === id);
  return p ? p.name : '—';
}

export function getGroupPriceRow(state, material, bank) {
  const key = materialPriceKey(material, bank);
  return (state.materialPrices || []).find(p => materialPriceKey(p.material, p.bank) === key) || null;
}

export function getGroupPrice(state, material, bank) {
  const row = getGroupPriceRow(state, material, bank);
  return row && Number(row.price) > 0 ? Number(row.price) : null;
}

export function getGroupPriceDelta(state, material, bank) {
  const row = getGroupPriceRow(state, material, bank);
  if (!row || row.previousPrice == null) return null;
  const prev = Number(row.previousPrice);
  const cur = Number(row.price);
  if (!(prev > 0)) return null;
  const diff = cur - prev;
  return { prev, cur, diff, pct: (diff / prev) * 100, at: row.previousPriceAt || null };
}

export function getFundPriceRow(state, fundName) {
  const key = fundKey(fundName);
  return (state.fundPrices || []).find(p => fundKey(p.fundName) === key) || null;
}

export function getFundPrice(state, fundName) {
  const row = getFundPriceRow(state, fundName);
  return row && Number(row.price) > 0 ? Number(row.price) : null;
}

export function getFundPriceDelta(state, fundName) {
  const row = getFundPriceRow(state, fundName);
  if (!row || row.previousPrice == null) return null;
  const prev = Number(row.previousPrice);
  const cur = Number(row.price);
  if (!(prev > 0)) return null;
  const diff = cur - prev;
  return { prev, cur, diff, pct: (diff / prev) * 100, at: row.previousPriceAt || null };
}

export function getFundStopajRate(state, fundName) {
  const key = fundKey(fundName);
  const cfg = (state.fundConfigs || []).find(c => fundKey(c.fundName) === key);
  if (cfg && cfg.stopajRate != null && Number.isFinite(Number(cfg.stopajRate))) {
    return Number(cfg.stopajRate);
  }
  return DEFAULT_FUND_STOPAJ;
}

/**
 * Gelir kaynağı (kumbara) bakiyelerini gelirler, giderler ve nakit↔yatırım transferleriyle birlikte hesaplar.
 */
export function computePotBalance(state, typeId) {
  const income = (state.incomeEntries || [])
    .filter(e => e.typeId === typeId)
    .reduce((a, e) => a + Number(e.amount || 0), 0);
  const spent = (state.expenseEntries || [])
    .filter(e => e.paidFromTypeId === typeId)
    .reduce((a, e) => a + Number(e.amount || 0), 0);
  const transfersOut = (state.transfers || [])
    .filter(t => t.fromTypeId === typeId)
    .reduce((a, t) => a + Number(t.amount || 0), 0);
  const transfersIn = (state.transfers || [])
    .filter(t => t.toTypeId === typeId)
    .reduce((a, t) => a + Number(t.amount || 0), 0);

  return {
    income: round2(income),
    spent: round2(spent),
    transfersOut: round2(transfersOut),
    transfersIn: round2(transfersIn),
    balance: round2(income - spent - transfersOut + transfersIn)
  };
}

/**
 * Kişi filtresine göre toplam nakit bakiyesi.
 * Arşivli gelir kaynaklarını da dahil ederek kayıp/tutarsızlık oluşmasını engeller.
 */
export function computeCashTotals(state, personFilter = 'all') {
  let types = state.incomeTypes || [];
  if (personFilter && personFilter !== 'all') {
    types = types.filter(t => t.personId === personFilter);
  }
  const ids = new Set(types.map(t => t.id));
  const income = (state.incomeEntries || [])
    .filter(e => ids.has(e.typeId))
    .reduce((a, e) => a + Number(e.amount || 0), 0);
  const expense = (state.expenseEntries || [])
    .filter(e => ids.has(e.paidFromTypeId))
    .reduce((a, e) => a + Number(e.amount || 0), 0);
  const transfersOut = (state.transfers || [])
    .filter(t => t.fromTypeId && ids.has(t.fromTypeId))
    .reduce((a, t) => a + Number(t.amount || 0), 0);
  const transfersIn = (state.transfers || [])
    .filter(t => t.toTypeId && ids.has(t.toTypeId))
    .reduce((a, t) => a + Number(t.amount || 0), 0);

  return {
    income: round2(income),
    expense: round2(expense),
    transfersOut: round2(transfersOut),
    transfersIn: round2(transfersIn),
    balance: round2(income - expense - transfersOut + transfersIn)
  };
}

function compareChrono(aDate, aCreated, aId, bDate, bCreated, bId) {
  const da = aDate || '';
  const db = bDate || '';
  if (da !== db) return da < db ? -1 : 1;
  const ca = aCreated || '';
  const cb = bCreated || '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  const ia = String(aId || '');
  const ib = String(bId || '');
  if (ia !== ib) return ia < ib ? -1 : 1;
  return 0;
}

/**
 * Olay-tabanlı (Event-Sourced) Kronolojik FIFO Fon Defteri.
 * Geçmiş bir alış fiyatı veya satış düzenlense bile tüm zinciri baştan tutarlı hesaplar.
 */
export function computeFundLedger(state) {
  const lots = (state.fundLots || []).map(l => ({
    raw: l,
    id: l.id,
    personId: l.personId,
    incomeTypeId: l.incomeTypeId || null,
    fundName: l.fundName || '',
    quantity: Number(l.quantity || 0),
    purchasePrice: Number(l.purchasePrice || 0),
    purchaseDate: l.purchaseDate || '',
    createdAt: l.createdAt || '',
    stopajRate: l.stopajRate != null ? Number(l.stopajRate) : getFundStopajRate(state, l.fundName),
    remaining: Number(l.quantity || 0)
  }));

  lots.sort((a, b) => compareChrono(a.purchaseDate, a.createdAt, a.id, b.purchaseDate, b.createdAt, b.id));

  const sales = (state.fundSales || []).slice().sort((a, b) =>
    compareChrono(a.saleDate, a.createdAt, a.id, b.saleDate, b.createdAt, b.id)
  );

  const computedSales = [];
  for (const s of sales) {
    const qty = Number(s.quantity || 0);
    const salePrice = Number(s.salePrice || 0);
    const pool = lots.filter(
      l => l.personId === s.personId && fundKey(l.fundName) === fundKey(s.fundName) && l.remaining > 1e-9
    );

    let toSell = qty;
    let costBasis = 0;
    let estimatedStopaj = 0;
    const lotBreakdown = [];

    for (const lot of pool) {
      if (toSell <= 1e-9) break;
      const take = Math.min(lot.remaining, toSell);
      const lotCost = take * lot.purchasePrice;
      const lotProceeds = take * salePrice;
      const lotProfit = lotProceeds - lotCost;
      const rate = s.stopajRate != null ? Number(s.stopajRate) : lot.stopajRate;
      const lotStopaj = lotProfit > 0 ? lotProfit * rate : 0;

      costBasis += lotCost;
      estimatedStopaj += lotStopaj;
      lot.remaining = round4(lot.remaining - take);
      lotBreakdown.push({
        lotId: lot.id,
        qty: round4(take),
        purchasePrice: lot.purchasePrice,
        purchaseDate: lot.purchaseDate,
        stopajRate: rate
      });
      toSell -= take;
    }

    const proceeds = round2(qty * salePrice);
    costBasis = round2(costBasis);
    const grossProfit = round2(proceeds - costBasis);
    estimatedStopaj = round2(estimatedStopaj);
    const hasActualStopaj = s.actualStopaj != null && s.actualStopaj !== '' && Number.isFinite(Number(s.actualStopaj));
    const stopaj = hasActualStopaj ? round2(Number(s.actualStopaj)) : estimatedStopaj;
    const netProfit = round2(grossProfit - stopaj);
    const netProceeds = round2(proceeds - stopaj);

    computedSales.push({
      ...s,
      quantity: round4(qty),
      salePrice,
      costBasis,
      proceeds,
      grossProfit,
      estimatedStopaj,
      stopaj,
      hasActualStopaj,
      netProfit,
      netProceeds,
      lotBreakdown,
      shortfall: toSell > 1e-6 ? round4(toSell) : 0
    });
  }

  const lotById = new Map();
  const computedLots = lots.map(l => {
    const curPrice = getFundPrice(state, l.fundName);
    const hasPrice = curPrice != null;
    const cost = round2(l.remaining * l.purchasePrice);
    const grossValue = hasPrice ? round2(l.remaining * curPrice) : cost;
    const unrealizedGrossProfit = round2(grossValue - cost);
    const estStopaj = unrealizedGrossProfit > 0 ? round2(unrealizedGrossProfit * l.stopajRate) : 0;
    const netLiquidationValue = round2(grossValue - estStopaj);
    const priceDelta = getFundPriceDelta(state, l.fundName);
    const valueDelta = priceDelta ? round2(priceDelta.diff * l.remaining) : 0;

    const item = {
      ...l.raw,
      remaining: l.remaining,
      soldQuantity: round4(l.quantity - l.remaining),
      stopajRate: l.stopajRate,
      cost,
      value: grossValue,
      grossValue,
      netLiquidationValue,
      estimatedStopaj: estStopaj,
      profit: unrealizedGrossProfit,
      netUnrealizedProfit: round2(unrealizedGrossProfit - estStopaj),
      pct: cost > 0 ? (unrealizedGrossProfit / cost) * 100 : 0,
      curPrice,
      hasPrice,
      priceStatus: hasPrice ? 'live' : 'cost_fallback',
      priceDelta,
      valueDelta
    };
    lotById.set(l.id, item);
    return item;
  });

  return { lots: computedLots, sales: computedSales, lotById };
}

/**
 * FIFO Fon Satış Simülasyonu (kaydetmeden önce canlı önizleme için).
 */
export function previewFundSale(state, personId, fundName, sellQty, salePrice, customStopajRate = null) {
  const qty = Number(sellQty);
  const price = Number(salePrice);
  const ledger = computeFundLedger(state);
  const pool = ledger.lots
    .filter(l => l.personId === personId && fundKey(l.fundName) === fundKey(fundName) && l.remaining > 1e-9)
    .sort((a, b) => compareChrono(a.purchaseDate, a.createdAt, a.id, b.purchaseDate, b.createdAt, b.id));

  const available = round4(pool.reduce((s, l) => s + l.remaining, 0));
  if (!(qty > 0)) return { ok: false, reason: 'invalid_qty', available };
  if (qty > available + 1e-9) return { ok: false, reason: 'insufficient_units', available };

  let toSell = qty;
  let costBasis = 0;
  let stopaj = 0;
  const lotBreakdown = [];

  for (const lot of pool) {
    if (toSell <= 1e-9) break;
    const take = Math.min(lot.remaining, toSell);
    const lotCost = take * Number(lot.purchasePrice || 0);
    const lotProfit = take * price - lotCost;
    const rate = customStopajRate != null ? Number(customStopajRate) : lot.stopajRate;
    costBasis += lotCost;
    if (lotProfit > 0) stopaj += lotProfit * rate;
    lotBreakdown.push({ lotId: lot.id, qty: round4(take), purchasePrice: Number(lot.purchasePrice || 0), purchaseDate: lot.purchaseDate });
    toSell -= take;
  }

  const proceeds = round2(qty * price);
  costBasis = round2(costBasis);
  const grossProfit = round2(proceeds - costBasis);
  stopaj = round2(stopaj);
  const netProfit = round2(grossProfit - stopaj);
  const netProceeds = round2(proceeds - stopaj);

  return {
    ok: true,
    available,
    remainingAfter: round4(available - qty),
    costBasis,
    proceeds,
    grossProfit,
    stopaj,
    netProfit,
    netProceeds,
    lotBreakdown
  };
}

/**
 * Olay-tabanlı Kronolojik FIFO Kıymetli Maden Defteri.
 * Hem alışları (sıfır maliyet dahil) hem de varsa kıymetli maden satışlarını tutarlı işler.
 */
export function computeMetalLedger(state) {
  const holdings = (state.savingsHoldings || []).map(h => ({
    raw: h,
    id: h.id,
    personId: h.personId,
    incomeTypeId: h.incomeTypeId || null,
    material: h.material || '',
    bank: h.bank || '',
    unit: h.unit || 'gram',
    quantity: Number(h.quantity || 0),
    purchasePrice: Number(h.purchasePrice || 0),
    purchaseDate: h.purchaseDate || h.createdAt?.slice(0, 10) || '',
    createdAt: h.createdAt || '',
    remaining: Number(h.quantity || 0)
  }));

  holdings.sort((a, b) => compareChrono(a.purchaseDate, a.createdAt, a.id, b.purchaseDate, b.createdAt, b.id));

  const sales = (state.metalSales || []).slice().sort((a, b) =>
    compareChrono(a.saleDate, a.createdAt, a.id, b.saleDate, b.createdAt, b.id)
  );

  const computedSales = [];
  for (const s of sales) {
    const qty = Number(s.quantity || 0);
    const salePrice = Number(s.salePrice || 0);
    const targetKey = materialPriceKey(s.material, s.bank);
    const pool = holdings.filter(
      h => h.personId === s.personId && materialPriceKey(h.material, h.bank) === targetKey && h.remaining > 1e-9
    );

    let toSell = qty;
    let costBasis = 0;
    const lotBreakdown = [];

    for (const h of pool) {
      if (toSell <= 1e-9) break;
      const take = Math.min(h.remaining, toSell);
      costBasis += take * h.purchasePrice;
      h.remaining = round4(h.remaining - take);
      lotBreakdown.push({ holdingId: h.id, qty: round4(take), purchasePrice: h.purchasePrice, purchaseDate: h.purchaseDate });
      toSell -= take;
    }

    const proceeds = round2(qty * salePrice);
    costBasis = round2(costBasis);
    const netProfit = round2(proceeds - costBasis);

    computedSales.push({
      ...s,
      quantity: round4(qty),
      salePrice,
      costBasis,
      proceeds,
      netProfit,
      lotBreakdown,
      shortfall: toSell > 1e-6 ? round4(toSell) : 0
    });
  }

  const holdingById = new Map();
  const computedHoldings = holdings.map(h => {
    const groupRow = getGroupPriceRow(state, h.material, h.bank);
    const groupPrice = groupRow && Number(groupRow.price) > 0 ? Number(groupRow.price) : null;
    const fallbackPrice = Number(h.raw.currentPrice || 0);
    const effectivePrice = groupPrice != null ? groupPrice : fallbackPrice > 0 ? fallbackPrice : h.purchasePrice;
    const priceStatus = groupPrice != null ? 'live_group' : fallbackPrice > 0 ? 'holding_fallback' : 'cost_fallback';

    const cost = round2(h.remaining * h.purchasePrice);
    const value = round2(h.remaining * effectivePrice);
    const profit = round2(value - cost);
    const pct = cost > 0 ? (profit / cost) * 100 : value > 0 && cost === 0 ? 100 : 0;
    const priceDelta = getGroupPriceDelta(state, h.material, h.bank);
    const valueDelta = priceDelta ? round2(priceDelta.diff * h.remaining) : 0;

    const item = {
      ...h.raw,
      remaining: h.remaining,
      soldQuantity: round4(h.quantity - h.remaining),
      cost,
      value,
      profit,
      pct,
      effectivePrice,
      hasGroupPrice: groupPrice != null,
      priceStatus,
      priceUpdatedAt: groupRow?.updatedAt || groupRow?.previousPriceAt || null,
      priceDelta,
      valueDelta
    };
    holdingById.set(h.id, item);
    return item;
  });

  return { holdings: computedHoldings, sales: computedSales, holdingById };
}

export function previewMetalSale(state, personId, material, bank, sellQty, salePrice) {
  const qty = Number(sellQty);
  const price = Number(salePrice);
  const ledger = computeMetalLedger(state);
  const key = materialPriceKey(material, bank);
  const pool = ledger.holdings
    .filter(h => h.personId === personId && materialPriceKey(h.material, h.bank) === key && h.remaining > 1e-9)
    .sort((a, b) => compareChrono(a.purchaseDate, a.createdAt, a.id, b.purchaseDate, b.createdAt, b.id));

  const available = round4(pool.reduce((s, h) => s + h.remaining, 0));
  if (!(qty > 0)) return { ok: false, reason: 'invalid_qty', available };
  if (qty > available + 1e-9) return { ok: false, reason: 'insufficient_units', available };

  let toSell = qty;
  let costBasis = 0;
  for (const h of pool) {
    if (toSell <= 1e-9) break;
    const take = Math.min(h.remaining, toSell);
    costBasis += take * Number(h.purchasePrice || 0);
    toSell -= take;
  }

  const proceeds = round2(qty * price);
  costBasis = round2(costBasis);
  return {
    ok: true,
    available,
    remainingAfter: round4(available - qty),
    costBasis,
    proceeds,
    netProfit: round2(proceeds - costBasis)
  };
}

/**
 * Banka fiyat verisindeki alış/satış makasını denetler (Circuit Breaker).
 * Mesai dışı %20+ açılan suni makasları otomatik yakalar.
 */
export function analyzeBankPrices(pricesJson, threshold = SPREAD_WARNING_THRESHOLD) {
  if (!pricesJson || typeof pricesJson !== 'object') return null;

  const inspectBank = (label, key, obj) => {
    if (!obj || typeof obj !== 'object') return null;
    const altinAlis = Number(obj.altinAlis);
    const altinSatis = Number(obj.altinSatis);
    const gumusAlis = Number(obj.gumusAlis);
    const gumusSatis = Number(obj.gumusSatis);

    const goldSpread = altinAlis > 0 && altinSatis > 0 ? (altinSatis - altinAlis) / altinAlis : null;
    const silverSpread = gumusAlis > 0 && gumusSatis > 0 ? (gumusSatis - gumusAlis) / gumusAlis : null;
    const maxSpread = Math.max(goldSpread || 0, silverSpread || 0);
    const spreadWarning = (goldSpread != null && goldSpread > threshold) || (silverSpread != null && silverSpread > threshold);

    return {
      key,
      label,
      altinAlis: Number.isFinite(altinAlis) ? altinAlis : null,
      altinSatis: Number.isFinite(altinSatis) ? altinSatis : null,
      gumusAlis: Number.isFinite(gumusAlis) ? gumusAlis : null,
      gumusSatis: Number.isFinite(gumusSatis) ? gumusSatis : null,
      goldSpreadPct: goldSpread != null ? round2(goldSpread * 100) : null,
      silverSpreadPct: silverSpread != null ? round2(silverSpread * 100) : null,
      maxSpreadPct: round2(maxSpread * 100),
      spreadWarning,
      stale: Boolean(obj.stale),
      updatedAt: obj.updatedAt || pricesJson.updatedAt || null
    };
  };

  return {
    updatedAt: pricesJson.updatedAt || null,
    dunyaKatilim: inspectBank('Dünya Katılım', 'dunyaKatilim', pricesJson.dunyaKatilim),
    ziraatKatilim: inspectBank('Ziraat Katılım', 'ziraatKatilim', pricesJson.ziraatKatilim)
  };
}

/**
 * prices.json'dan varlık fiyat gruplarına akıllı eşleştirme yapar.
 * Anormal makaslı (>%5) bankaları varsayılan olarak atlar ve kullanıcıya açık uyarı üretir.
 */
export function matchFetchedPrices(groups, pricesJson, opts = {}) {
  const { allowWideSpread = false, includeCoins = false } = opts;
  const analysis = analyzeBankPrices(pricesJson);
  if (!analysis) return { matches: [], skippedWarnings: [], analysis: null };

  const matches = [];
  const skippedWarnings = [];

  for (const g of groups) {
    const bank = normKey(g.bank);
    const material = normKey(g.material);
    const coinMult = COIN_GRAM_MULTIPLIERS[material] || null;
    const isCoin = Boolean(coinMult) || /çeyrek|ceyrek|yarım|yarim|tam altın|tam altin|cumhuriyet|ata altın|ata altin/.test(material);

    if (isCoin && !(includeCoins && coinMult)) continue;

    const isGold = /altın|altin/.test(material) || Boolean(coinMult);
    const isSilver = /gümüş|gumus/.test(material);
    if (!isGold && !isSilver) continue;

    const isFiziki = /fiziki/.test(material);
    let src = null;
    if (isFiziki || isCoin) {
      src = analysis.dunyaKatilim;
    } else if (/dünya|dunya/.test(bank)) {
      src = analysis.dunyaKatilim;
    } else if (/ziraat/.test(bank)) {
      src = analysis.ziraatKatilim;
    }

    if (!src) continue;
    if (src.spreadWarning && !allowWideSpread) {
      skippedWarnings.push({
        material: g.material,
        bank: g.bank,
        sourceLabel: src.label,
        spreadPct: isGold ? src.goldSpreadPct : src.silverSpreadPct
      });
      continue;
    }

    const baseVal = isGold ? src.altinAlis : src.gumusAlis;
    if (!(baseVal > 0)) continue;

    const price = coinMult ? round2(baseVal * coinMult) : round2(baseVal);
    matches.push({
      material: g.material,
      bank: g.bank,
      price,
      sourceLabel: src.label,
      isCoinEstimate: Boolean(coinMult),
      spreadWarning: src.spreadWarning,
      updatedAt: src.updatedAt
    });
  }

  return { matches, skippedWarnings, analysis };
}

export function incomeTypeInvestmentStats(state, typeId, fundLedger, metalLedger) {
  const fl = fundLedger || computeFundLedger(state);
  const ml = metalLedger || computeMetalLedger(state);
  let cost = 0;
  let value = 0;

  for (const h of ml.holdings) {
    if (h.incomeTypeId !== typeId || h.remaining <= 1e-9) continue;
    cost += h.cost;
    value += h.value;
  }
  for (const l of fl.lots) {
    if (l.incomeTypeId !== typeId || l.remaining <= 1e-9) continue;
    cost += l.cost;
    value += l.value;
  }

  cost = round2(cost);
  value = round2(value);
  return { cost, value, profit: round2(value - cost), hasInvestment: cost > 0 || value > 0 };
}

export function computeOverview(state, personFilter = 'all') {
  const cashTotals = computeCashTotals(state, personFilter);
  const cash = cashTotals.balance;
  const fundLedger = computeFundLedger(state);
  const metalLedger = computeMetalLedger(state);

  let fundCost = 0;
  let fundValue = 0;
  let fundNetLiquidationValue = 0;
  let fundRealizedProfit = 0;
  let missingFundPrices = 0;

  for (const l of fundLedger.lots) {
    if (personFilter !== 'all' && l.personId !== personFilter) continue;
    if (l.remaining <= 1e-9) continue;
    fundCost += l.cost;
    fundValue += l.value;
    fundNetLiquidationValue += l.netLiquidationValue;
    if (!l.hasPrice) missingFundPrices++;
  }
  for (const s of fundLedger.sales) {
    if (personFilter !== 'all' && s.personId !== personFilter) continue;
    fundRealizedProfit += s.netProfit;
  }

  let metalCost = 0;
  let metalValue = 0;
  let metalRealizedProfit = 0;
  let missingMetalPrices = 0;

  for (const h of metalLedger.holdings) {
    if (personFilter !== 'all' && h.personId !== personFilter) continue;
    if (h.remaining <= 1e-9) continue;
    metalCost += h.cost;
    metalValue += h.value;
    if (h.priceStatus === 'cost_fallback') missingMetalPrices++;
  }
  for (const s of metalLedger.sales) {
    if (personFilter !== 'all' && s.personId !== personFilter) continue;
    metalRealizedProfit += s.netProfit;
  }

  let totalDebts = 0;
  for (const d of state.debts || []) {
    if (d.archived) continue;
    if (personFilter !== 'all' && d.personId !== personFilter) continue;
    totalDebts += Number(d.amount || 0);
  }

  fundCost = round2(fundCost);
  fundValue = round2(fundValue);
  fundNetLiquidationValue = round2(fundNetLiquidationValue);
  fundRealizedProfit = round2(fundRealizedProfit);
  metalCost = round2(metalCost);
  metalValue = round2(metalValue);
  metalRealizedProfit = round2(metalRealizedProfit);
  totalDebts = round2(totalDebts);

  const fundProfit = round2(fundValue - fundCost);
  const metalProfit = round2(metalValue - metalCost);
  const investValue = round2(fundValue + metalValue);
  const investNetLiquidation = round2(fundNetLiquidationValue + metalValue);
  const investCost = round2(fundCost + metalCost);
  const investProfit = round2(fundProfit + metalProfit);
  const realizedProfit = round2(fundRealizedProfit + metalRealizedProfit);
  const grossTotal = round2(cash + investValue);
  const netWorth = round2(grossTotal - totalDebts);
  const totalPrincipal = round2(cash + investCost);

  return {
    cash,
    fundCost,
    fundValue,
    fundNetLiquidationValue,
    fundProfit,
    fundRealizedProfit,
    metalCost,
    metalValue,
    metalProfit,
    metalRealizedProfit,
    investValue,
    investNetLiquidation,
    investCost,
    investProfit,
    realizedProfit,
    totalDebts,
    grossTotal,
    grandTotal: grossTotal,
    netWorth,
    totalPrincipal,
    missingFundPrices,
    missingMetalPrices,
    fundLedger,
    metalLedger
  };
}

/**
 * Toplam Ana Para'nın kaynaklara göre kırılımı — arşivli ama bakiyesi olan kaynakları da dahil eder
 * böylece alt satırların toplamı her zaman Toplam Ana Para'ya eşit olur.
 */
export function principalBySource(state, personFilter = 'all', overview = null) {
  const ov = overview || computeOverview(state, personFilter);
  let types = state.incomeTypes || [];
  if (personFilter !== 'all') types = types.filter(t => t.personId === personFilter);

  const activeIds = new Set();
  const rows = [];
  let archivedCashSum = 0;

  for (const t of types) {
    const pot = computePotBalance(state, t.id);
    const inv = incomeTypeInvestmentStats(state, t.id, ov.fundLedger, ov.metalLedger);
    if (t.archived) {
      archivedCashSum += pot.balance;
      if (Math.abs(inv.cost) > 0.005) {
        rows.push({
          name: `${t.name} (Arşiv) · ${personName(state, t.personId)}`,
          amount: round2(pot.balance + inv.cost),
          profit: inv.profit,
          hasInvestment: inv.hasInvestment
        });
      }
      continue;
    }
    activeIds.add(t.id);
    const amt = round2(pot.balance + inv.cost);
    if (Math.abs(amt) > 0.005 || Math.abs(inv.profit) > 0.005) {
      rows.push({
        name: `${t.name} · ${personName(state, t.personId)}`,
        amount: amt,
        profit: inv.profit,
        hasInvestment: inv.hasInvestment
      });
    }
  }

  if (Math.abs(archivedCashSum) > 0.005) {
    rows.push({
      name: 'Arşivlenmiş Kaynaklar (Nakit)',
      amount: round2(archivedCashSum),
      profit: 0,
      hasInvestment: false
    });
  }

  // Kaynağı belirtilmemiş veya arşiv/silinmiş kaynağa bağlı kalan yatırımlar
  let unCost = 0;
  let unVal = 0;
  for (const h of ov.metalLedger.holdings) {
    if (personFilter !== 'all' && h.personId !== personFilter) continue;
    if (h.remaining <= 1e-9) continue;
    if (h.incomeTypeId && activeIds.has(h.incomeTypeId)) continue;
    unCost += h.cost;
    unVal += h.value;
  }
  for (const l of ov.fundLedger.lots) {
    if (personFilter !== 'all' && l.personId !== personFilter) continue;
    if (l.remaining <= 1e-9) continue;
    if (l.incomeTypeId && activeIds.has(l.incomeTypeId)) continue;
    unCost += l.cost;
    unVal += l.value;
  }
  unCost = round2(unCost);
  unVal = round2(unVal);
  if (Math.abs(unCost) > 0.005 || Math.abs(unVal) > 0.005) {
    rows.push({
      name: 'Kaynağı Belirtilmemiş / Açılış Yatırımları',
      amount: unCost,
      profit: round2(unVal - unCost),
      hasInvestment: true
    });
  }

  return rows.sort((a, b) => b.amount - a.amount);
}

/**
 * İşlem listesini ortak kişi kuralıyla döndürür:
 * - scope: 'spender' (entry.personId — kimin harcaması) veya 'account' (incomeType.personId — kimin hesabından)
 */
export function unifiedEntries(state, personFilter = 'all', scope = 'spender') {
  const typeOwnerMap = new Map((state.incomeTypes || []).map(t => [t.id, t.personId]));

  const matchPerson = (entryPersonId, accountTypeId) => {
    if (!personFilter || personFilter === 'all') return true;
    if (scope === 'account' && accountTypeId && typeOwnerMap.has(accountTypeId)) {
      return typeOwnerMap.get(accountTypeId) === personFilter;
    }
    return entryPersonId === personFilter;
  };

  const inc = (state.incomeEntries || [])
    .filter(e => matchPerson(e.personId, e.typeId))
    .map(e => ({
      id: e.id,
      kind: 'gelir',
      label: e.typeName || '—',
      sub: e.note || '',
      amount: Number(e.amount || 0),
      date: e.date,
      note: e.note || '',
      createdAt: e.createdAt || '',
      personId: e.personId,
      personName: personName(state, e.personId),
      raw: e
    }));

  const exp = (state.expenseEntries || [])
    .filter(e => matchPerson(e.personId, e.paidFromTypeId))
    .map(e => {
      const ownerId = typeOwnerMap.get(e.paidFromTypeId);
      const crossPerson = ownerId && ownerId !== e.personId ? ` (${personName(state, ownerId)} hesabı)` : '';
      return {
        id: e.id,
        kind: 'gider',
        label: e.categoryName || '—',
        sub: (e.paidFromTypeName ? `Kaynak: ${e.paidFromTypeName}${crossPerson}` : '') + (e.note ? ` · ${e.note}` : ''),
        amount: Number(e.amount || 0),
        date: e.date,
        note: e.note || '',
        createdAt: e.createdAt || '',
        personId: e.personId,
        personName: personName(state, e.personId),
        raw: e
      };
    });

  const trf = (state.transfers || [])
    .filter(t => matchPerson(t.personId, t.fromTypeId || t.toTypeId))
    .map(t => ({
      id: t.id,
      kind: 'transfer',
      label: t.label || (t.direction === 'to_cash' ? 'Yatırımdan Nakde' : t.direction === 'pot_to_pot' ? 'Hesaplar Arası Transfer' : 'Yatırıma Transfer'),
      sub: t.sub || t.note || '',
      amount: Number(t.amount || 0),
      date: t.date,
      note: t.note || '',
      createdAt: t.createdAt || '',
      personId: t.personId,
      personName: personName(state, t.personId),
      raw: t
    }));

  return inc.concat(exp, trf).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export function computeMonthlyTrend(state, personFilter = 'all', count = 6, now = new Date()) {
  const monthsTR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const pad = x => String(x).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

  const typeIds = new Set(
    (personFilter && personFilter !== 'all'
      ? (state.incomeTypes || []).filter(t => t.personId === personFilter)
      : state.incomeTypes || []
    ).map(t => t.id)
  );

  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    const range = [ymd(y, m, 1), ymd(y, m, lastDay)];

    const income = (state.incomeEntries || [])
      .filter(e => (personFilter === 'all' || typeIds.has(e.typeId)) && inRange(e.date, range))
      .reduce((a, e) => a + Number(e.amount || 0), 0);

    const expense = (state.expenseEntries || [])
      .filter(e => (personFilter === 'all' || typeIds.has(e.paidFromTypeId)) && inRange(e.date, range))
      .reduce((a, e) => a + Number(e.amount || 0), 0);

    const invested = (state.transfers || [])
      .filter(t => t.direction === 'to_investment' && (personFilter === 'all' || typeIds.has(t.fromTypeId)) && inRange(t.date, range))
      .reduce((a, t) => a + Number(t.amount || 0), 0);

    const label = monthsTR[m] + (y !== now.getFullYear() ? ` '${String(y).slice(2)}` : '');
    out.push({
      ym: `${y}-${pad(m + 1)}`,
      label,
      income: round2(income),
      expense: round2(expense),
      invested: round2(invested),
      net: round2(income - expense)
    });
  }
  return out;
}

/**
 * Aylık Kapanış: Ay başı nakit + ay içi gelirler - giderler ± transferler = ay sonu nakit.
 * Ayrıca ilgili ayda yatırılan yeni ana parayı ayırır.
 */
export function computeMonthlyClose(state, ym, personFilter = 'all') {
  const [y, m] = ym.split('-').map(Number);
  const pad = x => String(x).padStart(2, '0');
  const lastDay = new Date(y, m, 0).getDate();
  const startStr = `${y}-${pad(m)}-01`;
  const endStr = `${y}-${pad(m)}-${pad(lastDay)}`;

  const typeIds = new Set(
    (personFilter && personFilter !== 'all'
      ? (state.incomeTypes || []).filter(t => t.personId === personFilter)
      : state.incomeTypes || []
    ).map(t => t.id)
  );

  const matchIncome = e => personFilter === 'all' || typeIds.has(e.typeId);
  const matchExpense = e => personFilter === 'all' || typeIds.has(e.paidFromTypeId);

  let openingCash = 0;
  let monthIncome = 0;
  let monthExpense = 0;
  let monthTransferOut = 0;
  let monthTransferIn = 0;

  for (const e of state.incomeEntries || []) {
    if (!matchIncome(e)) continue;
    const amt = Number(e.amount || 0);
    if (e.date < startStr) openingCash += amt;
    else if (e.date <= endStr) monthIncome += amt;
  }
  for (const e of state.expenseEntries || []) {
    if (!matchExpense(e)) continue;
    const amt = Number(e.amount || 0);
    if (e.date < startStr) openingCash -= amt;
    else if (e.date <= endStr) monthExpense += amt;
  }
  for (const t of state.transfers || []) {
    const amt = Number(t.amount || 0);
    if (t.fromTypeId && (personFilter === 'all' || typeIds.has(t.fromTypeId))) {
      if (t.date < startStr) openingCash -= amt;
      else if (t.date <= endStr) monthTransferOut += amt;
    }
    if (t.toTypeId && (personFilter === 'all' || typeIds.has(t.toTypeId))) {
      if (t.date < startStr) openingCash += amt;
      else if (t.date <= endStr) monthTransferIn += amt;
    }
  }

  const closingCash = round2(openingCash + monthIncome - monthExpense - monthTransferOut + monthTransferIn);

  // Ay içinde portföye giren yeni nakit/ana para vs toplam unrealized kâr
  const newInvestmentCapital = (state.fundLots || [])
    .filter(l => (personFilter === 'all' || l.personId === personFilter) && l.purchaseDate >= startStr && l.purchaseDate <= endStr)
    .reduce((a, l) => a + Number(l.quantity || 0) * Number(l.purchasePrice || 0), 0)
    + (state.savingsHoldings || [])
    .filter(h => (personFilter === 'all' || h.personId === personFilter) && (h.purchaseDate || '') >= startStr && (h.purchaseDate || '') <= endStr)
    .reduce((a, h) => a + Number(h.quantity || 0) * Number(h.purchasePrice || 0), 0);

  return {
    ym,
    openingCash: round2(openingCash),
    monthIncome: round2(monthIncome),
    monthExpense: round2(monthExpense),
    monthTransferOut: round2(monthTransferOut),
    monthTransferIn: round2(monthTransferIn),
    closingCash,
    newInvestmentCapital: round2(newInvestmentCapital)
  };
}

/**
 * Bankaya göre kıymetli maden dağılımı — büyük/küçük harf duyarsız normalizasyon ile.
 */
export function groupHoldingsByBank(state, personFilter = 'all', metalLedger = null) {
  const ml = metalLedger || computeMetalLedger(state);
  const byBank = new Map();

  for (const h of ml.holdings) {
    if (personFilter !== 'all' && h.personId !== personFilter) continue;
    if (h.remaining <= 1e-9) continue;
    const rawName = (h.bank || '').trim() || 'Banka belirtilmemiş';
    const key = normKey(rawName);
    if (!byBank.has(key)) {
      byBank.set(key, { key, name: rawName, count: 0, total: 0, cost: 0, holdings: [] });
    }
    const bucket = byBank.get(key);
    bucket.count += 1;
    bucket.total = round2(bucket.total + h.value);
    bucket.cost = round2(bucket.cost + h.cost);
    bucket.holdings.push(h);
  }

  return Array.from(byBank.values()).sort((a, b) => b.total - a.total);
}

/**
 * Referans Bütünlüğü Denetimi: Bir kişi, gelir kaynağı veya gider kategorisi silinmeden önce
 * ona bağlı kayıt olup olmadığını kontrol eder.
 */
export function canDeleteEntity(state, collection, id) {
  let count = 0;
  if (collection === 'people') {
    count += (state.incomeTypes || []).filter(x => x.personId === id).length;
    count += (state.incomeEntries || []).filter(x => x.personId === id).length;
    count += (state.expenseEntries || []).filter(x => x.personId === id).length;
    count += (state.savingsHoldings || []).filter(x => x.personId === id).length;
    count += (state.fundLots || []).filter(x => x.personId === id).length;
    count += (state.fundSales || []).filter(x => x.personId === id).length;
    count += (state.metalSales || []).filter(x => x.personId === id).length;
    count += (state.debts || []).filter(x => x.personId === id).length;
  } else if (collection === 'income_types') {
    count += (state.incomeEntries || []).filter(x => x.typeId === id).length;
    count += (state.expenseEntries || []).filter(x => x.paidFromTypeId === id).length;
    count += (state.transfers || []).filter(x => x.fromTypeId === id || x.toTypeId === id).length;
    count += (state.savingsHoldings || []).filter(x => x.incomeTypeId === id).length;
    count += (state.fundLots || []).filter(x => x.incomeTypeId === id).length;
  } else if (collection === 'expense_categories') {
    count += (state.expenseEntries || []).filter(x => x.categoryId === id).length;
  }

  if (count > 0) {
    return {
      allowed: false,
      count,
      reason: `Bu kayda bağlı ${count} işlem/varlık bulunuyor. Geçmiş verilerin kaybolmaması için silmek yerine Arşivle seçeneğini kullan.`
    };
  }
  return { allowed: true, count: 0, reason: null };
}
