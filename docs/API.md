# API de leitura — We.events

API **somente leitura** (só `GET`) para alimentar dashboards externos (ex.: Google Sheets/Apps Script da DTS).

- Base: `https://we.events.mirapontocom.com.br/api/v1`
- Auth: `Authorization: Bearer <token>`
- Formato: JSON · datas em ISO 8601 com fuso de Brasília (`2026-10-15T14:30:00-03:00`)
- Limite: **60 requisições/minuto por token** (acima disso, `429`)

## Ativar (uma vez)

1. **SQL Editor** do Supabase: rodar `supabase/migrations/0036_api_leitura.sql`.
2. **Edge Functions → Create function** com o nome **`api`**, colar o conteúdo de `supabase/functions/api/index.ts` e **desligar "Verify JWT"** (a função valida o próprio token). Deploy.
3. `git push` (o `vercel.json` já encaminha `/api/v1/*` para a função).

## Gerar, listar e revogar tokens

Tudo no **SQL Editor** — sem mexer em código. O token só aparece **uma vez**, na hora de gerar (no banco fica apenas o hash).

```sql
-- token de UMA organização (vê todos os eventos dela) — o recomendado
select * from criar_api_token('DTS dashboard', '<uuid da organização>');

-- token da PLATAFORMA INTEIRA (todos os clientes!) — só se for realmente necessário
select * from criar_api_token('Interno', null, true);

-- uuid das organizações
select id, nome from organizacoes order by nome;

-- tokens existentes e último uso
select id, nome, prefixo, ativo, criado_em, revogado_em, ultimo_uso_em from api_tokens order by criado_em desc;

-- revogar (a próxima chamada com ele já volta 401)
select revogar_api_token('<id do token>');

-- acessos recentes de um token
select em, metodo, caminho, status, ip, qtd from api_log where token_id = '<id do token>' order by em desc limit 100;
```

**Trocar o token:** gere um novo, atualize onde ele é usado, depois revogue o antigo.

> O token de uma organização só enxerga os eventos dela. Dados pessoais (nome, e-mail, telefone) saem por este token — guarde-o nas **Propriedades do script** do Google, nunca em células da planilha.

## `GET /eventos`

Filtros opcionais: `atualizado_desde` (ISO 8601), `status` (`ativo` · `encerrado` · `inativo`), `limite` (1–500), `cursor`.

```bash
curl -s "https://we.events.mirapontocom.com.br/api/v1/eventos?status=ativo" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "dados": [
    {
      "id": "3f0c9c52-1f0e-4d4f-9a55-6a6f0f6d7c11",
      "nome": "A Mesa ed 006",
      "data_inicio": "2026-11-20T00:00:00-03:00",
      "data_fim": null,
      "status": "ativo",
      "local": "São Paulo",
      "criado_em": "2026-09-01T09:00:00-03:00",
      "atualizado_em": "2026-10-15T14:30:00-03:00"
    }
  ],
  "proxima_pagina": null
}
```

- `status`: `inativo` (desativado), `encerrado` (data já passou) ou `ativo`.
- `data_inicio`: a plataforma guarda só a **data** do evento; vem como meia-noite de Brasília. `data_fim` é sempre `null`.

## `GET /participantes`

Filtros opcionais: `evento_id` (UUID), `atualizado_desde` (ISO 8601), `limite` (1–500), `cursor`.

```bash
curl -s "https://we.events.mirapontocom.com.br/api/v1/participantes?evento_id=3f0c9c52-1f0e-4d4f-9a55-6a6f0f6d7c11&atualizado_desde=2026-10-15T00:00:00-03:00" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "dados": [
    {
      "id": "9b1e6d52-2c3a-4f55-8b0a-0c6f5a9e4d21",
      "evento_id": "3f0c9c52-1f0e-4d4f-9a55-6a6f0f6d7c11",
      "evento_nome": "A Mesa ed 006",
      "tipo": "Convidado",
      "nome": "Beatriz Gomes",
      "email": "beatrizgomesstudio@gmail.com",
      "telefone": "(19) 99715-1417",
      "tipo_ingresso": "GOLD",
      "valor_pago": 500,
      "pagamento": "Pago",
      "status_inscricao": "aprovado",
      "checkin": true,
      "checkin_em": "2026-11-20T19:10:00-03:00",
      "utm_source": "instagram",
      "utm_medium": "pyero",
      "utm_campaign": "a-mesa-jul-2026",
      "criado_em": "2026-10-01T09:00:00-03:00",
      "atualizado_em": "2026-11-20T19:10:02-03:00"
    }
  ],
  "proxima_pagina": "eyJ0IjoiMjAyNi0xMS0yMFQyMjoxMDowMi4wMDAwMDErMDA6MDAiLCJpIjoiOWIxZTZkNTItMmMzYS00ZjU1LThiMGEtMGM2ZjVhOWU0ZDIxIn0"
}
```

| Campo | Observação |
|---|---|
| `status_inscricao` | `inscrito` · `aprovado` · `reprovado` · `cancelado` · `lista de espera` (regras abaixo) |
| `valor_pago` | **Preço de tabela** do tipo de ingresso × quantidade, só para quem pagou (`pagamento` = `Pago`, ou `Externo` já Confirmado). É o valor cadastrado em *Tipos de ingresso*, **não** o que passou no gateway. `null` se gratuito/convidado/sem preço |
| `checkin` / `checkin_em` | presença no evento e quando |
| `utm_*` | só existem para quem veio por convite de anfitrião; senão `null` |
| `tipo` | Convidado, Anfitrião, Acompanhante, Comprador… (use para separar anfitriões, se quiser) |
| `atualizado_em` | muda em qualquer alteração do participante ou do convite dele (inclusive check-in) |

**Regras do `status_inscricao`** (a primeira que bater vale):
1. `pagamento` Cancelado/Reembolsado, ou situação *Desativado* (“Não vai”) → `cancelado`
2. situação *Fila de espera* → `lista de espera`
3. convite *Recusado* → `reprovado` · *Aprovado*/*Confirmado* → `aprovado` · *Pendente* → `inscrito`
4. sem convite: situação *Confirmado* → `aprovado`; qualquer outra → `inscrito`

## Paginação e atualização incremental

- Até **500 por página**. Se vier `proxima_pagina`, chame de novo com `?cursor=<esse valor>` (mantendo os mesmos filtros); quando vier `null`, acabou.
- A ordem é por `atualizado_em` crescente. Para sincronizar só o que mudou: guarde o maior `atualizado_em` que recebeu e, na próxima vez, envie `atualizado_desde=<ele>` (**codifique o `+` como `%2B`**, ou use o fuso `-03:00`, que não tem esse problema).
- O filtro é “maior ou igual” e o `atualizado_em` sai truncado em segundos: pode vir o mesmo registro de novo. **Faça upsert pelo `id`.**

## Erros

| HTTP | `codigo` | Quando |
|---|---|---|
| 400 | `parametro_invalido` | filtro/cursor/limite inválido |
| 401 | `token_invalido` | token ausente, errado ou revogado |
| 404 | `rota_inexistente` | rota diferente de `/eventos` e `/participantes` |
| 405 | `metodo_nao_permitido` | qualquer método que não seja `GET` |
| 429 | `limite_excedido` | passou de 60/min (veja `Retry-After`) |
| 500 | `erro_interno` | falha inesperada |

Corpo: `{ "erro": "mensagem clara", "codigo": "..." }`.

## Exemplo — Apps Script (Google Sheets)

Guarde o token em **Configurações do projeto → Propriedades do script → `WE_EVENTS_TOKEN`**.

```javascript
const BASE = 'https://we.events.mirapontocom.com.br/api/v1';

function buscarTudo_(rota, params) {
  const token = PropertiesService.getScriptProperties().getProperty('WE_EVENTS_TOKEN');
  let linhas = [], cursor = null;
  for (;;) {
    const q = Object.assign({}, params, cursor ? { cursor: cursor } : {});
    const qs = Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k])).join('&');
    const r = UrlFetchApp.fetch(BASE + '/' + rota + '?' + qs,
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (r.getResponseCode() === 429) { Utilities.sleep(61000); continue; }   // estourou o limite: espera e repete
    if (r.getResponseCode() !== 200) throw new Error(r.getResponseCode() + ' ' + r.getContentText());
    const j = JSON.parse(r.getContentText());
    linhas = linhas.concat(j.dados);
    if (!j.proxima_pagina) return linhas;
    cursor = j.proxima_pagina;
  }
}

function sincronizarParticipantes() {
  const props = PropertiesService.getScriptProperties();
  const desde = props.getProperty('ULTIMA_SYNC');           // vazio na 1ª vez = tudo
  const novos = buscarTudo_('participantes', desde ? { atualizado_desde: desde } : {});
  // ... upsert na planilha usando novos[i].id como chave ...
  if (novos.length) {
    props.setProperty('ULTIMA_SYNC', novos[novos.length - 1].atualizado_em); // vêm em ordem crescente
  }
}
```

## O que esta API não traz

- **Inscrições que ainda não viraram participante.** Candidaturas de convite *pendentes* ou *recusadas* não são participantes (a plataforma remove/nunca cria o registro), então `reprovado` só aparece quando existe um participante ligado a um convite recusado — na prática, raro. Se o funil precisar do total de candidaturas, o próximo passo é um `GET /convidados`.
- **Webhook de saída** (aviso de inscrição/status/check-in). Não incluído; já existe em *Integrações → Webhook de saída*, mas o corpo é o formato interno, não o desta API.
- **Valor real do gateway** (só o preço de tabela do ingresso).

## Testes

`supabase/functions/api/api_test.ts` (26 testes: autenticação, 405, limite 60/min, filtros, paginação por cursor, escopo por organização, regras de status e de valor, formato das datas). Com Deno instalado:

```bash
deno test supabase/functions/api/api_test.ts
```

As consultas SQL (`api_eventos`, `api_participantes`) precisam ser conferidas no seu banco depois da migração — rode uma chamada com `limite=2` e compare com a tela de Participantes.
