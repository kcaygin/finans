const cacheName = 'kelo-finans-shell-v1';
const files = ['index.html', 'masaustu.html', 'finance-core.js', 'refresh.css', 'manifest.webmanifest',
  'assets/portfolio-hero.jpg', 'assets/app-icon-192.png', 'assets/app-icon-512.png'];
const scope = self.registration.scope;
const appFiles = new Set(files.map(path=>new URL(path,scope).href));

self.addEventListener('install', event=>{
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll([...appFiles])));
});

self.addEventListener('activate', event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys
    .filter(key=>key.startsWith('kelo-finans-shell-') && key!==cacheName)
    .map(key=>caches.delete(key)))));
});

self.addEventListener('fetch', event=>{
  const request = event.request;
  const url = new URL(request.url);
  url.search = '';
  if(url.href===scope) url.pathname += 'index.html';
  if(request.method!=='GET' || !appFiles.has(url.href)) return;
  event.respondWith(fetch(request).then(async response=>{
    if(response.ok){
      const cache = await caches.open(cacheName);
      await cache.put(url.href,response.clone());
    }
    return response;
  }).catch(async ()=>await caches.match(url.href,{cacheName}) || Response.error()));
});
