# RegeneCure Client Journey

Plataforma da jornada do cliente com duas interfaces:

- **Profissional** — `https://jornada.regenecure.com/` · login por e-mail e senha, lista de clientes, upload e revisão do laudo, publicação e envio pelo WhatsApp.
- **Cliente** — `https://jornada.regenecure.com/c/<link-pessoal>` · acesso confirmado por código de 6 dígitos no WhatsApp, protocolo em 4 etapas, registro diário de doses e gamificação.

## Estrutura

```
public/index.html            interface da profissional
public/client.html           interface do cliente (servida em /c/*)
public/assets/core.js        regras de agenda, gamificação e renderização (compartilhado)
public/assets/admin.js       lógica da profissional (Supabase Auth, upload, envio)
public/assets/client.js      lógica do cliente (código WhatsApp, marcações)
netlify/functions/client.mjs API do cliente: código, sessão, jornada, marcações
netlify/functions/admin.mjs  API da profissional: envio WhatsApp, novo link, templates
netlify/functions/reminders.mjs  lembrete diário automático (12:00 UTC)
netlify/edge-functions/extract.js  extração do laudo por IA (somente profissional)
netlify/lib/server.mjs       Supabase, Kapso e templates (servidor)
supabase/schema.sql          banco, regras de acesso e armazenamento
```

## Configuração (uma vez)

### 1. Supabase

1. **SQL Editor → New query** → cole o conteúdo de `supabase/schema.sql` → **Run**.
2. **Authentication → Sign In / Providers → Email**: desative **Allow new users to sign up**.
3. **Authentication → Users → Add user → Create new user**: seu e-mail e uma senha forte, com **Auto Confirm User** marcado.
4. **Settings → API Keys → Secret keys**: crie ou revele a chave `sb_secret_...` e guarde para o passo 3.
5. **Authentication → URL Configuration → Site URL**: `https://jornada.regenecure.com`.

O primeiro login na plataforma torna essa conta administradora automaticamente. Depois disso, nenhuma outra conta consegue esse acesso.

### 2. Kapso

- **API key**: Integrations → API keys → criar chave.
- **WhatsApp Business Account ID (WABA ID)**: nos detalhes do número em WhatsApp → Phone numbers. Necessário para criar os templates pelo painel.
- O Phone Number ID (`1418705654659738`) já está no código.

### 3. Netlify

Add new project → Import from GitHub → este repositório. Sem comando de build. Em **Project configuration → Environment variables**:

| Variável | Valor |
|---|---|
| `SUPABASE_SECRET_KEY` | chave `sb_secret_...` do Supabase |
| `ANTHROPIC_API_KEY` | chave da Anthropic, para extrair dados do laudo |
| `KAPSO_API_KEY` | chave de API do Kapso |
| `KAPSO_WABA_ID` | WhatsApp Business Account ID |
| `APP_URL` | `https://jornada.regenecure.com` |

Depois de salvar as variáveis: **Deploys → Trigger deploy**.

Opcionais: `ANTHROPIC_MODEL` (padrão `claude-sonnet-5-5`), `WA_LANG_EN` (padrão `en_US`), `WA_LANG_PT` (padrão `pt_BR`), `SESSION_PEPPER`.

### 4. Domínio

Netlify → **Domain management → Add a domain** → `jornada.regenecure.com`. No DNS do regenecure.com (Shopify: Settings → Domains → DNS settings), crie um registro **CNAME** `jornada` → `<seu-projeto>.netlify.app`. O HTTPS é emitido automaticamente.

### 5. Templates do WhatsApp

Na plataforma: **Configurações → Criar templates no WhatsApp**. São criados 6 templates (português e inglês); a Meta revisa cada um. Use **Verificar status** até todos aparecerem como `APPROVED`.

| Template | Categoria | Uso |
|---|---|---|
| `jornada_pronta` | Utility | Aviso de protocolo publicado, com botão para o painel |
| `lembrete_followup` | Utility | Lembrete de follow-up (manual ou automático, 1 dia antes) |
| `codigo_acesso` | Authentication | Código de 6 dígitos para o cliente entrar |
| `followup_confirmacao` | Utility | Lembrete automático 1 dia antes do follow-up, com botão para confirmar presença ou pedir remarcação |
| `lembrete_peptideo` | Utility | Lembrete diário nos dias de aplicação, no horário escolhido pelo cliente |

## Lembretes automáticos

Uma função roda a cada hora e usa o fuso horário de cada cliente (capturado do celular dele; padrão Brasília para português e Dubai para inglês):

- **Follow-up**: às 10:00 do dia anterior à consulta (variável `FOLLOWUP_REMINDER_HOUR` para mudar o horário). O botão leva direto à etapa de follow-up, onde o cliente confirma presença ou pede remarcação. A resposta aparece na lista de clientes e na ficha.
- **Peptídeos**: o cliente ativa na etapa 3 e escolhe o horário (05:00–22:00). A mensagem lista os peptídeos e doses do dia; nos dias sem aplicação, nada é enviado. Você também pode ativar ou desativar pela ficha do cliente.

Ambos podem ser desligados para todos os clientes em Configurações.

Projetos criados antes desta versão: rode `supabase/migrations/002_alerts.sql` no SQL Editor.

Se preferir criar no painel do Kapso: categoria e nomes iguais aos da tabela, parâmetros nomeados `{{name}}` e `{{date}}`, botão de URL `https://jornada.regenecure.com/c/{{1}}`. Textos em `netlify/lib/server.mjs` → `templateDefinitions()`.

## Fluxo de uso

1. **Novo cliente** → nome, WhatsApp com código do país, idioma.
2. Envie o laudo (e o protocolo, se for outro arquivo) → revise → **Salvar e confirmar**.
3. **Publicar e enviar no WhatsApp** → o cliente recebe a mensagem com o botão do painel.
4. O cliente abre o link, recebe o código no WhatsApp e entra. A sessão vale 30 dias por aparelho.
5. Você acompanha adesão, confirmações e último acesso na lista e na ficha do cliente.

**Ver como cliente** abre o painel sem código e sem salvar marcações. **Gerar novo link** desativa o link anterior e encerra as sessões abertas.

## Segurança

- Regras de acesso no banco: só a conta administradora lê e altera dados pela API. Os clientes não acessam o banco; as funções do Netlify verificam a sessão antes de cada operação.
- Os códigos e as sessões são guardados apenas como hash. Cada código vale 10 minutos e aceita até 5 tentativas.
- Os laudos ficam em armazenamento privado. O cliente recebe apenas um link temporário de 10 minutos.
- A chave secreta do Supabase e as chaves do Kapso e da Anthropic ficam só nas variáveis do Netlify.
