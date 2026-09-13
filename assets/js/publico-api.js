// =============================================================================
// API das páginas públicas — fala com a Edge Function "publico" (que usa a
// service role), para o banco não ficar exposto pela chave anon.
// Usado por convite.js / painel.js / status.js.
// =============================================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const URL_FN = `${SUPABASE_URL}/functions/v1/publico`;

async function chamar(body) {
  const r = await fetch(URL_FN, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.erro) throw new Error(data?.erro || `Erro ${r.status}`);
  return data;
}

// convite.html
export const pubConvite = (slug) => chamar({ acao: "convite", slug });
export const pubExisteEmail = (slug, email) => chamar({ acao: "existe_email", slug, email }).then((r) => r.existe);
export const pubEnviarConvite = (slug, registro) => chamar({ acao: "enviar_convite", slug, registro });

// painel.html
export const pubPainel = (slug) => chamar({ acao: "painel", slug });

// status.html
export const pubStatus = (c) => chamar({ acao: "status", c });
export const pubStatusEmail = (email) => chamar({ acao: "status_email", email });
