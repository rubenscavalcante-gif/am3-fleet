# AM3 Fleet - Entrega para equipe de desenvolvimento

Este documento é o ponto de partida para transferir o projeto AM3 Fleet para a equipe interna de desenvolvimento.

## O que é o AM3 Fleet

Aplicação web/PWA para gestão de frota empresarial, com retaguarda administrativa e modo motorista para celular.

Principais funções:

- Cadastros de veículos e motoristas.
- Agendamentos de viagens futuras.
- Saídas rápidas de veículos.
- Devolução pelo celular com geolocalização.
- Prestação de contas da saída rápida.
- Anexos de comprovantes.
- Abastecimentos, manutenções, checklists e documentos.
- Relatórios e exportação CSV compatível com Excel em português.
- Integração com Discord por webhook ao registrar retirada de veículo.
- Atualização em tempo real via Server-Sent Events.
- PWA instalável no celular.

## Stack atual

- Node.js puro, sem framework backend.
- Frontend estático em HTML/CSS/JavaScript.
- Banco atual em Supabase/Postgres usando tabela JSON genérica.
- Anexos atuais em Supabase Storage.
- Deploy atual no Render.
- Autenticação própria com sessão persistida no banco.

Arquivos principais:

- `server.js`: servidor HTTP, rotas API, upload, Discord, autenticação.
- `database.js`: camada de persistência SQLite, SQL Server e Postgres.
- `app.js`: lógica do frontend.
- `index.html`: estrutura de telas e modais.
- `styles.css`: estilos.
- `manifest.webmanifest` e `service-worker.js`: PWA/cache.
- `scripts/`: backup, restore e limpeza para produção.

## Documentos técnicos

Leia nesta ordem:

1. `docs/01-arquitetura.md`
2. `docs/02-ambiente-e-deploy.md`
3. `docs/03-banco-e-storage.md`
4. `docs/04-operacao-backup-e-producao.md`
5. `docs/05-api-e-integracoes.md`
6. `docs/06-seguranca-e-proximos-passos.md`

## Como rodar localmente

```powershell
npm install
npm start
```

Por padrão, sem variáveis de banco, a aplicação usa SQLite local em `data/fleetdesk.sqlite`.

URL local padrão:

```text
http://127.0.0.1:4174
```

Para produção, configurar variáveis de ambiente conforme `docs/02-ambiente-e-deploy.md`.

## Antes de entregar em produção

Checklist mínimo:

- Gerar backup JSON do banco atual.
- Limpar dados de teste, mantendo apenas o usuário admin.
- Configurar banco definitivo.
- Configurar storage definitivo para anexos.
- Configurar HTTPS.
- Configurar variáveis de ambiente fora do Git.
- Testar login, cadastros, saída rápida, devolução mobile, anexos, CSV e Discord.
- Revisar política de backup e retenção.

## Segredos que não devem ir para o Git

Nunca versionar:

- `.env`
- senha do banco
- `SUPABASE_SERVICE_ROLE_KEY`
- `DISCORD_WEBHOOK_URL`
- connection string com senha
- backups reais
- anexos reais

O `.gitignore` já ignora `.env`, backups, dados locais e uploads.
