# Kelo Finans geri dönüş ve yayın kontrolü

Eski kod GitHub'da `backup/legacy-2026-11-26` dalında ve `416a3f5` commit'inde duruyor. Geliştirme makinesindeki `.local-backup/legacy.bundle` Git geçmişini, `.local-backup/legacy-files.tar.gz` düzenleme öncesindeki çalışma dosyalarını içeriyor.

## Yayına almadan önce

- Eski uygulamanın kullanıldığı her tarayıcıdaki yerel verileri ve eşitleme için kullanılan özel depodaki `data.json` dosyasını ayrı yedekle. Kod deposunun yedeği bu kayıtları kapsamaz.
- Yeni sürümde **Ayarlar → Veri yedeğini indir** açık veri kümesini JSON olarak dışa aktarır. GitHub bağlantısı kesikse bu dosyada ekranda görüntülenen yerel veri bulunur. Token dışa aktarılmaz.
- Alışlarda nakit bağlantısı seçime bağlıdır. Mevcut kayıtlara nakit hareketi eklenmez. Daha önce ayrıca gider yazılmış bir alış için nakit bağlantısını açmadan önce eski gideri kontrol et.
- Yerel kayıtlar ilk başarılı yazımda tek `kft_v1_snapshot` anahtarına geçer. Eski koleksiyon anahtarları korunur. Diğer tarayıcılar ve GitHub'daki veriler bağımsızdır.

## Eski arayüze dönmek

Yeni sürümün birleştirme commit'ini geri al veya yedek dalı ayrı bir ortamda aç. Git geçmişini yeniden yazmak gerekmez. Geri dönmeden önce yeni uygulamadan güncel JSON yedeğini al. Eski arayüz yeni yerel snapshot'ı okumaz ve yeni yatırım transferlerini bakiyeye katmaz. Yeni dönemde yazılmış verileri eski arayüzde kullanmak gerekiyorsa, JSON'daki koleksiyonları eski tarayıcı anahtarlarına ve transferleri eski kayıt biçimine uyarlamak gerekir. Önce bir test profiliyle doğrula.

## Yerel kontrol

Bir HTTP sunucusuyla proje kökünü aç. Mobil sayfa `index.html`, masaüstü `masaustu.html`. Hesap ve veri bütünlüğü testleri için `node --test` çalıştır.
