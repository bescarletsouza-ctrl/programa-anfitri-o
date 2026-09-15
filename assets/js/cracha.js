// =============================================================================
// Crachá / etiqueta imprimível do participante. O layout (linhas, tamanhos e
// dimensões) vem de eventos.cracha_config; sem config usa CRACHA_PADRAO.
// Campos obrigatórios (a UI não deixa desligar): evento, nome, categoria.
// =============================================================================
import { esc } from "./ui.js";
import { getEvento } from "./supabase.js";
import { eventoId } from "./evento.js";

const QR_SRC = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
let qrPronto = null;
let eventoCache = null;

export const CRACHA_PADRAO = {
  largura_mm: 90,
  altura_mm: 55,
  qr: true,
  linhas: [
    { campo: "evento", tam: 13, on: true },
    { campo: "nome", tam: 34, on: true },
    { campo: "categoria", tam: 18, on: true },
    { campo: "texto", texto: "", tam: 13, on: false },
    { campo: "empresa", tam: 13, on: false },
    { campo: "email", tam: 13, on: false },
    { campo: "telefone", tam: 13, on: false },
    { campo: "codigo", tam: 13, on: true },
  ],
};

export const TAMANHOS_CRACHA = [
  { valor: 13, rotulo: "Pequeno" },
  { valor: 18, rotulo: "Médio" },
  { valor: 24, rotulo: "Grande" },
  { valor: 34, rotulo: "Muito grande" },
];

// px de fallback → preset mais próximo (configs antigas ou fora da escala)
export const snapTamanho = (px) =>
  TAMANHOS_CRACHA.reduce((a, b) => (Math.abs(b.valor - px) < Math.abs(a.valor - px) ? b : a)).valor;

function carregarQR() {
  if (qrPronto) return qrPronto;
  qrPronto = new Promise((resolve) => {
    if (typeof window.qrcode === "function") return resolve(window.qrcode);
    const s = document.createElement("script");
    s.src = QR_SRC;
    s.onload = () => resolve(typeof window.qrcode === "function" ? window.qrcode : null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return qrPronto;
}

// gera um data URI (GIF) do QR — qrcode-generator é síncrono
export async function qrDataURL(texto) {
  try {
    const qrcode = await carregarQR();
    if (!qrcode || !texto) return null;
    const qr = qrcode(0, "M");
    qr.addData(String(texto));
    qr.make();
    return qr.createDataURL(6, 8);
  } catch {
    return null;
  }
}

function garantirCaixa() {
  let box = document.getElementById("cracha");
  if (!box) {
    box = document.createElement("div");
    box.id = "cracha";
    box.hidden = true;
    document.body.appendChild(box);
  }
  return box;
}

// participante: { nome, empresa, email, telefone, tipo, ingresso, codigo }
// qrUri: data URI já gerado (ou null). config: cracha_config.
export function montarCrachaHtml(participante, nomeEvento = "", config = CRACHA_PADRAO, qrUri = null) {
  const cfg = { ...CRACHA_PADRAO, ...(config || {}) };
  const p = participante || {};
  const categoria = p.ingresso || p.tipo || "";
  const valor = (campo, linha) => ({
    evento: nomeEvento,
    nome: p.nome,
    categoria,
    empresa: p.empresa,
    email: p.email,
    telefone: p.telefone,
    codigo: p.codigo,
    texto: linha?.texto,
  }[campo] || "");
  const classe = { evento: "cracha-evento", nome: "cracha-nome", categoria: "cracha-tipo", codigo: "cracha-codigo" };

  const linhas = (cfg.linhas || CRACHA_PADRAO.linhas).filter((l) => l.on !== false);
  const antesCodigo = linhas.filter((l) => l.campo !== "codigo");
  const linhaCodigo = linhas.find((l) => l.campo === "codigo");
  const temQr = cfg.qr !== false;

  const linhaHtml = (l) => {
    const v = valor(l.campo, l);
    if (!v) return "";
    return `<div class="${classe[l.campo] || "cracha-linha"}" style="font-size:${Number(l.tam) || 14}px">${esc(v)}</div>`;
  };

  // Layout: bloco de texto no canto superior esquerdo, QR fixo no canto
  // inferior direito (posição absoluta via CSS).
  return `<div class="cracha-cartao ${temQr ? "tem-qr" : ""}" style="width:${Number(cfg.largura_mm) || 90}mm;min-height:${Number(cfg.altura_mm) || 55}mm">
    <div class="cracha-texto">
      ${antesCodigo.map(linhaHtml).join("")}
      ${linhaCodigo ? linhaHtml(linhaCodigo) : ""}
    </div>
    ${temQr
      ? `<div class="cracha-qr">${qrUri
          ? `<img src="${qrUri}" alt="QR ${esc(p.codigo || "")}" />`
          : `<div class="cracha-semqr">${esc(p.codigo || "")}</div>`}</div>`
      : ""}
  </div>`;
}

async function carregarConfig() {
  if (eventoCache) return eventoCache;
  try { eventoCache = await getEvento(eventoId()); } catch { eventoCache = {}; }
  return eventoCache;
}
export function limparConfigCracha() { eventoCache = null; }

export async function imprimirCracha(participante, nomeEvento = "") {
  const ev = await carregarConfig();
  const config = ev?.cracha_config || CRACHA_PADRAO;
  const nome = nomeEvento || ev?.nome || "";
  const box = garantirCaixa();
  const larg = Number(config.largura_mm) || 90;
  const alt = Number(config.altura_mm) || 55;
  const uri = config.qr !== false ? await qrDataURL(participante.codigo || participante.id || "") : null;

  document.getElementById("cracha-page-style")?.remove();
  const st = document.createElement("style");
  st.id = "cracha-page-style";
  st.textContent = `
    @media print {
      @page { size: ${larg}mm ${alt}mm; margin: 0; }
      html, body { width: ${larg}mm; height: ${alt}mm; margin: 0 !important; padding: 0 !important; background: #fff !important; }
      body > *:not(#cracha) { display: none !important; }
      #cracha { position: static !important; inset: auto !important; display: block !important; margin: 0 !important; padding: 0 !important; }
      #cracha .cracha-cartao {
        width: ${larg}mm !important; height: ${alt}mm !important; min-height: 0 !important;
        margin: 0 !important; border: none !important; border-radius: 0 !important;
        overflow: hidden !important; page-break-inside: avoid; page-break-after: avoid;
      }
    }`;
  document.head.appendChild(st);

  box.innerHTML = montarCrachaHtml(participante, nome, config, uri);
  box.hidden = false;

  // garante que a imagem do QR já decodificou antes de abrir a impressão
  const img = box.querySelector(".cracha-qr img");
  if (img && !img.complete) {
    await new Promise((res) => { img.onload = img.onerror = res; setTimeout(res, 700); });
  }
  try { await img?.decode?.(); } catch {}

  const limpar = () => { box.hidden = true; window.removeEventListener("afterprint", limpar); };
  window.addEventListener("afterprint", limpar);
  window.print();
  setTimeout(limpar, 1000);
}
