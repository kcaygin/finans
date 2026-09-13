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
function decodeHtmlEntities(str) {
  // Dünya Katılım'ın ham HTML yanıtı Türkçe karakterleri (ı, ü, ş, ...) sayısal HTML
  // varlık referansı olarak gönderiyor (örn. "Alt&#x131;n" = "Altın"), tarayıcıda
  // otomatik çözüldüğü için normalde fark edilmez ama düz metin regex'i bunu
  // yakalayamaz -- bu yüzden regex uygulamadan önce hepsini çözüyoruz.
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function describeError(e) {
  // Node'un fetch()'i ağ seviyesinde bir sorun olduğunda (bağlantı reddi, zaman
  // aşımı, DNS hatası, TLS hatası...) sadece genel "fetch failed" mesajı verir --
  // asıl sebep e.cause içinde saklı kalır ve normalde loglanmaz. Bunu da
  // logladığımızda, sorunun "site erişilemez durumda" mı yoksa "bağlantı
  // GitHub Actions'ın IP'sinden reddediliyor" mu olduğunu ayırt edebiliriz.
  const parts = [(e && e.message) || String(e)];
  let cause = e && e.cause;
  let depth = 0;
  while (cause && depth < 5) {
    parts.push('cause: ' + (cause.code ? cause.code + ' - ' : '') + (cause.message || String(cause)));
    cause = cause.cause;
    depth++;
  }
  return parts.join(' | ');
}

// Gerçek bir Chrome tarayıcısına benzer istek başlıkları -- bazı siteler bot gibi
// görünen isteklere (ör. özel bir User-Agent) farklı/eksik içerik döndürebiliyor.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
};

// Uygulamada "Fon Adı" olarak girilen fonlardan otomatik fiyat çekilecek olanlar --
// buradaki kod TEFAS'taki gerçek fon koduyla birebir aynı olmalı (örn. "EP1").
// Yeni bir fon eklenirse buraya da eklenmesi gerekir.
const TEFAS_FUND_CODES = ['EP1'];

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
  // Gerçek bir tarayıcıya benzer başlıklar gönderiyoruz: bazı siteler
  // "bot gibi görünen" User-Agent'ları (ör. "KFT-price-fetcher/1.0") farklı
  // bir içerikle (ör. bir doğrulama/engelleme sayfasıyla) yanıtlayabiliyor,
  // bu da GitHub Actions'tan çalışırken -- kullanıcının kendi tarayıcısından
  // farklı olarak -- satırların bulunamamasını açıklayabilir.
  const res = await fetch('https://dunyakatilim.com.tr/gunluk-kurlar', {
    headers: Object.assign({}, BROWSER_HEADERS, { 'Referer': 'https://dunyakatilim.com.tr/' })
  });
  if (!res.ok) throw new Error('Dünya Katılım isteği başarısız: HTTP ' + res.status);
  const html = decodeHtmlEntities(await res.text());

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
  if (!altin || !gumus) {
    // Teşhis bilgisi: bir sonraki hata bu satırları içerecek, böylece asıl
    // problemin "sayfa yapısı değişti" mi yoksa "farklı bir sayfa döndü"
    // (ör. engelleme/doğrulama sayfası) mı olduğunu tek seferde anlayabiliriz.
    const diag = {
      httpStatus: res.status,
      htmlLength: html.length,
      hasXAU: /XAU/i.test(html),
      hasXAG: /XAG/i.test(html),
      hasAltinWord: /Alt[ıi]n/i.test(html),
      hasGumusWord: /G[üu]m[üu][şs]/i.test(html),
      htmlStart: html.slice(0, 200)
    };
    throw new Error('Dünya Katılım sayfasında Altın/Gümüş satırları bulunamadı (sayfa yapısı değişmiş olabilir). Teşhis: ' + JSON.stringify(diag));
  }

  return {
    altinAlis: altin.buy,
    altinSatis: altin.sell,
    gumusAlis: gumus.buy,
    gumusSatis: gumus.sell
  };
}

async function fetchTefasFund(code) {
  // TEFAS'ın kendi iç API'si (fonFiyatBilgiGetir) tarayıcıdan yapılmayan
  // isteklerde "Sistem Hatası!!" döndürüyor (muhtemelen bir bot/CSRF koruması) --
  // ama fon detay sayfası bir gerçek tarayıcı sekmesinde açıldığında sunucu
  // tarafında (SSR) tam render edilmiş HTML geliyor ve "Son Fiyat (TL)" değeri
  // düz metin olarak sayfada yer alıyor. Bir tarayıcının fetch()'i (Sec-Fetch-Mode:
  // cors) ile aynı adrese gidildiğinde ise site daha küçük, verisiz bir "kabuk"
  // sayfa döndürüyor -- muhtemelen isteğin gerçek bir sayfa açılışı (navigation)
  // olup olmadığına bakıyor. Node'un fetch()'i tarayıcı gibi bu başlıkları
  // engellemediği için, gerçek bir sayfa açılışını taklit etmeye çalışıyoruz.
  const res = await fetch('https://www.tefas.gov.tr/tr/fon-detayli-analiz/' + encodeURIComponent(code), {
    headers: Object.assign({}, BROWSER_HEADERS, {
      'Referer': 'https://www.tefas.gov.tr/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    })
  });
  if (!res.ok) throw new Error('TEFAS (' + code + ') isteği başarısız: HTTP ' + res.status);
  const html = await res.text();

  const re = /Son Fiyat \(TL\)<\/p>[\s\S]{0,800}?<p class="[^"]*">([\d.,]+)<\/p>/i;
  const m = html.match(re);
  if (!m) {
    const diag = {
      httpStatus: res.status,
      htmlLength: html.length,
      hasLabel: /Son Fiyat/i.test(html),
      htmlStart: html.slice(0, 200)
    };
    // Küçük bir htmlLength (~7KB) + hasLabel:false, sitenin veri içermeyen bir
    // "kabuk" sayfa döndürdüğünü gösterir -- yani gerçek sayfa içeriğini değil,
    // muhtemelen bir bot/otomasyon koruması araya girmiş demektir.
    throw new Error('TEFAS ' + code + ' fon fiyatı sayfada bulunamadı (sayfa yapısı değişmiş, ya da site otomatik isteklere farklı/verisiz bir sayfa döndürüyor olabilir). Teşhis: ' + JSON.stringify(diag));
  }

  return { fiyat: parseTR(m[1]) };
}

(async () => {
  const fs = await import('node:fs');
  const result = { updatedAt: new Date().toISOString() };
  let hadError = false;

  try {
    result.ziraatKatilim = await fetchZiraat();
  } catch (e) {
    console.error('Ziraat Katılım çekilemedi:', describeError(e));
    hadError = true;
  }

  try {
    result.dunyaKatilim = await fetchDunya();
  } catch (e) {
    console.error('Dünya Katılım çekilemedi:', describeError(e));
    hadError = true;
  }

  result.fonFiyatlari = {};
  for (const code of TEFAS_FUND_CODES) {
    try {
      result.fonFiyatlari[code] = await fetchTefasFund(code);
    } catch (e) {
      console.error('TEFAS ' + code + ' çekilemedi:', describeError(e));
      hadError = true;
    }
  }

  const anyFundOk = Object.keys(result.fonFiyatlari).length > 0;

  // en az bir kaynak başarılıysa dosyayı yaz (eskisini tamamen boşaltmayalım)
  if (result.ziraatKatilim || result.dunyaKatilim || anyFundOk) {
    let previous = {};
    try { previous = JSON.parse(fs.readFileSync('prices.json', 'utf8')); } catch (e) {}
    if (!result.ziraatKatilim && previous.ziraatKatilim) result.ziraatKatilim = previous.ziraatKatilim;
    if (!result.dunyaKatilim && previous.dunyaKatilim) result.dunyaKatilim = previous.dunyaKatilim;
    if (previous.fonFiyatlari) {
      for (const code of Object.keys(previous.fonFiyatlari)) {
        if (!result.fonFiyatlari[code]) result.fonFiyatlari[code] = previous.fonFiyatlari[code];
      }
    }
    fs.writeFileSync('prices.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error('Hiçbir kaynaktan veri alınamadı, prices.json değiştirilmedi.');
  }

  if (hadError && !result.ziraatKatilim && !result.dunyaKatilim && !anyFundOk) {
    process.exit(1);
  }
})();
