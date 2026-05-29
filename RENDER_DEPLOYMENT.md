# Publicar o AM3 Fleet no Render

Este roteiro publica o servidor Node do AM3 Fleet em uma URL externa. O banco e os anexos continuam no Supabase.

## Por que Render

O Render publica aplicacoes Node como **Web Service**, entrega uma URL `onrender.com` e permite configurar variaveis de ambiente pelo painel. A aplicacao precisa escutar em `0.0.0.0` e na porta definida por `PORT`, que o AM3 Fleet ja respeita.

## Antes de publicar

Confirme que estes itens ja funcionam localmente:

- Login no AM3 Fleet.
- Banco Supabase/Postgres.
- Supabase Storage.
- Upload e abertura de anexo.

## Enviar o projeto para um repositorio

O jeito mais simples no Render e conectar um repositorio GitHub.

1. Crie um repositorio privado no GitHub, por exemplo `am3-fleet`.
2. Envie os arquivos do projeto para esse repositorio.
3. Nao envie arquivos com senhas reais.

Arquivos como `.env` devem ficar fora do repositorio.

## Criar o Web Service

No Render:

1. Clique em **New > Web Service**.
2. Conecte o repositorio do GitHub.
3. Escolha:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /api/health
```

4. Use o plano gratuito para testar, se estiver disponivel.

## Variaveis de ambiente

Configure no Render:

```text
HOST=0.0.0.0
DB_TYPE=postgres
DB_HOST=aws-1-sa-east-1.pooler.supabase.com
DB_PORT=5432
DB_DATABASE=postgres
DB_USER=postgres.tmcdslecowxoztikmdbp
DB_PASSWORD=sua_senha_do_supabase
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
STORAGE_DRIVER=supabase
SUPABASE_URL=https://tmcdslecowxoztikmdbp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
SUPABASE_STORAGE_BUCKET=am3-fleet
```

Nunca coloque `DB_PASSWORD` ou `SUPABASE_SERVICE_ROLE_KEY` direto no codigo.

## Usando render.yaml

O arquivo `render.yaml` ja foi criado para facilitar. Ele preenche as variaveis nao sensiveis e deixa as senhas como `sync: false`, para voce informar pelo painel do Render.

## Depois do deploy

Quando o Render finalizar, ele vai mostrar uma URL parecida com:

```text
https://am3-fleet.onrender.com
```

Teste:

1. Abrir a URL.
2. Fazer login.
3. Cadastrar um motorista simples.
4. Fazer uma saida rapida.
5. Anexar e abrir um comprovante.
6. Acessar `/api/health`.

## Observacoes

- No plano gratuito, o servico pode demorar para acordar depois de um periodo parado.
- O banco e os anexos nao ficam no Render; ficam no Supabase.
- Se usar dominio proprio futuramente, configuramos no proprio Render.
