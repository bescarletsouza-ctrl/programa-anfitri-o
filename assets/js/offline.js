// =============================================================================
// Armazenamento local do app de check-in (IndexedDB) para o MODO OFFLINE:
//   • "kv"   → cópia dos dados do evento (participantes, atividades, check-ins…) e outras chaves
//   • "fila" → o que foi feito sem internet e ainda NÃO foi enviado (credenciar, acessos, inscrições…)
// Se o navegador não tiver IndexedDB (aba anônima, bloqueio), cai pra memória: o app continua funcionando, só que
// a fila não sobrevive a fechar o app.
// =============================================================================
const NOME = "weevents-checkin";
const VERSAO = 1;

let _db = null;
const memoria = { kv: new Map(), fila: [], seq: 0 };
let usarMemoria = typeof indexedDB === "undefined";

function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(NOME, VERSAO); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("fila")) db.createObjectStore("fila", { keyPath: "seq", autoIncrement: true });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB bloqueado"));
  });
}

async function tx(loja, modo, fn) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const t = db.transaction(loja, modo);
    const r = fn(t.objectStore(loja));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("transação cancelada"));
  });
}

// roda no IndexedDB; se der qualquer problema, troca pra memória (uma vez) e repete
async function seguro(comIdb, comMemoria) {
  if (!usarMemoria) {
    try { return await comIdb(); } catch (e) { console.warn("IndexedDB indisponível, usando memória:", e); usarMemoria = true; }
  }
  return comMemoria();
}

/* ---- chave/valor (cópias dos dados) ---- */
export const kvSet = (chave, valor) => seguro(() => tx("kv", "readwrite", (s) => s.put(valor, chave)), () => { memoria.kv.set(chave, valor); });
export const kvGet = (chave) => seguro(() => tx("kv", "readonly", (s) => s.get(chave)), () => memoria.kv.get(chave));

/* ---- fila de operações feitas offline ---- */
export const filaAdd = (op) => seguro(
  () => tx("fila", "readwrite", (s) => s.add(op)),
  () => { memoria.fila.push({ ...op, seq: ++memoria.seq }); },
);
export const filaList = async () => {
  const lista = await seguro(() => tx("fila", "readonly", (s) => s.getAll()), () => memoria.fila.map((o) => ({ ...o })));
  return (lista || []).sort((a, b) => a.seq - b.seq);
};
export const filaDel = (seq) => seguro(
  () => tx("fila", "readwrite", (s) => s.delete(seq)),
  () => { memoria.fila = memoria.fila.filter((o) => o.seq !== seq); },
);
export const filaPut = (op) => seguro(
  () => tx("fila", "readwrite", (s) => s.put(op)),
  () => { const i = memoria.fila.findIndex((o) => o.seq === op.seq); if (i >= 0) memoria.fila[i] = { ...op }; },
);
