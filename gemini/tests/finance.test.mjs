import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseMoneyInput,
  computePotBalance,
  computeFundLedger,
  previewFundSale,
  computeMetalLedger,
  analyzeBankPrices,
  matchFetchedPrices,
  computeOverview,
  principalBySource,
  unifiedEntries,
  computeMonthlyTrend,
  computeMonthlyClose,
  groupHoldingsByBank,
  canDeleteEntity
} from '../js/finance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function baseState() {
  return {
    people: [
      { id: 'p1', name: 'Kürşat', archived: false },
      { id: 'p2', name: 'Baba', archived: false }
    ],
    incomeTypes: [
      { id: 'it1', name: 'Maaş', personId: 'p1', archived: false },
      { id: 'it2', name: 'Buğday', personId: 'p2', archived: false }
    ],
    expenseCategories: [{ id: 'ec1', name: 'Market', archived: false }],
    incomeEntries: [{ id: 'inc1', typeId: 'it1', personId: 'p1', amount: 10000, date: '2026-11-01' }],
    expenseEntries: [],
    savingsHoldings: [],
    materialPrices: [],
    fundLots: [],
    fundSales: [],
    fundPrices: [],
    transfers: [],
    metalSales: [],
    debts: [],
    fundConfigs: []
  };
}

test('Türkçe ve uluslararası para girişi çözümleme', () => {
  assert.equal(parseMoneyInput('125,50'), 125.5);
  assert.equal(parseMoneyInput('12.345,67'), 12345.67);
  assert.equal(parseMoneyInput('12,345.67'), 12345.67);
  assert.equal(parseMoneyInput('₺ 1.500,25'), 1500.25);
  assert.equal(parseMoneyInput('0'), 0);
});

test('Çift sayım engeli: nakitten yatırıma transfer + açılış kaydı göç güvenliği', () => {
  const s = baseState();
  // 10.000 TL maaştan 3.000 TL transfer ile fon alınırsa nakit 7.000 + yatırım 3.000 = 10.000 olmalı
  s.transfers.push({
    id: 'tr1',
    direction: 'to_investment',
    personId: 'p1',
    fromTypeId: 'it1',
    toTypeId: null,
    amount: 3000,
    date: '2026-11-05'
  });
  s.fundLots.push({
    id: 'fl1',
    personId: 'p1',
    incomeTypeId: 'it1',
    linkedTransferId: 'tr1',
    fundName: 'EP1',
    quantity: 300,
    purchasePrice: 10,
    purchaseDate: '2026-11-05'
  });

  // Ayrıca önceden sahip olunan (linkedTransferId olmadan açılış kaydı) 2.000 TL altın nakdi azaltmamalı
  s.savingsHoldings.push({
    id: 'h_open',
    personId: 'p1',
    material: 'Gram Altın',
    bank: 'Dünya Katılım',
    quantity: 1,
    purchasePrice: 2000,
    purchaseDate: '2026-01-01'
  });

  const ov = computeOverview(s, 'p1');
  assert.equal(ov.cash, 7000);
  assert.equal(ov.fundValue, 3000);
  assert.equal(ov.metalValue, 2000);
  assert.equal(ov.grossTotal, 12000); // 7000 nakit + 3000 fon + 2000 açılış altın

  // Yatırım transferi tüketim gideri sayılmamalı
  const trend = computeMonthlyTrend(s, 'p1', 1, new Date('2026-11-26'));
  assert.equal(trend[0].expense, 0);
  assert.equal(trend[0].invested, 3000);
});

test('Olay-tabanlı kronolojik FIFO: geçmiş lot fiyatı değişince satış kârı ve sonraki satış güncellenir', () => {
  const s = baseState();
  // Aynı gün iki farklı fiyattan alış (createdAt ile kesin sıralama)
  s.fundLots.push(
    { id: 'l1', personId: 'p1', fundName: 'EP1', quantity: 10, purchasePrice: 10, purchaseDate: '2026-10-01', createdAt: '2026-10-01T09:00:00Z', stopajRate: 0.1 },
    { id: 'l2', personId: 'p1', fundName: 'EP1', quantity: 10, purchasePrice: 20, purchaseDate: '2026-10-01', createdAt: '2026-10-01T10:00:00Z', stopajRate: 0.1 }
  );
  s.fundSales.push({ id: 's1', personId: 'p1', fundName: 'EP1', quantity: 15, salePrice: 30, saleDate: '2026-10-10', createdAt: '2026-10-10T12:00:00Z' });

  const pv = previewFundSale(s, 'p1', 'EP1', 5, 30);
  assert.equal(pv.ok, true);
  assert.equal(pv.available, 5);

  const l1 = computeFundLedger(s);
  assert.equal(l1.sales[0].costBasis, 200); // 10*10 + 5*20
  assert.equal(l1.sales[0].grossProfit, 250);
  assert.equal(l1.sales[0].stopaj, 25); // %10 stopaj
  assert.equal(l1.sales[0].netProfit, 225);

  // İlk lotun alış fiyatını sonradan 10 -> 12 düzeltirsek satış maliyeti otomatik 220 olmalı
  s.fundLots[0].purchasePrice = 12;
  const l2 = computeFundLedger(s);
  assert.equal(l2.sales[0].costBasis, 220);

  // Ekstredeki gerçek stopaj override'ı çalışmalı
  s.fundSales[0].actualStopaj = 18.5;
  const l3 = computeFundLedger(s);
  assert.equal(l3.sales[0].stopaj, 18.5);
  assert.equal(l3.sales[0].netProfit, 211.5);
});

test('Gerçek prices.json dosyasında Ziraat Katılım %26.1 mesai dışı makas korumasını tetikler', () => {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../prices.json'), 'utf8'));
  const analysis = analyzeBankPrices(raw);
  assert.equal(analysis.dunyaKatilim.spreadWarning, false);
  assert.equal(analysis.ziraatKatilim.spreadWarning, true);
  assert.ok(analysis.ziraatKatilim.goldSpreadPct > 20);

  const groups = [
    { material: 'Gram Altın', bank: 'Dünya Katılım' },
    { material: 'Gram Altın', bank: 'Ziraat Katılım' }
  ];
  const matched = matchFetchedPrices(groups, raw);
  assert.equal(matched.matches.length, 1);
  assert.equal(matched.matches[0].bank, 'Dünya Katılım');
  assert.equal(matched.skippedWarnings.length, 1);
  assert.equal(matched.skippedWarnings[0].bank, 'Ziraat Katılım');
});

test('Sıfır maliyet, banka adı normalizasyonu, arşivli kaynak mutabakatı ve referans bütünlüğü', () => {
  const s = baseState();
  // Sıfır maliyetli hediye altın + aynı bankanın farklı büyük/küçük harfle yazılması
  s.savingsHoldings.push(
    { id: 'h1', personId: 'p1', material: 'Gram Altın', bank: 'Ziraat Katılım', quantity: 2, purchasePrice: 0, purchaseDate: '2026-11-02' },
    { id: 'h2', personId: 'p1', material: 'Gümüş (gram)', bank: 'ziraat katılım', quantity: 10, purchasePrice: 50, purchaseDate: '2026-11-03' }
  );
  s.materialPrices.push({ id: 'mp1', material: 'Gram Altın', bank: 'Ziraat Katılım', price: 6000 });

  const ml = computeMetalLedger(s);
  assert.equal(ml.holdings[0].cost, 0);
  assert.equal(ml.holdings[0].value, 12000);

  const banks = groupHoldingsByBank(s, 'p1');
  assert.equal(banks.length, 1); // İki farklı büyük/küçük harf tek banka grubunda birleşmeli

  // Arşivli kaynak nakit içeriyorsa principalBySource toplamı exact TotalPrincipal'a eşit olmalı
  s.incomeTypes[1].archived = true;
  s.incomeEntries.push({ id: 'inc2', typeId: 'it2', personId: 'p2', amount: 4000, date: '2026-11-04' });
  const ov = computeOverview(s, 'all');
  const srcRows = principalBySource(s, 'all', ov);
  const srcSum = srcRows.reduce((a, r) => a + r.amount, 0);
  assert.equal(srcSum, ov.totalPrincipal);

  // Kişi vs Hesap kapsam tutarlılığı: Kürşat kendi harcamasını Baba'nın hesabından öderse
  s.expenseEntries.push({
    id: 'e_cross',
    categoryId: 'ec1',
    categoryName: 'Market',
    paidFromTypeId: 'it2',
    paidFromTypeName: 'Buğday',
    personId: 'p1',
    amount: 500,
    date: '2026-11-10'
  });
  const kursatSpender = unifiedEntries(s, 'p1', 'spender').filter(x => x.kind === 'gider');
  const babaAccount = unifiedEntries(s, 'p2', 'account').filter(x => x.kind === 'gider');
  assert.equal(kursatSpender.length, 1);
  assert.equal(babaAccount.length, 1);

  // Referans bütünlüğü: bağlı kaydı olan kişi/kaynak silinemez
  const delCheck = canDeleteEntity(s, 'people', 'p1');
  assert.equal(delCheck.allowed, false);
  assert.ok(delCheck.count > 0);
});

test('Aylık kapanış mutabakatı: ay başı + gelir - gider - transfer = ay sonu', () => {
  const s = baseState();
  s.incomeEntries.push({ id: 'inc_prev', typeId: 'it1', personId: 'p1', amount: 5000, date: '2026-10-15' });
  s.expenseEntries.push({ id: 'exp_nov', typeId: 'it1', paidFromTypeId: 'it1', personId: 'p1', amount: 2500, date: '2026-11-10' });
  s.transfers.push({ id: 'tr_nov', direction: 'to_investment', fromTypeId: 'it1', amount: 3000, date: '2026-11-12' });

  const mc = computeMonthlyClose(s, '2026-11', 'p1');
  assert.equal(mc.openingCash, 5000);
  assert.equal(mc.monthIncome, 10000);
  assert.equal(mc.monthExpense, 2500);
  assert.equal(mc.monthTransferOut, 3000);
  assert.equal(mc.closingCash, 9500);
});
