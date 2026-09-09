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
