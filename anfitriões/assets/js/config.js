// =============================================================================
// Programa Anfitrião — configuração
// Preencha SUPABASE_URL e SUPABASE_ANON_KEY com os dados do seu projeto Supabase
// (Studio → Settings → API). A chave "anon" é pública por design — a segurança
// vem das policies de RLS (ver supabase/migrations/0001_init.sql).
// =============================================================================

export const SUPABASE_URL = "https://xiuhqkvkiexmbgwyvunr.supabase.co";
// Chave "publishable" (sb_publishable_...) ou "anon public" (eyJ...) — NUNCA a secret.
export const SUPABASE_ANON_KEY = "sb_publishable_lN_V-9dOHmzuwtszglhG3g_Skk0SIaC";

// Textos e rótulos do produto — trocar aqui reflete em todo o admin.
export const APP = {
  nomeProduto: "Programa Anfitrião",
  // usado no wordmark: a parte em <b> fica laranja
  marcaHtml: 'Programa <b>Anfitrião</b>',
  termoAnfitriao: "Anfitrião",
  termoAnfitriaoPlural: "Anfitriões",
  termoConvidado: "Convidado",
  termoConvidadoPlural: "Convidados",
  // base para os links gerados na gaveta do anfitrião (fase pública)
  urlConvitePublico: "/convite.html",
  urlPainelAnfitriao: "/painel.html",
};

export const STATUS_CONVIDADO = ["Pendente", "Aprovado", "Recusado", "Confirmado"];

export const TIPOS_ANFITRIAO = ["Titular", "Cônjuge", "Acompanhante", "Sócio", "Outro"];

export const TIPOS_PERGUNTA = [
  { valor: "texto", rotulo: "Texto curto" },
  { valor: "textarea", rotulo: "Texto longo" },
  { valor: "email", rotulo: "E-mail" },
  { valor: "telefone", rotulo: "Telefone / WhatsApp" },
  { valor: "url", rotulo: "Site / URL" },
  { valor: "selecao", rotulo: "Múltipla escolha" },
];
