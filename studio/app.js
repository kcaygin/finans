'use strict';
const $ = selector => document.querySelector(selector);
const key = 'kelo_studio_v1';
const oldKey = 'kft_v1_';
const collections = ['people','income_types','expense_categories','income_entries','expense_entries','savings_holdings','material_prices','fund_lots','fund_sales','fund_prices'];
const titles = {ozet:'Finans masası',hareketler:'Hareketler',portfoy:'Portföy',butce:'Aylık bütçe',veri:'Veri ve yedek'};
const currency = new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'});
const fmt = value => currency.format(value);
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toLocaleDateString('sv-SE');
const month = () => today().slice(0,7);
const uid = () => crypto.randomUUID();
const blank = () => ({...Object.fromEntries(collections.map(name=>[name,[]])),transfers:[],budgets:{}});
function parse(raw){
  const result = JSON.parse(raw);
  if(!result || !collections.every(name=>Array.isArray(result[name]) && result[name].every(row=>row && typeof row==='object' && typeof row.id==='string'))) throw Error('Yedek biçimi geçersiz.');
  if(result.transfers!==undefined && !Array.isArray(result.transfers)) throw Error('Transfer listesi geçersiz.');
  return {...blank(),...result};
}
function load(){
  const saved = localStorage.getItem(key);
  if(saved) return parse(saved);
  const snapshot = localStorage.getItem(oldKey+'snapshot');
  if(snapshot) return parse(snapshot);
  return parse(JSON.stringify({...blank(),...Object.fromEntries(collections.map(name=>[name,JSON.parse(localStorage.getItem(oldKey+name)||'[]')]))}));
}
let data, loadingError;
try { data = load(); } catch(error) { data = blank(); loadingError = error; }
function commit(change){
  if(loadingError) throw Error('Kayıtlar açılamadı. Veriler ekranından geçerli bir yedek seç.');
  const write = ()=>{
    const draft = load();
    change(draft);
    localStorage.setItem(key,JSON.stringify(draft));
    data = draft;
  };
  return navigator.locks ? navigator.locks.request(key,write) : Promise.resolve().then(write);
}
const nameOf = id => data.income_types.find(account=>account.id===id)?.name || 'Hesap belirtilmemiş';
const category = entry => entry.categoryName || 'Diğer';
function balance(id){
  const deposits = data.income_entries.filter(x=>x.typeId===id).reduce((sum,x)=>sum+Number(x.amount),0);
  const payments = data.expense_entries.filter(x=>x.paidFromTypeId===id).reduce((sum,x)=>sum+Number(x.amount),0);
  const transfers = data.transfers.reduce((sum,x)=>sum+(x.to===id?Number(x.amount):0)-(x.from===id?Number(x.amount):0),0);
  return FinanceCore.money(deposits-payments+transfers+FinanceCore.cashChange({savingsHoldings:data.savings_holdings,fundLots:data.fund_lots,fundSales:data.fund_sales},id));
}
const fundValue = lot => {
  const price = data.fund_prices.find(row=>row.fundName?.toLocaleLowerCase('tr-TR')===lot.fundName?.toLocaleLowerCase('tr-TR'))?.price;
  return {price,quantity:Number(lot.remainingQuantity ?? lot.quantity)};
};
function metalPrice(row){
  const normalize=value=>String(value||'').trim().toLowerCase();
  return data.material_prices.find(price=>normalize(price.material)===normalize(row.material) && normalize(price.bank)===normalize(row.bank))?.price ?? (Number(row.currentPrice)>0?row.currentPrice:null);
}
function positions(){
  return [...data.fund_lots.map(row=>({...row,label:row.fundName,group:'Fon',...fundValue(row)})),
    ...data.savings_holdings.map(row=>({...row,label:row.material,group:'Kıymetli maden',price:metalPrice(row)}))]
    .filter(row=>row.quantity>0).map(row=>({...row,value:Number(row.quantity)*Number(row.price ?? row.purchasePrice)}));
}
function entries(){
  return [
    ...data.income_entries.map(x=>({...x,label:x.note||nameOf(x.typeId),sign:1,group:'Gelir'})),
    ...data.expense_entries.map(x=>({...x,label:x.note||category(x),sign:-1,group:'Gider'})),
    ...data.transfers.map(x=>({...x,label:x.note||nameOf(x.from)+' → '+nameOf(x.to),sign:0,group:'Transfer'})),
    ...[...data.fund_lots,...data.savings_holdings].map(x=>({...x,date:x.purchaseDate,label:x.fundName||x.material,amount:Number(x.quantity)*Number(x.purchasePrice),sign:0,group:'Yatırım alışı'})),
    ...data.fund_sales.map(x=>({...x,date:x.saleDate,label:x.fundName,amount:Number(x.proceeds)-Number(x.stopaj||0),sign:0,group:'Fon satışı'}))
  ].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}
const empty = label => '<p class="empty">'+label+'</p>';
const row = (label,sub,value,cls='') => '<div class="row"><div><strong>'+escape(label)+'</strong><small>'+escape(sub)+'</small></div><b class="'+cls+'">'+escape(value)+'</b></div>';
const movement = item => row(item.label,[item.group,item.date].filter(Boolean).join(' · '),(item.sign===1?'+':item.sign===-1?'−':'')+fmt(item.amount),item.sign===1?'credit':item.sign===-1?'debit':'');
const card = (title,body) => '<section class="card"><h2>'+title+'</h2>'+body+'</section>';
const metric = (label,value,sub='')=>'<div class="metric"><small>'+label+'</small><strong>'+fmt(value)+'</strong>'+(sub?'<span class="tag">'+sub+'</span>':'')+'</div>';
function totals(){
  const accounts = data.income_types.reduce((sum,x)=>sum+balance(x.id),0);
  const assets = positions().reduce((sum,x)=>sum+x.value,0);
  const income = data.income_entries.filter(x=>x.date?.startsWith(month())).reduce((sum,x)=>sum+Number(x.amount),0);
  const spending = data.expense_entries.filter(x=>x.date?.startsWith(month())).reduce((sum,x)=>sum+Number(x.amount),0);
  return {accounts,assets,income,spending};
}
function flow(income,spending){
  const max=Math.max(income,spending,1);
  return row('Gelir','Bu ay',fmt(income),'credit')+'<div class="track"><span style="width:'+100*income/max+'%"></span></div>'+
    row('Gider','Bu ay',fmt(spending),'debit')+'<div class="track over"><span style="width:'+100*spending/max+'%"></span></div>';
}
function dashboard(){
  const t = totals();
  return '<section class="hero"><p class="pill">Nakit ve yatırımlar</p><strong>'+fmt(t.accounts+t.assets)+'</strong><p>Toplam izlenen varlık</p></section>'+
    '<section class="metrics">'+metric('Nakit',t.accounts)+metric('Yatırımlar',t.assets)+metric('Bu ay net akış',t.income-t.spending,'Gelir − gider')+'</section>'+
    '<div class="grid">'+card('Son hareketler',entries().slice(0,5).map(movement).join('')||empty('İlk hareketini ekleyerek başla.'))+
    '<div>'+card('Bu ay nakit akışı',flow(t.income,t.spending))+card('Nakit hesapları',data.income_types.map(x=>row(x.name,x.archived?'Arşivde':'Bakiye',fmt(balance(x.id)))).join('')||'<p class="empty">Henüz nakit hesabı yok.</p><button class="secondary" data-action="account">Hesap oluştur</button>')+'</div></div>';
}
function movements(){
  return '<section class="card"><div class="toolbar"><input type="search" id="search" placeholder="İşlem ara" aria-label="İşlem ara"><select id="filter" aria-label="İşlem türüne göre filtrele">'+['Tümü','Gelir','Gider','Transfer','Yatırım alışı','Fon satışı'].map(x=>'<option>'+x+'</option>').join('')+'</select></div><div id="results"></div></section>';
}
function filterEntries(){
  const query = $('#search').value.trim().toLocaleLowerCase('tr-TR');
  const group = $('#filter').value;
  $('#results').innerHTML = entries().filter(x=>(group==='Tümü'||x.group===group) && String(x.label).toLocaleLowerCase('tr-TR').includes(query)).map(movement).join('')||empty('Eşleşen hareket yok.');
}
function portfolio(){
  const p = positions();
  const cost = p.reduce((sum,x)=>sum+Number(x.purchasePrice)*Number(x.quantity),0);
  const value = p.reduce((sum,x)=>sum+x.value,0);
  const realized = data.fund_sales.reduce((sum,x)=>sum+Number(x.netProfit||0),0);
  return '<div class="metrics">'+metric('Portföy değeri',value)+metric('Eldeki değer farkı',value-cost)+metric('Kayıtlı satış sonucu',realized,'Kesinti tahmini içerebilir')+'</div><div class="grid">'+
    card('Açık pozisyonlar',p.map(x=>row(x.label,x.group+' · '+x.quantity+(x.price==null?' · Maliyet üzerinden':''),fmt(x.value))+
      '<button type="button" class="secondary" data-price-kind="'+(x.group==='Fon'?'fund':'metal')+'" data-price-id="'+escape(x.id)+'">Fiyat gir</button>').join('')||empty('Portföyde varlık yok.'))+
    card('Son fon satışları',data.fund_sales.slice(-5).reverse().map(x=>row(x.fundName,x.saleDate+' · '+(x.actualTax==null?'Tahmini kesinti':'Ekstre kesintisi'),fmt(x.netProfit||0))).join('')||empty('Satış kaydı yok.'))+'</div>';
}
function budget(){
  const spent = Object.create(null);
  data.expense_entries.filter(x=>x.date?.startsWith(month())).forEach(x=>{const label=category(x);spent[label]=(spent[label]||0)+Number(x.amount);});
  const limits = data.budgets[month()]||{};
  const names = [...new Set([...Object.keys(spent),...Object.keys(limits)])];
  const sections = names.map(name=>{
    const amount=spent[name]||0, limit=Number(limits[name]||0);
    return row(name,limit?'Limit '+fmt(limit):'Limit tanımlanmadı',fmt(amount))+(limit?'<div class="track '+(amount>limit?'over':'')+'"><span style="width:'+Math.min(100,100*amount/limit)+'%"></span></div>':'');
  }).join('');
  return '<div class="grid">'+card('Kategori harcamaları',sections||empty('Bu ay kategori harcaması yok.'))+
    card('Harcama limiti','<form id="budget-form"><label>Kategori<input name="category" required></label><label>Aylık limit (₺)<input name="limit" inputmode="decimal" required></label><button class="primary file">Limiti kaydet</button></form>')+'</div>';
}
function storage(){
  return '<div class="grid">'+card('Yedekle','<p>Mevcut kayıtları JSON dosyası olarak indir.</p><button class="primary" id="export">JSON indir</button>')+
    card('Yedekten aç','<p>Eski veya yeni Kelo Finans yedeğini bu önizlemeye al. Bu işlem mevcut önizleme kayıtlarının yerine yedekteki kayıtları koyar ve önizlemenin bir kopyasını indirir.</p><label class="file">JSON yedeği<input type="file" accept=".json,application/json" id="import"></label><button class="secondary file" id="restore" disabled>Yedeği aç</button>')+'</div>';
}
const screens = {ozet:dashboard,hareketler:movements,portfoy:portfolio,butce:budget,veri:storage};
function render(){
  const requested = location.hash.slice(1);
  const route = Object.hasOwn(screens,requested)?requested:'ozet';
  $('#page-title').textContent = titles[route];
  document.querySelectorAll('nav a').forEach(a=>a.hash==='#'+route?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));
  $('#view').innerHTML = screens[route]();
  if(route==='hareketler'){ filterEntries(); $('#search').oninput=filterEntries; $('#filter').onchange=filterEntries; }
  if(route==='veri') bindStorage();
  if(route==='butce') $('#budget-form').onsubmit = async event=>{
    event.preventDefault();
    const f=new FormData(event.currentTarget);
    try {
      const amount=readAmount(f.get('limit'));
      const category=f.get('category').trim();
      if(!category) throw Error('Kategori adını gir.');
      await commit(draft=>{draft.budgets[month()]={...draft.budgets[month()],[category]:amount};});
      render(); say('Limit kaydedildi.');
    } catch(error){say(error.message);}
  };
}
const input = (label,name,attrs='')=>'<label>'+label+'<input name="'+name+'" '+attrs+'></label>';
const amountField = (label,name='amount',attrs='required')=>input(label,name,'inputmode="decimal" '+attrs);
const select = (label,name,values,optional=false)=>'<label>'+label+'<select name="'+name+'" '+(optional?'':'required')+'><option value="">'+(optional?'Bağlama':'Seç')+'</option>'+values.map(x=>'<option value="'+escape(x.id)+'">'+escape(x.name)+'</option>').join('')+'</select></label>';
function fields(){
  const kind=$('#kind').value;
  const accounts=data.income_types.filter(x=>!x.archived);
  $('#form-error').textContent='';
  if(kind==='price') return;
  const f=kind==='account'?input('Hesap adı','label','required maxlength="70"'):
    kind==='transfer'?select('Çıkış hesabı','account',accounts)+select('Varış hesabı','to',accounts)+amountField('Tutar (₺)'):
    kind==='income'||kind==='expense'?select('Nakit hesabı','account',accounts)+amountField('Tutar (₺)')+(kind==='expense'?input('Kategori','category','required maxlength="70"'):''):
    input(kind==='metal'?'Maden adı':'Fon kodu','label','required maxlength="80"')+
    (kind==='metal'?input('Banka veya saklama yeri','bank','maxlength="80"'):'')+
    (kind==='sale'?select('Lot sahibi','person',data.people):'')+
    amountField(kind==='metal'?'Miktar (gram)':'Adet','quantity')+amountField('Birim fiyat (₺)','price')+
    select(kind==='sale'?'Net tutarın gideceği hesap':'Alışın ödeneceği hesap','account',accounts,true)+
    (kind==='sale'?amountField('Ekstre kesintisi (₺)','tax',''):'');
  $('#fields').innerHTML=f+(kind==='account'?'':input('İşlem tarihi','date','type="date" value="'+today()+'" required')+input('Not','note','maxlength="200"'))+
    (kind==='sale'?'<p id="sale-preview" class="sale-preview" aria-live="polite"></p>':'')+
    (!accounts.length&&['expense','income','transfer'].includes(kind)?'<button type="button" class="secondary" data-action="account">Önce bir nakit hesabı oluştur</button>':'');
}
function readAmount(raw,allowZero=false){
  const value=String(raw??'').trim();
  if(!/^\d+(?:[.,]\d{1,6})?$/.test(value)) throw Error('Geçerli bir sayı gir.');
  const result=Number(value.replace(',','.'));
  if(!Number.isFinite(result)||result>1e12||result<0||(!allowZero&&result===0)) throw Error('Tutarı veya miktarı kontrol et.');
  return result;
}
const editor=$('#editor');
function showSalePreview(){
  if($('#kind').value!=='sale') return;
  const preview=$('#sale-preview');
  const f=new FormData($('#form'));
  preview.textContent='';
  if(!f.get('person')||!f.get('label')||!f.get('quantity')||!f.get('price')) return;
  try {
    const result=FinanceCore.planSale(data.fund_lots,{
      personId:f.get('person'),fundName:f.get('label').trim(),quantity:readAmount(f.get('quantity')),
      salePrice:readAmount(f.get('price')),saleDate:f.get('date'),
      actualTax:f.get('tax').trim()?readAmount(f.get('tax'),true):undefined
    });
    preview.textContent='Maliyet '+fmt(result.costBasis)+' · '+(result.actualTax==null?'Tahmini kesinti':'Ekstre kesintisi')+' '+fmt(result.stopaj)+' · Net satış '+fmt(result.proceeds-result.stopaj);
  } catch(error) { preview.textContent=error.message==='insufficient_units'?'Bu tarihte yeterli fon adedi yok.':'Satış tutarını ve kesintiyi kontrol et.'; }
}
$('#form').addEventListener('input',showSalePreview);
function openEditor(kind='expense'){
  $('#kind').querySelector('[value=price]')?.remove();
  $('#form').reset();
  $('#dialog-title').textContent='Yeni işlem';
  $('#kind').disabled=false;
  $('#kind').value=kind; fields();
  if(!editor.open) editor.showModal();
}
let priceTarget;
function openPrice(target){
  priceTarget=target;
  $('#kind').add(new Option('Fiyat güncelle','price'));
  $('#kind').value='price'; $('#kind').disabled=true;
  $('#dialog-title').textContent='Fiyat güncelle';
  $('#form-error').textContent='';
  $('#fields').innerHTML=amountField('Güncel birim fiyat (₺)','price');
  editor.showModal();
}
async function record(f,kind){
  const label=String(f.get('label')||'').trim();
  const base={id:uid(),createdAt:new Date().toISOString(),date:f.get('date'),note:String(f.get('note')||'').trim()};
  const accountId=f.get('account');
  await commit(d=>{
    const account=d.income_types.find(x=>x.id===accountId&&!x.archived);
    if(kind==='price'){
      const price=readAmount(f.get('price'));
      const target=d[priceTarget.kind==='fund'?'fund_lots':'savings_holdings'].find(row=>row.id===priceTarget.id);
      if(!target) throw Error('Varlık bulunamadı.');
      const table=priceTarget.kind==='fund'?d.fund_prices:d.material_prices;
      const current=table.find(row=>priceTarget.kind==='fund'?row.fundName===target.fundName:(row.material===target.material&&row.bank===target.bank));
      const values={price,updatedAt:base.createdAt};
      if(current) Object.assign(current,values);
      else table.push({id:uid(),fundName:target.fundName,material:target.material,bank:target.bank,...values});
      return;
    }
    if(kind==='account'){
      if(!label) throw Error('Hesap adını gir.');
      if(!d.people.length) d.people.push({id:uid(),name:'Ben'});
      d.income_types.push({id:base.id,name:label,personId:d.people[0].id});
      return;
    }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(base.date||'')) throw Error('İşlem tarihini seç.');
    if(accountId&&!account) throw Error('Nakit hesabı bulunamadı.');
    if(['income','expense','transfer'].includes(kind)){
      if(!account) throw Error('Nakit hesabını seç.');
      const amount=FinanceCore.money(readAmount(f.get('amount')));
      if(!amount) throw Error('En az bir kuruş gir.');
      if(kind==='income') d.income_entries.push({...base,typeId:account.id,personId:account.personId,amount});
      if(kind==='expense'){
        const name=f.get('category').trim();
        if(!name) throw Error('Kategori adını gir.');
        let cat=d.expense_categories.find(x=>x.name===name);
        if(!cat){cat={id:uid(),name};d.expense_categories.push(cat);}
        d.expense_entries.push({...base,categoryId:cat.id,categoryName:cat.name,paidFromTypeId:account.id,personId:account.personId,amount});
      }
      if(kind==='transfer'){
        const to=d.income_types.find(x=>x.id===f.get('to')&&!x.archived);
        if(!to||to.id===account.id) throw Error('İki farklı hesap seç.');
        d.transfers.push({...base,from:account.id,to:to.id,amount});
      }
      return;
    }
    if(!label) throw Error('Varlık adını gir.');
    const quantity=readAmount(f.get('quantity')), price=readAmount(f.get('price'),kind!=='sale');
    if(kind==='sale'){
      const personId=f.get('person');
      if(account && account.personId!==personId) throw Error('Portföy sahibiyle aynı kişiye ait bir nakit hesabı seç.');
      if(!d.people.some(p=>p.id===personId)) throw Error('Lot sahibini seç.');
      if(d.fund_sales.some(x=>x.personId===personId&&x.fundName?.toLocaleLowerCase('tr-TR')===label.toLocaleLowerCase('tr-TR')&&x.saleDate>base.date)) throw Error('Bu fonun daha yeni bir satışı var. Kronolojik sırayı kontrol et.');
      const actualTax=f.get('tax')?.trim()?readAmount(f.get('tax'),true):undefined;
      const sale=FinanceCore.planSale(d.fund_lots,{...base,personId,fundName:label,quantity,salePrice:price,saleDate:base.date,cashTypeId:accountId||null,actualTax});
      FinanceCore.applySale(d.fund_lots,sale,-1); d.fund_sales.push(sale); return;
    }
    if(!d.people.length) d.people.push({id:uid(),name:'Ben'});
    const buy={...base,personId:account?.personId||d.people[0].id,quantity,purchasePrice:price,purchaseDate:base.date,cashTypeId:accountId||null,incomeTypeId:accountId||null};
    if(kind==='fund') d.fund_lots.push({...buy,fundName:label,remainingQuantity:quantity});
    if(kind==='metal') d.savings_holdings.push({...buy,material:label,bank:f.get('bank').trim(),unit:'gram'});
  });
}
function download(){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');
  a.href=url; a.download='kelo-yedek-'+today()+'.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function bindStorage(){
  $('#export').onclick=download;
  $('#import').onchange=()=>{$('#restore').disabled=!$('#import').files.length;};
  $('#restore').onclick=async()=>{
    try {
      const next=parse(await $('#import').files[0].text());
      if(loadingError){
        const prior=localStorage.getItem(key);
        if(prior) localStorage.setItem(key+'_recovery',prior);
      } else download();
      localStorage.setItem(key,JSON.stringify(next)); data=next; loadingError=null;
      render(); say('Yedek açıldı.');
    } catch(error){say(error.message);}
  };
}
let noticeTimer;
function say(message){$('#notice').textContent=message;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{$('#notice').textContent='';},5500);}
$('#new').onclick=()=>openEditor();
$('#close').onclick=()=>editor.close();
$('#kind').onchange=fields;
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]');
  if(action) openEditor(action.dataset.action);
  const price=event.target.closest('[data-price-id]');
  if(price) openPrice({kind:price.dataset.priceKind,id:price.dataset.priceId});
});
$('#form').onsubmit=async event=>{
  event.preventDefault();
  const button=event.submitter;
  if(!button||button.disabled) return;
  button.disabled=true;
  try {await record(new FormData(event.currentTarget),$('#kind').value);editor.close();render();say('Kaydedildi.');}
  catch(error){$('#form-error').textContent=({insufficient_units:'Satış tarihinde yeterli fon adedi yok.',invalid_tax:'Kesinti satış tutarını aşamaz.'})[error.message]||error.message;}
  finally{button.disabled=false;}
};
window.addEventListener('hashchange',render);
window.addEventListener('storage',event=>{if(event.key===key){try{data=load();render();}catch(error){say(error.message);}}});
$('#date').textContent=new Intl.DateTimeFormat('tr-TR',{dateStyle:'full'}).format(new Date());
render();
if(loadingError) say('Eski kayıtlar açılamadı. Veriler bölümünden bir JSON yedeği seçebilirsin.');
