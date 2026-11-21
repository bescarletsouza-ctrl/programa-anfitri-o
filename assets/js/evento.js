// =============================================================================
// Contexto de evento — qual evento está aberto no admin (guardado no navegador).
// As páginas públicas não usam isto: elas resolvem o evento pelo anfitrião.
// =============================================================================

export function eventoId() {
  try { return localStorage.getItem("evento_id") || null; } catch { return null; }
}

export function eventoNome() {
  try { return localStorage.getItem("evento_nome") || ""; } catch { return ""; }
}

export function definirEvento(id, nome) {
  try {
    localStorage.setItem("evento_id", id);
    if (nome != null) localStorage.setItem("evento_nome", nome);
  } catch {}
}

export function sairEvento() {
  try {
    localStorage.removeItem("evento_id");
    localStorage.removeItem("evento_nome");
  } catch {}
}

// Chamado no topo de cada tela do admin. Sem evento selecionado → tela de escolha.
export function exigirEvento() {
  const id = eventoId();
  if (!id) {
    location.href = "eventos.html";
    throw new Error("Nenhum evento selecionado.");
  }
  return id;
}

// Hash (SHA-256 hex) da senha de "Adicionar participantes" do app de check-in. O id do evento entra como "sal":
// a mesma senha em eventos diferentes gera hashes diferentes. Só funciona em página segura (https/localhost).
export async function hashSenhaEvento(idEvento, senha) {
  const bytes = new TextEncoder().encode(`${idEvento}:${String(senha || "")}`);
  const resumo = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
