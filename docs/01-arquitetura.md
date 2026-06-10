# 01 - Arquitetura

## Visão geral

O AM3 Fleet é uma aplicação web monolítica simples:

```text
Navegador/PWA
  -> HTML/CSS/JS estático
  -> API HTTP em Node.js
  -> Banco de dados
  -> Storage de anexos
  -> Discord Webhook
```

Não há build de frontend. Os arquivos são servidos diretamente pelo `server.js`.

## Backend

Arquivo principal: `server.js`

Responsabilidades:

- Servir arquivos estáticos.
- Login, logout e sessão.
- API de CRUD.
- Modo motorista.
- Upload e download de anexos.
- Backup manual.
- Server-Sent Events em `/api/events`.
- Integração com Discord.

Rotas principais:

- `GET /api/health`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `POST /api/me/password`
- `GET /api/data`
- `GET /api/events`
- `POST /api/mobile/checkout`
- `POST /api/mobile/return`
- `POST /api/upload`
- `GET /api/files/:path`
- `GET /api/system/status`
- `POST /api/system/backup`
- CRUD genérico: `/api/:collection`

Coleções aceitas no CRUD:

- `vehicles`
- `drivers`
- `bookings`
- `quickExits`
- `fuel`
- `maintenance`
- `checklists`
- `documents`
- `users`

## Frontend

Arquivos:

- `index.html`
- `styles.css`
- `app.js`

O frontend trabalha com um estado global carregado por `/api/data`.

Principais telas:

- Painel.
- Recepção.
- Agendamentos.
- Saídas rápidas.
- Modo motorista.
- Veículos.
- Motoristas.
- Abastecimentos.
- Manutenção.
- Checklists.
- Documentos.
- Relatórios.
- Usuários.
- Auditoria.
- Sistema.

## Modo motorista

O modo motorista é uma tela simplificada para celular/PWA.

Fluxo:

1. Usuário motorista faz login.
2. Sistema identifica o motorista vinculado por `driverId` ou nome.
3. Motorista retira um veículo informando destino.
4. Sistema bloqueia conflito se o veículo já estiver em uso.
5. Motorista marca devolução.
6. Na devolução, o navegador tenta capturar geolocalização.
7. Saída passa para `Aguardando conferência`.
8. Recepção faz a conferência financeira.

## Atualização em tempo real

O backend mantém conexões SSE em `/api/events`.

Quando dados mudam, `notifyDataChanged(...)` envia evento para o frontend. O frontend atualiza os dados sem exigir F5.

## PWA

Arquivos:

- `manifest.webmanifest`
- `service-worker.js`

Sempre que alterar `index.html`, `styles.css`, `app.js`, `manifest.webmanifest` ou arquivos de shell do PWA, incrementar:

```js
const CACHE_NAME = "am3-fleet-shell-vX";
```

Isso evita celular ficar preso em versão antiga.

## Observação sobre simplicidade

O projeto foi construído para ser fácil de hospedar e manter. Não há framework, bundler ou pipeline complexo. Isso facilita a migração, mas a equipe pode futuramente separar frontend/backend, adicionar testes automatizados e evoluir para schema relacional completo.
