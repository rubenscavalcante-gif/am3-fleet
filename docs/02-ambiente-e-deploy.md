# 02 - Ambiente e deploy

## Requisitos

- Node.js 20 ou superior.
- npm.
- Banco de dados escolhido:
  - Postgres, recomendado no estado atual.
  - SQL Server, suportado pela camada `database.js`, mas exige validação pela equipe.
  - SQLite, útil apenas para desenvolvimento local.

## Instalação local

```powershell
npm install
npm start
```

URL padrão:

```text
http://127.0.0.1:4174
```

## Variáveis de ambiente

As variáveis devem ser configuradas no servidor/hospedagem, nunca commitadas em `.env`.

### Servidor

```text
PORT=4175
HOST=0.0.0.0
FLEETDESK_HOST=0.0.0.0
APP_TIME_ZONE=America/Sao_Paulo
```

`HOST` ou `FLEETDESK_HOST` deve ser `0.0.0.0` em hospedagens como Render, Docker, Linux server, IIS reverse proxy, Nginx ou Apache proxy.

### Postgres

```text
DB_TYPE=postgres
DB_HOST=host-do-postgres
DB_PORT=5432
DB_DATABASE=postgres
DB_USER=usuario
DB_PASSWORD=senha
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
DB_POOL_MAX=10
DB_POOL_IDLE_TIMEOUT=30000
```

Também é possível usar:

```text
DATABASE_URL=postgresql://usuario:senha@host:5432/database
```

ou:

```text
DB_CONNECTION_STRING=postgresql://usuario:senha@host:5432/database
```

### SQL Server

```text
DB_TYPE=sqlserver
DB_SQLSERVER_MODE=records
DB_HOST=host-sqlserver
DB_PORT=1433
DB_DATABASE=AM3Fleet
DB_USER=usuario
DB_PASSWORD=senha
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=false
DB_TDS_VERSION=7_3_A
```

Para SQL Server 2008, pode ser necessário:

```text
DB_TDS_VERSION=7_3_A
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
```

O modo `records` mantém o mesmo modelo JSON usado no Postgres. O modo `relational` existe no código, mas deve ser revisado pela equipe antes de produção.

### Storage de anexos

Local:

```text
STORAGE_DRIVER=local
```

Supabase:

```text
STORAGE_DRIVER=supabase
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key
SUPABASE_STORAGE_BUCKET=am3-fleet
```

Para servidor próprio, a equipe pode:

- manter Supabase Storage,
- trocar para storage local com backup,
- adaptar `storeUpload(...)` para S3, Azure Blob, MinIO ou storage interno.

### Discord

```text
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Se a variável não existir, o sistema funciona normalmente e apenas não anuncia no Discord.

## Render atual

O arquivo `render.yaml` descreve o deploy atual. Ele pode servir como referência, mas a equipe pode migrar para:

- IIS com reverse proxy.
- Windows Service rodando Node.
- Linux + systemd.
- Docker.
- Nginx/Apache reverse proxy.
- Hospedagem Node própria.

## Exemplo systemd Linux

```ini
[Unit]
Description=AM3 Fleet
After=network.target

[Service]
WorkingDirectory=/opt/am3-fleet
ExecStart=/usr/bin/node server.js
Restart=always
EnvironmentFile=/etc/am3-fleet.env
User=am3fleet

[Install]
WantedBy=multi-user.target
```

## Exemplo Nginx reverse proxy

```nginx
server {
  listen 443 ssl;
  server_name frota.suaempresa.com.br;

  location / {
    proxy_pass http://127.0.0.1:4175;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Comandos úteis

```powershell
npm run check
npm start
npm run backup:json
npm run restore:json -- "backups\arquivo.json"
npm run reset:operational
```
