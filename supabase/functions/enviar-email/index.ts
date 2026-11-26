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

// HTML de e-mail: tabelas e estilos na própria tag, que é o que os programas de e-mail respeitam
export function htmlComprovante(d: {
  evento: string; nome: string; categoria: string; codigo: string; data: string; local: string;
  mensagem: string; info: string; imagem: string; qrSrc: string;
}) {
  const linha = (rotulo: string, valor: string) => valor
    ? `<tr><td style="padding:8px 0;border-bottom:1px solid #ececf0;font-size:12px;color:#6b6b76;text-transform:uppercase;letter-spacing:.06em;vertical-align:top;width:34%">${rotulo}</td>`
      + `<td style="padding:8px 0;border-bottom:1px solid #ececf0;font-size:15px;color:#14141a;font-weight:600">${paragrafos(valor)}</td></tr>`
    : "";
  const topo = /^https:\/\/\S+$/i.test(d.imagem || "")
    ? `<tr><td><img src="${escHtml(d.imagem)}" alt="${escHtml(d.evento)}" width="560" style="display:block;width:100%;height:auto;border:0"></td></tr>`
    : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f2f5;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
${topo}
<tr><td style="background:#14141a;padding:22px 28px">
<div style="font-size:12px;color:#b9b4ff;letter-spacing:.1em;text-transform:uppercase">Comprovante de inscrição</div>
<div style="font-size:22px;color:#ffffff;font-weight:bold;margin-top:4px">${escHtml(d.evento)}</div></td></tr>
<tr><td style="padding:24px 28px 6px">
<div style="font-size:17px;color:#14141a;font-weight:bold">Olá, ${escHtml(d.nome)}!</div>
${d.mensagem ? `<div style="font-size:15px;line-height:1.6;color:#3b3b45;margin-top:8px">${paragrafos(d.mensagem)}</div>` : ""}</td></tr>
<tr><td style="padding:10px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${linha("Participante", d.nome)}${linha("Categoria", d.categoria)}${linha("Código", d.codigo)}${linha("Data", d.data)}${linha("Local", d.local)}
</table></td></tr>
<tr><td align="center" style="padding:22px 28px 6px">
<img src="${d.qrSrc}" alt="QR Code da inscrição ${escHtml(d.codigo)}" width="220" height="220" style="display:block;width:220px;height:220px;border:1px solid #ececf0;border-radius:10px">
<div style="font-size:13px;color:#6b6b76;margin-top:10px">Apresente este QR Code no credenciamento.</div>
${d.codigo ? `<div style="font-size:14px;color:#14141a;font-weight:bold;letter-spacing:.08em;margin-top:4px">${escHtml(d.codigo)}</div>` : ""}</td></tr>
${d.info ? `<tr><td style="padding:18px 28px 0"><div style="background:#f6f5ff;border-radius:10px;padding:14px 16px;font-size:14px;line-height:1.6;color:#2b2b36">${paragrafos(d.info)}</div></td></tr>` : ""}
<tr><td style="padding:20px 28px 26px;font-size:12px;line-height:1.5;color:#8a8a94">Este comprovante é pessoal. Se a imagem do QR Code não aparecer, toque em "exibir imagens" no seu e-mail ou informe o código no credenciamento.</td></tr>
</table></td></tr></table></body></html>`;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const POR_CHAMADA = 50;   // comprovantes por chamada (a tela divide em blocos)

// quem recebe o comprovante: nunca Desativado; não confirmados só se pedido
export function quemRecebeComprovante<T extends { situacao?: string | null }>(parts: T[], incluirNaoConfirmados: boolean) {
  return parts.filter((p) => {
    const s = p.situacao || "Confirmado";
    return s !== "Desativado" && (incluirNaoConfirmados || s === "Confirmado");
  });
}

type Pessoa = { id: string; nome: string; email: string; codigo: string | null; situacao: string | null; ingresso: string | null; tipo: string | null };

// monta o comprovante de UMA pessoa: { assunto, html, qr (PNG em base64) }
export async function montarComprovante(
  p: Pessoa, evento: { nome?: string | null; data_evento?: string | null; local?: string | null },
  pedido: { assunto: string; mensagem?: string; data?: string; local?: string; info?: string; imagem?: string }, qrSrc?: string,
) {
  const nomeEvento = evento?.nome || "";
  const vars = { nome: p.nome || "", codigo: p.codigo || "", email: p.email || "" };
  const qr = await qrPngBase64(String(p.codigo || p.id));
  const html = htmlComprovante({
    evento: nomeEvento,
    nome: p.nome || "",
    categoria: p.ingresso || p.tipo || "",
    codigo: p.codigo || "",
    data: pedido.data ?? dataBR(evento?.data_evento),
    local: pedido.local ?? (evento?.local || ""),
    mensagem: preencher(pedido.mensagem || "", vars, nomeEvento),
    info: preencher(pedido.info || "", vars, nomeEvento),
    imagem: pedido.imagem || "",
    qrSrc: qrSrc || `data:image/png;base64,${qr}`,
  });
  return { assunto: preencher(pedido.assunto, vars, nomeEvento), html, qr };
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
      const m = await montarComprovante(p, evento, pedido, "cid:qrcode");
      const corpo = JSON.stringify({
        from: cfg.de, to: [p.email], subject: m.assunto, html: m.html,
        ...(cfg.responder ? { reply_to: cfg.responder } : {}),
        attachments: [{ content: m.qr, filename: "qrcode.png", content_type: "image/png", content_id: "qrcode" }],
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
        return json({ previa: true, assunto: m.assunto, para: p.email || "", html: m.html });
      }
      const recebem = quemRecebeComprovante(alvos, pedido.incluir_nao_confirmados === true);
      const r = await enviarComprovantes(recebem, ev || {}, pedido, { chave: RESEND!, de: FROM!, responder: RESPONDER });
      return json({ ...r, total: recebem.length, ignorados: alvos.length - recebem.length });
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
