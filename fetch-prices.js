// Dünya Katılım ve Ziraat Katılım'ın günlük altın/gümüş kurlarını çekip
// repo köküne prices.json olarak yazar. GitHub Actions tarafından
// (.github/workflows/update-prices.yml) periyodik olarak çalıştırılır.
// Node 20+ gerekir (yerleşik fetch kullanılıyor, ekstra paket kurulmaz).

function parseUS(str) {
  // "6,706.9940" -> 6706.9940  (virgül binlik ayraç, nokta ondalık)
  return parseFloat(String(str).replace(/,/g, ''));
}
function parseTR(str) {
  // "6.073,9718" -> 6073.9718  (nokta binlik ayraç, virgül ondalık)
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.'));
}

async function fetchZiraat() {
  const res = await fetch('https://www.ziraatkatilim.com.tr/ajax/piyasalar', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KFT-price-fetcher/1.0)' }
  });
  if (!res.ok) throw new Error('Ziraat Katılım isteği başarısız: HTTP ' + res.status);
  const json = await res.json();
  if (!json || !Array.isArray(json.data)) throw new Error('Ziraat Katılım beklenmeyen yanıt biçimi');
  const xau = json.data.find(d => d.code === 'XAU');
  const xag = json.data.find(d => d.code === 'XAG');
  if (!xau || !xag) throw new Error('Ziraat Katılım yanıtında XAU/XAG bulunamadı');
  return {
    altinAlis: parseTR(xau.buy),
    altinSatis: parseTR(xau.sell),
    gumusAlis: parseTR(xag.buy),
    gumusSatis: parseTR(xag.sell)
  };
}

async function fetchDunya() {
  const res = await fetch('https://dunyakatilim.com.tr/gunluk-kurlar', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KFT-price-fetcher/1.0)' }
  });
  if (!res.ok) throw new Error('Dünya Katılım isteği başarısız: HTTP ' + res.status);
  const html = await res.text();

  function extractRow(labelPattern) {
    // <span>Altın (XAU)</span> ... <td class="col">ALIŞ</td> <td class="col">SATIŞ</td>
    const re = new RegExp(
      labelPattern + '\\s*</span>[\\s\\S]{0,600}?<td class="col">([\\d,]+\\.\\d+)</td>\\s*<td class="col">([\\d,]+\\.\\d+)</td>',
      'i'
    );
    const m = html.match(re);
    if (!m) return null;
    return { buy: parseUS(m[1]), sell: parseUS(m[2]) };
  }

  const altin = extractRow('Alt[ıi]n \\(XAU\\)');
  const gumus = extractRow('G[üu]m[üu][şs] \\(XAG\\)');
  if (!altin || !gumus) throw new Error('Dünya Katılım sayfasında Altın/Gümüş satırları bulunamadı (sayfa yapısı değişmiş olabilir)');

  return {
    altinAlis: altin.buy,
    altinSatis: altin.sell,
    gumusAlis: gumus.buy,
    gumusSatis: gumus.sell
  };
}

(async () => {
  const fs = await import('node:fs');
  const result = { updatedAt: new Date().toISOString() };
  let hadError = false;

  try {
    result.ziraatKatilim = await fetchZiraat();
  } catch (e) {
    console.error('Ziraat Katılım çekilemedi:', e.message);
    hadError = true;
  }

  try {
    result.dunyaKatilim = await fetchDunya();
  } catch (e) {
    console.error('Dünya Katılım çekilemedi:', e.message);
    hadError = true;
  }

  // en az bir kaynak başarılıysa dosyayı yaz (eskisini tamamen boşaltmayalım)
  if (result.ziraatKatilim || result.dunyaKatilim) {
    let previous = {};
    try { previous = JSON.parse(fs.readFileSync('prices.json', 'utf8')); } catch (e) {}
    if (!result.ziraatKatilim && previous.ziraatKatilim) result.ziraatKatilim = previous.ziraatKatilim;
    if (!result.dunyaKatilim && previous.dunyaKatilim) result.dunyaKatilim = previous.dunyaKatilim;
    fs.writeFileSync('prices.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error('Hiçbir kaynaktan veri alınamadı, prices.json değiştirilmedi.');
  }

  if (hadError && !result.ziraatKatilim && !result.dunyaKatilim) {
    process.exit(1);
  }
})();
