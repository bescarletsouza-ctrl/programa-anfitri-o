/* =============================================================================
   Service worker do app de check-in: deixa o app ABRIR sem internet.
   Guarda uma cópia da página, do JS/CSS e das bibliotecas de CDN (leitor de QR, supabase-js, fontes) na primeira
   vez que o app abre COM internet. Depois, sem rede, abre dessa cópia. Com rede, sempre busca a versão nova
   (rede primeiro; se demorar mais de 5 s ou falhar, usa a cópia).
   NÃO mexe em nada do Supabase (dados/login): isso é problema do modo offline do app (fila + cópia local).
   ========================================================================== */
const CACHE = "we-checkin-v1";

const CDN = ["cdnjs.cloudflare.com", "esm.sh", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];
// bibliotecas que o app só pede mais tarde (ex.: QR da etiqueta) — já deixa guardadas
const PRE = [
  "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRE.map((u) =>
    fetch(new Request(u, { mode: "no-cors" })).then((r) => c.put(u, r)).catch(() => {})))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE && n.startsWith("we-checkin-")).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

const doApp = (url) =>
  url.origin === self.location.origin &&
  (url.pathname === "/checkin-app.html" || url.pathname.startsWith("/assets/") || url.pathname === "/manifest.webmanifest");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!doApp(url) && !CDN.includes(url.hostname)) return;   // Supabase e o resto passam direto
  e.respondWith(redeOuCopia(req));
});

function limite(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error("tempo esgotado")), ms)); }

async function redeOuCopia(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), limite(5000)]);
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (erro) {
    // sem rede (ou rede muito lenta): usa a cópia; a página com ?evento=… cai na mesma cópia
    const copia = await cache.match(req, { ignoreSearch: true });
    if (copia) return copia;
    throw erro;
  }
}
