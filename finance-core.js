/* Shared accounting rules for the mobile and desktop interfaces. */
(function(root){
  const EPSILON = 1e-9;
  const key = name => String(name || '').trim().toLocaleLowerCase('tr-TR');
  const remaining = lot => Number(lot.remainingQuantity ?? lot.quantity ?? 0);
  const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const compareLots = (a,b) => String(a.purchaseDate || '').localeCompare(String(b.purchaseDate || ''))
    || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || String(a.id || '').localeCompare(String(b.id || ''));
  function planSale(lots, sale) {
    const {personId, fundName, quantity, salePrice, saleDate} = sale;
    if (!Number.isFinite(quantity) || quantity <= EPSILON || !Number.isFinite(salePrice) || salePrice <= 0) {
      throw new Error('invalid_sale');
    }
    const candidates = lots.filter(lot => lot.personId === personId && key(lot.fundName) === key(fundName)
      && (!lot.purchaseDate || lot.purchaseDate <= saleDate) && remaining(lot) > EPSILON).sort(compareLots);
    const available = candidates.reduce((sum, lot) => sum + remaining(lot), 0);
    if (quantity > available + EPSILON) throw Object.assign(new Error('insufficient_units'), {available});
    let pending = quantity;
    let cost = 0;
    const lotBreakdown = [];
    for (const lot of candidates) {
      if (pending <= EPSILON) break;
      const qty = Math.min(remaining(lot), pending);
      const purchasePrice = Number(lot.purchasePrice || 0);
      cost += qty * purchasePrice;
      lotBreakdown.push({lotId: lot.id, qty, purchasePrice, purchaseDate: lot.purchaseDate});
      pending -= qty;
    }
    const costBasis = money(cost);
    const proceeds = money(quantity * salePrice);
    const grossProfit = money(proceeds - costBasis);
    const stopaj = sale.actualTax ?? money(Math.max(grossProfit, 0) * 0.175);
    if (!Number.isFinite(stopaj) || stopaj < 0 || stopaj > proceeds) throw new Error('invalid_tax');
    return {...sale, lotBreakdown, costBasis, proceeds, grossProfit, stopaj, netProfit: money(grossProfit - stopaj)};
  }
  function applySale(lots, sale, direction) {
    for (const entry of sale.lotBreakdown || []) {
      const lot = lots.find(row => row.id === entry.lotId);
      if (!lot) throw new Error('missing_lot');
      lot.remainingQuantity = Math.max(0, remaining(lot) + direction * Number(entry.qty));
    }
  }
  function cashChange(data, typeId) {
    const buys = [...data.savingsHoldings, ...data.fundLots].reduce((sum, row) =>
      row.cashTypeId === typeId ? sum + money(Number(row.quantity) * Number(row.purchasePrice)) : sum, 0);
    const sales = data.fundSales.reduce((sum, row) =>
      row.cashTypeId === typeId ? sum + money(Number(row.proceeds) - Number(row.stopaj || 0)) : sum, 0);
    return money(sales - buys);
  }
  root.FinanceCore = {planSale, applySale, cashChange, compareLots, money};
})(globalThis);
