// =============================================================================
// Edge Function: enviar-email
// Dispara e-mail para participantes de um evento via Resend.
// O admin manda só os IDs; a função busca os e-mails no banco (service role) e
// personaliza {nome}/{codigo}/{email}/{evento}.
//   • mensagem personalizada: texto livre, em lotes de 100;
//   • modelo "comprovante": comprovante de inscrição com o QR Code da pessoa (o mesmo do crachá, que o app
//     de check-in lê). Vai um a um, porque o envio em lote do Resend não aceita anexo. Nunca vai pra quem está
//     Desativado; quem não está Confirmado só recebe se for pedido. previa:true monta o e-mail sem enviar.
// Secret opcional: EMAIL_REPLY_TO (para onde vão as respostas).
//
// Auth: exige o JWT do usuário logado e reaproveita a RLS da tabela "eventos"
// pra confirmar que ele tem acesso àquele evento (mesmo padrão de
// integracoes/index.ts) — a chave anon/publishable sozinha não prova nada,
// porque é pública por design (fica no config.js do site).
//
// Deploy:
//   supabase functions deploy enviar-email
// Secrets (Studio → Edge Functions → enviar-email → Secrets, ou CLI):
//   supabase secrets set RESEND_API_KEY=re_xxx EMAIL_FROM="Evento <no-reply@seu-dominio.com>"
// O domínio do EMAIL_FROM precisa estar verificado no Resend.
// =============================================================================
// "npm:" é resolvido pelo próprio Supabase (o esm.sh às vezes dá timeout no deploy) — mesmo ajuste da webhook-in.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import qrcode from "npm:qrcode-generator@1.4.4";   // a mesma biblioteca que desenha o QR do crachá no app

/* ---- QR Code em PNG, gerado aqui (nenhum dado vai pra site de QR) ------------------------------------- */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const int32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const juntar = (...p: Uint8Array[]) => {
  const out = new Uint8Array(p.reduce((s, a) => s + a.length, 0));
  let i = 0;
  for (const a of p) { out.set(a, i); i += a.length; }
  return out;
};
const pedacoPng = (tipo: string, dados: Uint8Array) => {
  const corpo = juntar(new TextEncoder().encode(tipo), dados);
  return juntar(int32(dados.length), corpo, int32(crc32(corpo)));
};

// PNG em tons de cinza, 8 px por quadradinho e margem branca de 4 (o leitor precisa dela)
export async function qrPngBase64(texto: string): Promise<string> {
  const qr = qrcode(0, "M");
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount(), px = 8, margem = 4;
  const lado = (n + margem * 2) * px;
  const linhas = new Uint8Array((lado + 1) * lado);        // 1 byte de filtro (0) no começo de cada linha
  for (let y = 0; y < lado; y++) {
    const r = Math.floor(y / px) - margem;
    for (let x = 0; x < lado; x++) {
      const c = Math.floor(x / px) - margem;
      const preto = r >= 0 && r < n && c >= 0 && c < n && qr.isDark(r, c);
      linhas[y * (lado + 1) + 1 + x] = preto ? 0 : 255;
    }
  }
  const comprimido = new Uint8Array(await new Response(
    new Blob([linhas]).stream().pipeThrough(new CompressionStream("deflate")),
  ).arrayBuffer());
  const png = juntar(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pedacoPng("IHDR", juntar(int32(lado), int32(lado), new Uint8Array([8, 0, 0, 0, 0]))),
    pedacoPng("IDAT", comprimido),
    pedacoPng("IEND", new Uint8Array(0)),
  );
  let bin = "";
  for (let i = 0; i < png.length; i += 0x8000) bin += String.fromCharCode(...png.subarray(i, i + 0x8000));
  return btoa(bin);
}

/* ---- Modelo do comprovante --------------------------------------------------------------------------- */
const escHtml = (t: unknown) =>
  String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paragrafos = (t: unknown) => escHtml(t).replace(/\r?\n/g, "<br>");

// 2026-12-03 → 03/12/2026 (sem passar por fuso)
export const dataBR = (d: unknown) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

/* ---- Identidade visual (escolhida na tela; aqui tudo é conferido antes de entrar no e-mail) ------------- */
export const FONTES: Record<string, string> = {
  arial: "Arial,Helvetica,sans-serif",
  verdana: "Verdana,Geneva,sans-serif",
  tahoma: "Tahoma,Geneva,sans-serif",
  trebuchet: "'Trebuchet MS',Tahoma,sans-serif",
  georgia: "Georgia,'Times New Roman',serif",
};
export const VISUAL_PADRAO = { cabecalho: "#14141a", destaque: "#7c5cff", fundo: "#f2f2f5", cartao: "#ffffff", fonte: "arial" };
const IMAGEM_MAX = 450000;   // caracteres do data URL (a tela já reduz a imagem antes)

export type Imagem = { dados: string; largura: number; altura: number };
export type Visual = {
  cabecalho: string; destaque: string; fundo: string; cartao: string; fonte: string;
  logo: Imagem | null; topo: Imagem | null;
};

export function visualSeguro(v: any): Visual {
  const cor = (c: unknown, padrao: string) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? String(c).toLowerCase() : padrao);
  const imagem = (i: any): Imagem | null => {
    const dados = String(i?.dados || "");
    const largura = Math.round(Number(i?.largura)), altura = Math.round(Number(i?.altura));
    return dados.length <= IMAGEM_MAX && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(dados) && largura > 0 && altura > 0
      ? { dados, largura, altura } : null;
  };
  return {
    cabecalho: cor(v?.cabecalho, VISUAL_PADRAO.cabecalho),
    destaque: cor(v?.destaque, VISUAL_PADRAO.destaque),
    fundo: cor(v?.fundo, VISUAL_PADRAO.fundo),
    cartao: cor(v?.cartao, VISUAL_PADRAO.cartao),
    fonte: Object.hasOwn(FONTES, String(v?.fonte)) ? String(v.fonte) : VISUAL_PADRAO.fonte,
    logo: imagem(v?.logo),
    topo: imagem(v?.topo),
  };
}

// contas de cor pra o texto continuar legível em cima de qualquer cor escolhida
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const luz = (h: string) => {
  const [r, g, b] = rgb(h).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contraste = (a: string, b: string) => (Math.max(luz(a), luz(b)) + 0.05) / (Math.min(luz(a), luz(b)) + 0.05);
const sobre = (fundo: string) => (contraste(fundo, "#ffffff") >= contraste(fundo, "#14141a") ? "#ffffff" : "#14141a");
// mistura a com b (t = quanto de b)
const misturar = (a: string, b: string, t: number) =>
  "#" + rgb(a).map((c, i) => Math.round(c * (1 - t) + rgb(b)[i] * t).toString(16).padStart(2, "0")).join("");

// HTML de e-mail: tabelas e estilos na própria tag, que é o que os programas de e-mail respeitam
export function htmlComprovante(d: {
  evento: string; nome: string; categoria: string; codigo: string; data: string; local: string;
  mensagem: string; info: string; imagem: string; qrSrc: string; logoSrc?: string; visual?: Visual;
}) {
  const v = d.visual || visualSeguro(null);
  const texto = sobre(v.cartao);
  const suave = misturar(texto, v.cartao, 0.3);
  const risco = misturar(texto, v.cartao, 0.9);
  const rotuloCor = contraste(v.destaque, v.cartao) >= 3 ? v.destaque : suave;
  const topoTexto = sobre(v.cabecalho);
  const topoRotulo = contraste(v.destaque, v.cabecalho) >= 3 ? v.destaque : misturar(topoTexto, v.cabecalho, 0.2);
  const caixa = misturar(v.cartao, v.destaque, 0.1);
  const linha = (rotulo: string, valor: string) => valor
    ? `<tr><td style="padding:8px 0;border-bottom:1px solid ${risco};font-size:12px;color:${rotuloCor};text-transform:uppercase;letter-spacing:.06em;vertical-align:top;width:34%">${rotulo}</td>`
      + `<td style="padding:8px 0;border-bottom:1px solid ${risco};font-size:15px;color:${texto};font-weight:600">${paragrafos(valor)}</td></tr>`
    : "";
  const topo = /^(https:\/\/\S+|cid:topo|data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+)$/i.test(d.imagem || "")
    ? `<tr><td><img src="${escHtml(d.imagem)}" alt="${escHtml(d.evento)}" width="560" style="display:block;width:100%;height:auto;border:0"></td></tr>`
    : "";
  let logo = "";
  if (d.logoSrc && v.logo) {   // logo com no máximo 64 de altura e 240 de largura, na proporção certa
    let altura = Math.min(64, v.logo.altura), largura = v.logo.largura * altura / v.logo.altura;
    if (largura > 240) { largura = 240; altura = v.logo.altura * 240 / v.logo.largura; }
    logo = `<img src="${escHtml(d.logoSrc)}" alt="Logo" width="${Math.round(largura)}" height="${Math.round(altura)}" style="display:block;border:0;width:${Math.round(largura)}px;height:${Math.round(altura)}px;margin-bottom:14px">`;
  }
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${v.fundo};font-family:${FONTES[v.fonte]}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${v.fundo};font-family:${FONTES[v.fonte]}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:${v.cartao};border-radius:14px;overflow:hidden">
${topo}
<tr><td style="background:${v.cabecalho};padding:22px 28px">
${logo}<div style="font-size:12px;color:${topoRotulo};letter-spacing:.1em;text-transform:uppercase">Comprovante de inscrição</div>
<div style="font-size:22px;color:${topoTexto};font-weight:bold;margin-top:4px">${escHtml(d.evento)}</div></td></tr>
<tr><td style="height:4px;background:${v.destaque};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:22px 28px 6px">
<div style="font-size:17px;color:${texto};font-weight:bold">Olá, ${escHtml(d.nome)}!</div>
${d.mensagem ? `<div style="font-size:15px;line-height:1.6;color:${suave};margin-top:8px">${paragrafos(d.mensagem)}</div>` : ""}</td></tr>
<tr><td style="padding:10px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${linha("Participante", d.nome)}${linha("Categoria", d.categoria)}${linha("Código", d.codigo)}${linha("Data", d.data)}${linha("Local", d.local)}
</table></td></tr>
<tr><td align="center" style="padding:22px 28px 6px">
<img src="${d.qrSrc}" alt="QR Code da inscrição ${escHtml(d.codigo)}" width="220" height="220" style="display:block;width:220px;height:220px;background:#ffffff;border:6px solid #ffffff;border-radius:10px">
<div style="font-size:13px;color:${suave};margin-top:10px">Apresente este QR Code no credenciamento.</div>
${d.codigo ? `<div style="font-size:14px;color:${texto};font-weight:bold;letter-spacing:.08em;margin-top:4px">${escHtml(d.codigo)}</div>` : ""}</td></tr>
${d.info ? `<tr><td style="padding:18px 28px 0"><div style="background:${caixa};border-left:4px solid ${v.destaque};border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.6;color:${sobre(caixa)}">${paragrafos(d.info)}</div></td></tr>` : ""}
<tr><td style="padding:20px 28px 26px;font-size:12px;line-height:1.5;color:${suave}">Este comprovante é pessoal. Se a imagem do QR Code não aparecer, toque em "exibir imagens" no seu e-mail ou informe o código no credenciamento.</td></tr>
</table></td></tr></table></body></html>`;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const POR_CHAMADA = 50;   // comprovantes por chamada (a tela divide em blocos)
export const VERSAO_COMPROVANTE = 2;   // 2 = com identidade visual (a tela confere antes de enviar)

// quem recebe o comprovante: nunca Desativado; não confirmados só se pedido
export function quemRecebeComprovante<T extends { situacao?: string | null }>(parts: T[], incluirNaoConfirmados: boolean) {
  return parts.filter((p) => {
    const s = p.situacao || "Confirmado";
    return s !== "Desativado" && (incluirNaoConfirmados || s === "Confirmado");
  });
}

type Pessoa = { id: string; nome: string; email: string; codigo: string | null; situacao: string | null; ingresso: string | null; tipo: string | null };

// monta o comprovante de UMA pessoa: { assunto, html, anexos }
// paraEnvio: as imagens vão como anexos "cid:" dentro do e-mail; na prévia vão embutidas no próprio HTML
export async function montarComprovante(
  p: Pessoa, evento: { nome?: string | null; data_evento?: string | null; local?: string | null },
  pedido: { assunto: string; mensagem?: string; data?: string; local?: string; info?: string; imagem?: string; visual?: unknown },
  paraEnvio = false,
) {
  const nomeEvento = evento?.nome || "";
  const vars = { nome: p.nome || "", codigo: p.codigo || "", email: p.email || "" };
  const qr = await qrPngBase64(String(p.codigo || p.id));
  const visual = visualSeguro(pedido.visual);
  const anexos = [{ content: qr, filename: "qrcode.png", content_type: "image/png", content_id: "qrcode" }];
  const fonteDe = (img: Imagem | null, cid: string) => {
    if (!img) return "";
    if (!paraEnvio) return img.dados;
    const tipo = img.dados.slice(5, img.dados.indexOf(";"));
    anexos.push({ content: img.dados.slice(img.dados.indexOf(",") + 1), filename: `${cid}.${tipo === "image/png" ? "png" : "jpg"}`, content_type: tipo, content_id: cid });
    return `cid:${cid}`;
  };
  const html = htmlComprovante({
    visual,
    logoSrc: fonteDe(visual.logo, "logo"),
    evento: nomeEvento,
    nome: p.nome || "",
    categoria: p.ingresso || p.tipo || "",
    codigo: p.codigo || "",
    data: pedido.data ?? dataBR(evento?.data_evento),
    local: pedido.local ?? (evento?.local || ""),
    mensagem: preencher(pedido.mensagem || "", vars, nomeEvento),
    info: preencher(pedido.info || "", vars, nomeEvento),
    imagem: fonteDe(visual.topo, "topo") || (/^https:\/\//i.test(pedido.imagem || "") ? pedido.imagem! : ""),
    qrSrc: paraEnvio ? "cid:qrcode" : `data:image/png;base64,${qr}`,
  });
  return { assunto: preencher(pedido.assunto, vars, nomeEvento), html, anexos };
}

// envia um a um; no "muitas requisições" espera e repete; na cota estourada para e avisa
export async function enviarComprovantes(
  alvos: Pessoa[], evento: Record<string, string | null>, pedido: Parameters<typeof montarComprovante>[2],
  cfg: { chave: string; de: string; responder?: string }, buscar: typeof fetch = fetch, pausa = 150,
) {
  let enviados = 0, limite = false;
  const falhas: { email: string; erro: string }[] = [];
  for (const p of alvos) {
    if (limite) { falhas.push({ email: p.email, erro: "Não enviado: limite de envios do Resend atingido." }); continue; }
    try {
      const m = await montarComprovante(p, evento, pedido, true);
      const corpo = JSON.stringify({
        from: cfg.de, to: [p.email], subject: m.assunto, html: m.html,
        ...(cfg.responder ? { reply_to: cfg.responder } : {}),
        attachments: m.anexos,
      });
      for (let tentativa = 0; ; tentativa++) {
        const r = await buscar("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${cfg.chave}`, "Content-Type": "application/json" }, body: corpo,
        });
        const rj = await r.json().catch(() => ({}));
        if (r.ok) { enviados++; break; }
        const cota = /quota/i.test(`${rj?.name || ""} ${rj?.message || ""}`);
        if (r.status === 429 && !cota && tentativa < 3) {
          await dormir(Math.min(5, Number(r.headers.get("retry-after")) || 1) * 1000);
          continue;
        }
        if (cota) limite = true;
        falhas.push({ email: p.email, erro: rj?.message || `HTTP ${r.status}` });
        break;
      }
    } catch (e) {
      falhas.push({ email: p.email, erro: String((e as Error)?.message || e) });
    }
    await dormir(pausa);
  }
  return { enviados, falhas, limite_atingido: limite };
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

const preencher = (txt: string, p: Record<string, string>, ev: string) =>
  String(txt)
    .replaceAll("{nome}", p.nome || "")
    .replaceAll("{codigo}", p.codigo || "")
    .replaceAll("{email}", p.email || "")
    .replaceAll("{evento}", ev || "");

const htmlBody = (texto: string) => {
  const safe = texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">${safe.replace(/\n/g, "<br>")}</div>`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não suportado." }, 405);

  try {
    const pedido = await req.json();
    const { evento_id, participante_ids, assunto, corpo } = pedido;
    // o comprovante NÃO usa "corpo": assim uma versão antiga desta função recusa o pedido em vez de mandar texto solto
    const comprovante = pedido.modelo === "comprovante";
    if (!evento_id || !Array.isArray(participante_ids) || !participante_ids.length || !assunto || (!comprovante && !corpo))
      return json({ erro: "Dados incompletos." }, 400);
    if (comprovante && !pedido.previa && participante_ids.length > POR_CHAMADA)
      return json({ erro: `Envie no máximo ${POR_CHAMADA} comprovantes por chamada.` }, 400);

    // Autorização real: exige um usuário logado com acesso a este evento.
    // Reaproveita a RLS da tabela "eventos" em vez de só checar a chave
    // anon, que é pública por design e não prova que quem chamou é da
    // organização dona do evento.
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ erro: "Não autorizado." }, 401);
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: evVisivel } = await asUser.from("eventos").select("id").eq("id", evento_id).maybeSingle();
    if (!evVisivel) return json({ erro: "Não autorizado." }, 401);

    const RESEND = Deno.env.get("RESEND_API_KEY");
    // remetente é sempre o secret configurado — não vem do chamador (era um
    // jeito de qualquer pessoa escolher o nome/e-mail exibido no envio)
    const FROM = Deno.env.get("EMAIL_FROM");
    // a prévia não envia nada: dá pra conferir o modelo mesmo sem o Resend configurado
    if (!(comprovante && pedido.previa) && (!RESEND || !FROM))
      return json({ erro: "Configure RESEND_API_KEY e EMAIL_FROM nos secrets da função." }, 500);
    const RESPONDER = (Deno.env.get("EMAIL_REPLY_TO") || "").trim() || undefined;

    const sb = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: parts, error } = await sb
      .from("participantes")
      .select("id, nome, email, codigo, situacao, ingresso, tipo")
      .eq("evento_id", evento_id)
      .in("id", participante_ids.slice(0, 1000));
    if (error) return json({ erro: error.message }, 500);

    const { data: ev } = await sb.from("eventos").select("nome, data_evento, local").eq("id", evento_id).maybeSingle();
    const nomeEvento = ev?.nome || "";

    const alvos = (parts || []).filter((p) => (p.email || "").includes("@"));

    if (comprovante) {
      if (pedido.previa) {
        const p = alvos[0] || (parts || [])[0];
        if (!p) return json({ erro: "Participante não encontrado neste evento." }, 404);
        const m = await montarComprovante(p, ev || {}, pedido);
        return json({ previa: true, versao: VERSAO_COMPROVANTE, assunto: m.assunto, para: p.email || "", html: m.html });
      }
      const recebem = quemRecebeComprovante(alvos, pedido.incluir_nao_confirmados === true);
      const r = await enviarComprovantes(recebem, ev || {}, pedido, { chave: RESEND!, de: FROM!, responder: RESPONDER });
      return json({ ...r, versao: VERSAO_COMPROVANTE, total: recebem.length, ignorados: alvos.length - recebem.length });
    }

    if (!alvos.length) return json({ enviados: 0, falhas: [], total: 0 });

    let enviados = 0;
    const falhas: { email: string; erro: string }[] = [];

    for (let i = 0; i < alvos.length; i += 100) {
      const bloco = alvos.slice(i, i + 100);
      const lote = bloco.map((p) => ({
        from: FROM,
        to: [p.email],
        subject: preencher(assunto, p, nomeEvento),
        html: htmlBody(preencher(corpo, p, nomeEvento)),
        ...(RESPONDER ? { reply_to: RESPONDER } : {}),
      }));
      const r = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify(lote),
      });
      const rj = await r.json().catch(() => ({}));
      if (!r.ok) {
        bloco.forEach((p) => falhas.push({ email: p.email, erro: rj?.message || `HTTP ${r.status}` }));
      } else {
        enviados += Array.isArray(rj?.data) ? rj.data.length : lote.length;
      }
    }

    return json({ enviados, falhas, total: alvos.length });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
