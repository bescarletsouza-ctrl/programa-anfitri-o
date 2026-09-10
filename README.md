# Programa Anfitrião — painel de gestão

Sistema de gestão de **anfitriões** e **convidados**, inspirado no admin do
Programa Multiplicador, porém reescrito, sem identidade/logo do evento e sem
vínculo com Lovable.

Stack: HTML estático + Supabase via CDN (sem build step), no padrão do repositório.

## O que tem nesta fase

Painel administrativo (`/admin/`):

- **Painel** — funis de anfitriões e de convidados, meta de confirmados, faixas de
  faturamento, visão por grupo, top anfitriões, top responsáveis e convidados recentes.
- **Anfitriões** — tabela + filtros + "Novo anfitrião" + gaveta de detalhe
  (contato, responsável, grupo, estágio do funil, presença, links de convite/painel,
  lista de convidados, exclusão).
- **Convidados** — tabela + pills por status + "Novo convidado" (cadastro manual) +
  gaveta com decisão de aprovação (Pendente / Aprovado / Recusado / Confirmado).
- **Formulário de inscrição** — editor das perguntas que o convidado vai responder
  na página pública de convite. Vem com as 8 perguntas padrão; dá para reordenar,
  desativar, tornar (não) obrigatória, editar opções e adicionar perguntas próprias.
- **Configurações** — nome do produto, meta de confirmados, textos, e CRUD de
  **grupos**, **responsáveis** e **estágios do funil**.

### Fora desta fase (próxima)

- Página pública de convite (`/convite`) — landing limpa + formulário multi-passo
  gerado pelas perguntas configuradas, criando o convidado com UTM.
- Painel do anfitrião (`/painel`) — jornada / convites / ranking (sem "10X Private"
  nem vídeo).
- Login (Supabase Auth) e rotas protegidas.

## Setup

### 1. Criar um projeto Supabase **novo/dedicado**

1. [supabase.com](https://supabase.com) → New project (separado do projeto de leads).
2. Studio → **SQL Editor** → cole todo o conteúdo de
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) e rode.
3. Confira em **Table Editor**: `grupos`, `responsaveis`, `estagios` (5 linhas),
   `anfitrioes` (vazia), `convidados` (vazia), `form_perguntas` (8 linhas), `config`
   (1 linha). RLS habilitado em todas.

### 2. Ligar o front ao Supabase

Studio → **Settings → API** → copie **Project URL** e a chave **anon public**.
Abra [`assets/js/config.js`](assets/js/config.js) e preencha:

```js
export const SUPABASE_URL = "https://SEU-REF.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

> A chave `anon` é pública por design. **Nesta fase não há login**: o admin fica
> aberto para quem tiver a URL e o RLS libera `anon` para tudo (ver comentário
> "TEMPORÁRIO" no `0001_init.sql`). Ao adicionar o Supabase Auth, troque as
> policies por policies autenticadas.

### 3. Rodar localmente

Precisa ser servido por HTTP (os `import` de ES modules não funcionam via
`file://`). Qualquer servidor estático serve:

- **VS Code**: extensão *Live Server* → botão "Go Live" com `admin/index.html` aberto.
- **Node**: `npx serve anfitriões` e abra `http://localhost:3000/admin/`.
- **Python 3**: `python -m http.server 8000` dentro de `anfitriões/` e abra
  `http://localhost:8000/admin/`.

### 4. Deploy na Vercel

Crie um projeto **novo** na Vercel para este painel:

1. [vercel.com/new](https://vercel.com/new) → importe o repositório `breenda_project`.
2. Framework preset **Other** (site estático, sem build command).
3. Em **Root Directory**, selecione `anfitriões`.
4. Deploy. A raiz redireciona para `/admin/`.

### 5. Migrações e Edge Functions

As migrações em [`supabase/migrations/`](supabase/migrations/) são rodadas **manualmente**
no SQL Editor, em ordem (`0001` → `0014`). Cada tela nova avisa qual migração falta.

Edge Functions (opcionais — o cadastro funciona sem elas, o disparo não):

```
supabase functions deploy enviar-email     # e-mail (Resend) — precisa dos secrets RESEND_API_KEY / EMAIL_FROM
supabase functions deploy integracoes      # dispara webhooks/conectores de saída
supabase functions deploy webhook-in       # recebe inscrições de ticketeiras/gateways
```

`integracoes` e `webhook-in` não precisam de secret extra (usam as chaves já
presentes no ambiente da função). Config em [`supabase/config.toml`](supabase/config.toml).

## Personalização

- **Cores / fontes**: só [`assets/css/theme.css`](assets/css/theme.css) — as
  variáveis `--cor-laranja`, `--cor-preto`, `--cor-branco`, os cinzas e as fontes
  ficam todas no topo do arquivo.
- **Nome do produto e rótulos**: [`assets/js/config.js`](assets/js/config.js)
  (`APP.nomeProduto`, `APP.marcaHtml`, termos "Anfitrião"/"Convidado") e a tabela
  `config` (editável em Configurações).
- **Estágios do funil, grupos, responsáveis**: tela **Configurações**.
- **Perguntas do convite**: tela **Formulário de inscrição**.

## Estrutura

```
anfitriões/
  index.html                 redireciona para admin/
  admin/                      painel, anfitrioes, convidados, formulario, configuracoes
  assets/css/theme.css        tema (tokens de cor num lugar só)
  assets/js/                  config, supabase (client + queries), ui, e 1 módulo por tela
  supabase/migrations/0001_init.sql
```
