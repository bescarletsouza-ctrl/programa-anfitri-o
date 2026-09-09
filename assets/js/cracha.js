// =============================================================================
// Crachá imprimível do participante (nome, empresa, tipo, QR do código).
// Usado pela tela de Check-in e pela gaveta de Participantes.
// O QR codifica o "codigo" curto do participante (ex.: IMER-0042).
// =============================================================================
import { esc } from "./ui.js";

const QR_SRC = "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js";
let qrPronto = null;

function carregarQR() {
  if (qrPronto) return qrPronto;
  qrPronto = new Promise((resolve) => {
    if (window.QRCode) return resolve(window.QRCode);
    const s = document.createElement("script");
    s.src = QR_SRC;
    s.onload = () => resolve(window.QRCode || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return qrPronto;
}

async function qrDataURL(texto) {
  try {
    const QR = await carregarQR();
    if (QR?.toDataURL) return await QR.toDataURL(texto, { width: 240, margin: 1 });
  } catch {}
  return null;
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

// participante: { nome, empresa, tipo, codigo }
export async function imprimirCracha(participante, nomeEvento = "") {
  const box = garantirCaixa();
  const uri = await qrDataURL(participante.codigo || participante.id || "");
  box.innerHTML = `
    <div class="cracha-cartao">
      ${nomeEvento ? `<div class="cracha-evento">${esc(nomeEvento)}</div>` : ""}
      <div class="cracha-nome">${esc(participante.nome || "")}</div>
      ${participante.empresa ? `<div class="cracha-empresa">${esc(participante.empresa)}</div>` : ""}
      <div class="cracha-tipo">${esc(participante.tipo || "")}</div>
      <div class="cracha-qr">
        ${uri
          ? `<img src="${uri}" alt="QR ${esc(participante.codigo || "")}" />`
          : `<div class="cracha-semqr">${esc(participante.codigo || "")}</div>`}
      </div>
      <div class="cracha-codigo">${esc(participante.codigo || "")}</div>
    </div>`;
  box.hidden = false;
  const limpar = () => { box.hidden = true; window.removeEventListener("afterprint", limpar); };
  window.addEventListener("afterprint", limpar);
  window.print();
  // fallback: alguns navegadores não disparam afterprint
  setTimeout(limpar, 800);
}
