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
no SQL Editor, em ordem (`0001` → `0017`). Cada tela nova avisa qual migração falta.

Edge Functions:

```
supabase functions deploy enviar-email     # e-mail (Resend) — precisa dos secrets RESEND_API_KEY / EMAIL_FROM
supabase functions deploy integracoes      # dispara webhooks/conectores de saída
supabase functions deploy webhook-in       # recebe inscrições de ticketeiras/gateways
supabase functions deploy equipe           # usuários de uma organização
supabase functions deploy plataforma       # organizações (clientes), limites, convites
supabase functions deploy publico          # dados das páginas públicas (só depois do 0017)
```

Config em [`supabase/config.toml`](supabase/config.toml). Secrets opcionais para
`plataforma` (e `enviar-email`): `RESEND_API_KEY`, `EMAIL_FROM`, `SITE_URL`.

### 5.1 Ligar o multi-tenant (login + organizações)

**Ordem — cada etapa é segura de subir sozinha; o `/admin` só passa a exigir
login depois do commit 3.**

1. **Migração `0016_plataforma.sql`** no SQL Editor (cria organizações, membros,
   `eventos.org_id`, adota os eventos atuais na org "We.events"). Aditiva.
2. **Deploy** de `plataforma` e `equipe`. Em **Supabase → Authentication → URL
   Configuration**: adicionar `https://SEU-DOMINIO/login.html` em *Redirect URLs*
   e como *Site URL*. Configurar **SMTP do Resend** em *Authentication → SMTP*
   (ou setar `RESEND_API_KEY`/`EMAIL_FROM`/`SITE_URL` nos secrets da função).
3. **Commit 3 já no ar** → o `/admin` exige login. Abra `https://SEU-DOMINIO/login.html`
   → aparece "Configurar a plataforma" → crie a conta de dona (só o e-mail
   `bescarletsouza@gmail.com`). Logue.
4. Abra **Plataforma** (item novo no rodapé do menu) → cadastre as organizações
   clientes (empresa, ramo, faturamento, nível de acesso, limite de eventos,
   expiração). O responsável recebe o convite por e-mail.
5. Promova as contas admin reais da org "We.events" a `papel='admin'`:
   `update org_membros set papel='admin' where org_id=(select id from organizacoes where nome='We.events') and email='...';`
6. **Só quando tudo acima estiver validado**: migração `0017_rls_por_org.sql`
   (troca a RLS aberta por RLS de organização) + deploy de `publico` + o commit
   que aponta `convite/painel/status.js` para a função `publico`. Guarde
   `rollback_0017.sql` à mão.

### 6. Check-in no celular como "app"

`checkin-app.html` é um **PWA**: no Chrome do Android (ou Safari do iPhone) →
menu → *Adicionar à tela inicial*. Abre em tela cheia, com ícone, sem barra do
navegador. É o caminho recomendado — zero build.

Fluxo: **login** (Supabase Auth) → escolher o evento → escolher o tipo (evento
geral ou uma atividade) → escanear o QR do crachá. Para ativar:

1. Rode `supabase/migrations/0015_auth_checkin.sql` (libera o papel
   `authenticated` na RLS — sem isso o app loga mas não lê nada).
2. Deploy da função `equipe`:

   ```
   supabase functions deploy equipe
   ```

3. Crie os logins da equipe em **Configurações → Equipe de check-in**
   (a função `equipe` usa a service role para chamar o `auth.admin` — a conta
   já entra direto, sem confirmar e-mail). Dá para criar/remover/trocar senha
   por lá. Alternativa manual: Supabase Studio → Authentication → Users.

Para gerar um **`.apk` / `.aab` de verdade** (Play Store ou instalação manual),
empacote o PWA numa TWA:

1. [pwabuilder.com](https://www.pwabuilder.com) → cole a URL do check-in
   (`https://SEU-DOMINIO/checkin-app.html`) → *Package for stores* → Android.
2. Baixe o pacote. Ele traz um `assetlinks.json` com a impressão digital (SHA-256)
   da chave de assinatura.
3. Suba esse conteúdo em `https://SEU-DOMINIO/.well-known/assetlinks.json`
   (crie a pasta `.well-known/` na raiz do projeto e faça deploy). Isso remove a
   barra de URL e liga o app ao site.
4. Instale o `.apk` no aparelho, ou publique o `.aab` no Play Console.

O manifest ([`manifest.webmanifest`](manifest.webmanifest)) e os ícones em
`assets/img/app-icon-*.png` já estão prontos para o empacotador.

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
