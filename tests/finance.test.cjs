const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

require('../finance-core.js');
const {planSale, applySale, cashChange} = globalThis.FinanceCore;
const lots = [
  {id:'b', personId:'p', fundName:'ABC', purchaseDate:'2026-01-01', createdAt:'2026-01-01T12:00:00Z', quantity:2, purchasePrice:20},
  {id:'a', personId:'p', fundName:'ABC', purchaseDate:'2026-01-01', createdAt:'2026-01-01T11:00:00Z', quantity:2, purchasePrice:10}
];
const sale = {personId:'p', fundName:'ABC', quantity:3, salePrice:30, saleDate:'2026-02-01', actualTax:3, cashTypeId:'salary'};

test('FIFO uses creation time and actual tax, then restores original quantities', () => {
  const draft = structuredClone(lots);
  const planned = planSale(draft, sale);
  assert.deepEqual(planned.lotBreakdown.map(row=>row.lotId), ['a','b']);
  assert.equal(planned.costBasis, 40);
  assert.equal(planned.netProfit, 47);
  applySale(draft, planned, -1);
  assert.deepEqual(draft.map(row=>row.remainingQuantity), [1,0]);
  applySale(draft, planned, 1);
  assert.deepEqual(draft.map(row=>row.remainingQuantity), [2,2]);
  assert.throws(()=>planSale(draft,{...sale,saleDate:'2025-12-31'}), /insufficient_units/);
});

test('cash uses explicit links and keeps opening holdings out of transfers', () => {
  assert.equal(cashChange({
    savingsHoldings: [{quantity:1,purchasePrice:3000,cashTypeId:'salary'}],
    fundLots: lots,
    fundSales: [planSale(lots,sale)]
  },'salary'), -2913);
});

for (const file of ['index.html','masaustu.html']) {
  test(file + ' compiles, migrates local data and leaves state intact after failed writes', async () => {
    const html = readFileSync(file,'utf8');
    const js = html.matchAll(/<script>([\s\S]*?)<\/script>/g).toArray().at(-1)[1];
    new vm.Script(js);
    const storage = new Map([['kft_v1_fund_lots', JSON.stringify(lots)]]);
    let fail = false;
    const localStorage = {
      getItem: key=>storage.get(key),
      setItem(key,value){
        if(fail) throw new Error('simulated failure');
        storage.set(key,value);
      }
    };
    const src = js.slice(js.indexOf('  var LOCAL_PREFIX'),js.indexOf('  // ---------- app state'));
    const Store = vm.runInNewContext(src+'\nStoreLayer', {window:{localStorage}, structuredClone, crypto:globalThis.crypto});
    const store = new Store(null);
    fail = true;
    await assert.rejects(store.transaction(draft=>{
      draft.fund_lots[0].remainingQuantity = 0;
      draft.fund_sales.push({id:'sale'});
    }), /simulated failure/);
    assert.equal((await store.list('fund_lots'))[0].remainingQuantity, undefined);
    assert.equal((await store.list('fund_sales')).length,0);
    fail = false;
    const [one,two] = await Promise.all([store.add('people',{name:'A'}),store.add('people',{name:'B'})]);
    assert.notEqual(one.id,two.id);
    assert.equal((await new Store(null).list('people')).length,2);
    const remote = new Store({saveData:async()=>{throw new Error('failed remote write');}});
    await assert.rejects(remote.add('people',{name:'A'}), /failed remote write/);
    assert.equal((await remote.list('people')).length,0);
  });
}
