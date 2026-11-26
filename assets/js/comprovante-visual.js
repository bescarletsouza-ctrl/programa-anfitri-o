// =============================================================================
// Painel "Identidade visual" do comprovante de inscrição: logo, imagem do topo, cores e fonte.
// As imagens são REDUZIDAS aqui no navegador antes de guardar (e-mail leve, banco leve).
// O HTML do e-mail em si é montado na Edge Function "enviar-email".
// =============================================================================
import { esc, toast } from "./ui.js";

export const VISUAL_PADRAO = { cabecalho: "#14141a", destaque: "#7c5cff", fundo: "#f2f2f5", cartao: "#ffffff", fonte: "arial", logo: null, topo: null };

const CORES = [
  ["cabecalho", "Faixa do título"], ["destaque", "Cor de destaque"], ["fundo", "Fundo do e-mail"], ["cartao", "Fundo do comprovante"],
];
const FONTES = [["arial", "Arial"], ["verdana", "Verdana"], ["tahoma", "Tahoma"], ["trebuchet", "Trebuchet"], ["georgia", "Georgia (com serifa)"]];

// logo: PNG (mantém fundo transparente) · topo: JPG. "peso" = tamanho máximo guardado (em caracteres)
const REGRAS = {
  logo: { tipo: "image/png", largura: 480, altura: 128, peso: 120000 },
  topo: { tipo: "image/jpeg", largura: 1120, altura: 700, peso: 300000 },
};
const ARQUIVO_MAX = 10 * 1024 * 1024;

export async function reduzirImagem(arquivo, qual) {
  const regra = REGRAS[qual];
  if (!/^image\/(png|jpe?g|webp)$/i.test(arquivo.type || "")) throw new Error("Use uma imagem PNG, JPG ou WEBP.");
  if (arquivo.size > ARQUIVO_MAX) throw new Error("Imagem muito grande: use um arquivo de até 10 MB.");
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new Error("Não consegui abrir essa imagem."); }
    let escala = Math.min(1, regra.largura / img.naturalWidth, regra.altura / img.naturalHeight);
    let qualidade = 0.85;
    for (let tentativa = 0; tentativa < 14; tentativa++) {
      const tela = document.createElement("canvas");
      tela.width = Math.max(1, Math.round(img.naturalWidth * escala));
      tela.height = Math.max(1, Math.round(img.naturalHeight * escala));
      const ctx = tela.getContext("2d");
      if (regra.tipo === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, tela.width, tela.height); }
      ctx.drawImage(img, 0, 0, tela.width, tela.height);
      const dados = tela.toDataURL(regra.tipo, qualidade);
      if (dados.length <= regra.peso) return { dados, largura: tela.width, altura: tela.height };
      if (regra.tipo === "image/jpeg" && qualidade > 0.55) qualidade -= 0.1;
      else escala *= 0.82;
    }
    throw new Error("Não consegui deixar a imagem leve o bastante. Tente outra.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const campoImagem = (qual, titulo, dica) => `
  <div class="campo" style="margin-bottom:10px"><span>${titulo}</span>
    <input class="input" type="file" accept="image/png,image/jpeg,image/webp" data-img="${qual}" aria-label="${titulo}" />
    <small class="pagina-sub" style="margin:4px 0 0;display:block">${dica}</small>
    <div data-img-atual="${qual}" style="margin-top:6px" hidden>
      <img alt="" style="max-width:100%;max-height:70px;border:1px solid var(--borda);border-radius:8px;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/14px 14px" />
      <button type="button" class="btn btn-fantasma btn-sm" data-img-remover="${qual}">Remover</button>
    </div>
  </div>`;

export const painelVisualHtml = () => `
  <details data-visual open style="border:1px solid var(--borda);border-radius:12px;padding:12px 14px;margin-bottom:14px">
    <summary style="cursor:pointer;font-weight:650;margin-bottom:10px">Identidade visual</summary>
    ${campoImagem("logo", "Logo", "Aparece na faixa do título. De preferência PNG com fundo transparente.")}
    ${campoImagem("topo", "Imagem do topo (banner)", "Opcional. Fica no alto do e-mail, na largura toda. Ideal: 1120 × 400.")}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${CORES.map(([chave, rotulo]) => `<label class="campo" style="margin-bottom:6px"><span>${rotulo}</span>
        <span style="display:flex;gap:6px;margin:0">
          <input type="color" data-cor="${chave}" value="${VISUAL_PADRAO[chave]}" style="width:46px;height:38px;padding:2px;border:1px solid var(--borda);border-radius:8px;background:none;flex:none" />
          <input class="input" data-cor-texto="${chave}" value="${VISUAL_PADRAO[chave]}" maxlength="7" aria-label="${rotulo}: código da cor" style="min-width:0" />
        </span></label>`).join("")}
    </div>
    <label class="campo"><span>Fonte</span>
      <select class="select" data-fonte>${FONTES.map(([v, r]) => `<option value="${v}">${esc(r)}</option>`).join("")}</select></label>
    <button type="button" class="btn btn-fantasma btn-sm" data-cores-padrao>Voltar às cores padrão</button>
  </details>`;

// liga o painel; devolve { ler(), aplicar(visual), mexido() }
export function montarPainelVisual(root) {
  const painel = root.querySelector("[data-visual]");
  let visual = { ...VISUAL_PADRAO };
  let mexeu = false;

  const mostrar = () => {
    CORES.forEach(([chave]) => {
      painel.querySelector(`[data-cor="${chave}"]`).value = visual[chave];
      painel.querySelector(`[data-cor-texto="${chave}"]`).value = visual[chave];
    });
    painel.querySelector("[data-fonte]").value = visual.fonte;
    ["logo", "topo"].forEach((qual) => {
      const caixa = painel.querySelector(`[data-img-atual="${qual}"]`);
      caixa.hidden = !visual[qual];
      if (visual[qual]) caixa.querySelector("img").src = visual[qual].dados;
    });
  };

  CORES.forEach(([chave]) => {
    const seletor = painel.querySelector(`[data-cor="${chave}"]`);
    const texto = painel.querySelector(`[data-cor-texto="${chave}"]`);
    seletor.oninput = () => { visual[chave] = seletor.value; texto.value = seletor.value; mexeu = true; };
    texto.onchange = () => {   // dá pra colar o código da marca, com ou sem "#"
      const v = "#" + texto.value.trim().replace(/^#/, "").toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(v)) { visual[chave] = v; mexeu = true; }
      else toast("Código de cor inválido. Use 6 caracteres, como #7c5cff.", "erro");
      mostrar();
    };
  });
  painel.querySelector("[data-fonte]").onchange = (e) => { visual.fonte = e.target.value; mexeu = true; };
  painel.querySelector("[data-cores-padrao]").onclick = () => {
    CORES.forEach(([chave]) => { visual[chave] = VISUAL_PADRAO[chave]; });
    visual.fonte = VISUAL_PADRAO.fonte;
    mexeu = true;
    mostrar();
  };
  painel.querySelectorAll("[data-img]").forEach((input) => {
    input.onchange = async () => {
      const arquivo = input.files?.[0];
      if (!arquivo) return;
      try { visual[input.dataset.img] = await reduzirImagem(arquivo, input.dataset.img); mexeu = true; mostrar(); }
      catch (e) { toast(e.message || "Não foi possível usar essa imagem.", "erro"); }
      input.value = "";
    };
  });
  painel.querySelectorAll("[data-img-remover]").forEach((b) => {
    b.onclick = () => { visual[b.dataset.imgRemover] = null; mexeu = true; mostrar(); };
  });

  mostrar();
  return {
    ler: () => ({ ...visual }),
    aplicar: (v) => { visual = { ...VISUAL_PADRAO, ...(v || {}) }; mostrar(); },
    mexido: () => mexeu,
  };
}
