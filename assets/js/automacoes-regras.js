// =============================================================================
// Automações — lógica pura (sem DOM, sem banco): catálogo de campos/operadores/
// ações, texto legível de cada regra, validação e modelos prontos.
// Os nomes de campo/operador/ação aqui são EXATAMENTE os da migração 0043
// (auto_cond_ok / auto_aplicar_acoes) — se mudar lá, mude aqui.
// =============================================================================

export const SITUACOES = ["Confirmado", "Pendente", "Fila de espera", "Pré-inscrito", "Desativado"];
export const PAGAMENTOS = ["Gratuito", "Pago", "Convidado", "Externo", "Cancelado", "Reembolsado"];

// kind: lista (valor de uma lista) · texto (livre) · simnao (preenchido/vazio) · usuario
export const CAMPOS = {
  tipo:                { rotulo: "Tipo", kind: "lista" },
  ingresso:            { rotulo: "Categoria (ingresso)", kind: "lista" },
  situacao:            { rotulo: "Situação", kind: "lista" },
  pagamento:           { rotulo: "Pagamento", kind: "lista" },
  etapa_id:            { rotulo: "Etapa do pipeline", kind: "lista" },
  faturamento:         { rotulo: "Faturamento", kind: "texto" },
  empresa:             { rotulo: "Empresa", kind: "texto" },
  email:               { rotulo: "E-mail", kind: "texto" },
  telefone:            { rotulo: "Telefone", kind: "texto" },
  convidado_id:        { rotulo: "Veio por convite de anfitrião", kind: "simnao" },
  anfitriao_id:        { rotulo: "É anfitrião", kind: "simnao" },
  responsavel_user_id: { rotulo: "Responsável", kind: "usuario" },
};

export const OPS_POR_KIND = {
  lista: [["igual", "é"], ["diferente", "não é"], ["em", "é um destes"], ["vazio", "está vazio"], ["preenchido", "está preenchido"]],
  texto: [["contem", "contém"], ["nao_contem", "não contém"], ["igual", "é igual a"], ["comeca", "começa com"], ["vazio", "está vazio"], ["preenchido", "está preenchido"]],
  simnao: [["preenchido", "Sim"], ["vazio", "Não"]],
  usuario: [["vazio", "está sem responsável"], ["preenchido", "tem responsável"], ["igual", "é"], ["diferente", "não é"]],
};
const OPS_SEM_VALOR = new Set(["vazio", "preenchido"]);

export const TIPOS_ACAO = [
  { valor: "responsavel", rotulo: "Atribuir ao responsável" },
  { valor: "responsavel_rodizio", rotulo: "Distribuir entre responsáveis (rodízio equilibrado)" },
  { valor: "etapa", rotulo: "Mover para a etapa" },
  { valor: "situacao", rotulo: "Mudar a situação para" },
  { valor: "ingresso", rotulo: "Mudar a categoria (ingresso) para" },
  { valor: "tipo", rotulo: "Mudar o tipo para" },
];

export const GATILHOS = [
  { valor: "criado", rotulo: "Quando um participante for criado", curto: "ao criar" },
  { valor: "atende", rotulo: "Quando for criado ou passar a atender as condições", curto: "ao criar ou passar a atender" },
];

export const condicaoVazia = () => ({ campo: "ingresso", op: "igual", valor: "" });
export function acaoVazia(tipo = "responsavel") {
  if (tipo === "responsavel") return { tipo, usuario: "", somente_se_vazio: true };
  if (tipo === "responsavel_rodizio") return { tipo, usuarios: [], somente_se_vazio: true };
  if (tipo === "etapa") return { tipo, etapa_id: "" };
  return { tipo, valor: "" };
}

// ctx = { usuarios:[{user_id,nome,email}], etapas:[{id,nome}], ingressos:[nome], tipos:[nome] }
const nomeUsuario = (id, ctx) => {
  const u = (ctx.usuarios || []).find((x) => x.user_id === id);
  return u ? (u.nome || u.email || id) : "(usuário removido)";
};
const nomeEtapa = (id, ctx) => (ctx.etapas || []).find((e) => e.id === id)?.nome || "(etapa removida)";

// valor "legível" de um campo de lista/usuário (id → nome)
export function rotuloValor(campo, valor, ctx) {
  if (campo === "etapa_id") return nomeEtapa(valor, ctx);
  if (campo === "responsavel_user_id") return nomeUsuario(valor, ctx);
  return String(valor ?? "");
}

export function descreverCondicao(c, ctx) {
  const def = CAMPOS[c.campo];
  if (!def) return "(condição inválida)";
  if (def.kind === "simnao") return `${def.rotulo}: ${c.op === "preenchido" ? "sim" : "não"}`;
  const op = (OPS_POR_KIND[def.kind].find(([v]) => v === c.op) || [, c.op])[1];
  if (OPS_SEM_VALOR.has(c.op)) return `${def.rotulo} ${op}`;
  if (c.op === "em") {
    const v = (Array.isArray(c.valor) ? c.valor : []).map((x) => rotuloValor(c.campo, x, ctx));
    return `${def.rotulo} ${op} ${v.length ? v.join(" / ") : "…"}`;
  }
  return `${def.rotulo} ${op} “${rotuloValor(c.campo, c.valor, ctx)}”`;
}

export function descreverAcao(a, ctx) {
  const vazio = a.somente_se_vazio !== false ? " (se estiver sem responsável)" : " (mesmo se já tiver)";
  switch (a.tipo) {
    case "responsavel": return `Atribuir a ${nomeUsuario(a.usuario, ctx)}${vazio}`;
    case "responsavel_rodizio": {
      const n = (a.usuarios || []).map((u) => nomeUsuario(u, ctx));
      return `Distribuir igualmente entre ${n.length ? n.join(", ") : "…"}${vazio}`;
    }
    case "etapa": return `Mover para a etapa “${nomeEtapa(a.etapa_id, ctx)}”`;
    case "situacao": return `Mudar a situação para ${a.valor}`;
    case "ingresso": return `Mudar a categoria para ${a.valor}`;
    case "tipo": return `Mudar o tipo para ${a.valor}`;
    default: return "(ação inválida)";
  }
}

export const rotuloGatilho = (g) => (GATILHOS.find((x) => x.valor === g) || GATILHOS[1]).curto;

export function resumo(auto, ctx) {
  const conds = (auto.condicoes || []).map((c) => descreverCondicao(c, ctx));
  return {
    quando: rotuloGatilho(auto.gatilho),
    se: conds.length ? conds : ["sempre (sem condições — vale pra todos)"],
    entao: (auto.acoes || []).map((a) => descreverAcao(a, ctx)),
  };
}

// devolve a mensagem do 1º problema, ou null se está tudo certo
export function validar(auto) {
  if (!String(auto.nome || "").trim()) return "Dê um nome para a automação.";
  if (!Array.isArray(auto.acoes) || !auto.acoes.length) return "Adicione pelo menos uma ação (o que a automação faz).";
  for (const c of auto.condicoes || []) {
    const def = CAMPOS[c.campo];
    if (!def) return "Há uma condição com campo inválido.";
    if (!OPS_POR_KIND[def.kind].some(([v]) => v === c.op)) return `Condição “${def.rotulo}”: escolha uma opção válida.`;
    if (!OPS_SEM_VALOR.has(c.op)) {
      if (c.op === "em" ? !(Array.isArray(c.valor) && c.valor.length) : !String(c.valor ?? "").trim()) {
        return `Condição “${def.rotulo}”: informe o valor.`;
      }
    }
  }
  for (const a of auto.acoes) {
    const t = TIPOS_ACAO.find((x) => x.valor === a.tipo);
    if (!t) return "Há uma ação inválida.";
    if (a.tipo === "responsavel" && !a.usuario) return "Ação “Atribuir ao responsável”: escolha o usuário.";
    if (a.tipo === "responsavel_rodizio" && (a.usuarios || []).length < 2) return "Ação “Distribuir entre responsáveis”: escolha pelo menos 2 usuários.";
    if (a.tipo === "etapa" && !a.etapa_id) return "Ação “Mover para a etapa”: escolha a etapa.";
    if (["situacao", "ingresso", "tipo"].includes(a.tipo) && !String(a.valor ?? "").trim()) return `Ação “${t.rotulo}”: escolha o valor.`;
    if (a.tipo === "situacao" && !SITUACOES.includes(a.valor)) return "Ação de situação: valor inválido.";
  }
  return null;
}

// só o que vai pro banco (sem campos de tela)
export function paraSalvar(auto) {
  return {
    nome: String(auto.nome).trim(),
    gatilho: auto.gatilho === "criado" ? "criado" : "atende",
    condicoes: (auto.condicoes || []).map((c) => {
      const def = CAMPOS[c.campo];
      const o = { campo: c.campo, op: c.op };
      if (!OPS_SEM_VALOR.has(c.op) && def.kind !== "simnao") o.valor = c.op === "em" ? c.valor : String(c.valor).trim();
      return o;
    }),
    acoes: auto.acoes.map((a) => {
      if (a.tipo === "responsavel") return { tipo: a.tipo, usuario: a.usuario, somente_se_vazio: a.somente_se_vazio !== false };
      if (a.tipo === "responsavel_rodizio") return { tipo: a.tipo, usuarios: [...new Set(a.usuarios)], somente_se_vazio: a.somente_se_vazio !== false };
      if (a.tipo === "etapa") return { tipo: a.tipo, etapa_id: a.etapa_id };
      return { tipo: a.tipo, valor: String(a.valor).trim() };
    }),
    parar: !!auto.parar,
  };
}

// Modelos prontos: abrem o editor já preenchido (o usuário só completa o que falta).
export const MODELOS = [
  {
    id: "rodizio", titulo: "Distribuir novos participantes igualmente",
    desc: "Quem entra sem responsável vai para quem tem menos participantes na equipe.",
    auto: () => ({ nome: "Distribuir novos participantes igualmente", gatilho: "criado",
      condicoes: [{ campo: "responsavel_user_id", op: "vazio" }], acoes: [acaoVazia("responsavel_rodizio")], parar: false }),
  },
  {
    id: "categoria", titulo: "Categoria → responsável",
    desc: "Participante de uma categoria de ingresso (ex.: GOLD) vai para um usuário.",
    auto: () => ({ nome: "Categoria → responsável", gatilho: "atende",
      condicoes: [{ campo: "ingresso", op: "igual", valor: "" }], acoes: [acaoVazia("responsavel")], parar: false }),
  },
  {
    id: "tipo", titulo: "Tipo → responsável",
    desc: "Participante de um tipo (ex.: Aplicação aprovada) vai para um usuário.",
    auto: () => ({ nome: "Tipo → responsável", gatilho: "atende",
      condicoes: [{ campo: "tipo", op: "igual", valor: "" }], acoes: [acaoVazia("responsavel")], parar: false }),
  },
  {
    id: "pagou", titulo: "Pagou → confirmar",
    desc: "Quando o pagamento vira “Pago”, a situação passa a Confirmado.",
    auto: () => ({ nome: "Pagou → Confirmado", gatilho: "atende",
      condicoes: [{ campo: "pagamento", op: "igual", valor: "Pago" }], acoes: [{ tipo: "situacao", valor: "Confirmado" }], parar: false }),
  },
  {
    id: "estorno", titulo: "Reembolso ou cancelamento → desativar",
    desc: "Pagamento Reembolsado/Cancelado tira a pessoa da lista ativa (situação Desativado).",
    auto: () => ({ nome: "Reembolso/cancelamento → Desativado", gatilho: "atende",
      condicoes: [{ campo: "pagamento", op: "em", valor: ["Reembolsado", "Cancelado"] }], acoes: [{ tipo: "situacao", valor: "Desativado" }], parar: false }),
  },
  {
    id: "faturamento", titulo: "Faturamento alto → responsável sênior",
    desc: "Faturamento que contém “milh” (milhão/milhões) vai para um usuário específico.",
    auto: () => ({ nome: "Faturamento alto → responsável sênior", gatilho: "atende",
      condicoes: [{ campo: "faturamento", op: "contem", valor: "milh" }], acoes: [acaoVazia("responsavel")], parar: false }),
  },
];
