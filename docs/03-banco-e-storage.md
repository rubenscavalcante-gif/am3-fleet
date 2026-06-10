# 03 - Banco de dados e storage

## Modelo atual de banco

No Postgres, o sistema usa uma tabela única:

```sql
CREATE TABLE IF NOT EXISTS public.am3_fleet_records (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT am3_fleet_records_pk PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS am3_fleet_records_collection_idx
ON public.am3_fleet_records(collection);
```

Cada registro fica em uma `collection` e o conteúdo fica em `payload`.

Coleções:

- `users`
- `vehicles`
- `drivers`
- `bookings`
- `quickExits`
- `fuel`
- `maintenance`
- `checklists`
- `documents`
- `auditLogs`
- `sessions`

## Vantagens do modelo JSON

- Migração simples.
- Backup/restore simples.
- Flexível para protótipo e primeira produção.
- Compatível com Postgres, SQL Server em modo records e SQLite.

## Pontos para evolução

Para uma versão corporativa mais robusta, a equipe pode migrar para tabelas relacionais:

- `users`
- `vehicles`
- `drivers`
- `bookings`
- `quick_exits`
- `quick_exit_receipts`
- `fuel_entries`
- `maintenance_entries`
- `checklists`
- `documents`
- `audit_logs`
- `sessions`

Recomendação: manter compatibilidade com exportação/importação JSON antes de migrar.

## Usuários e senhas

As senhas são armazenadas como hash SHA-256 simples em `passwordHash`.

Para produção mais forte, recomenda-se migrar para:

- bcrypt,
- argon2,
- política de senha,
- recuperação de senha,
- expiração opcional de sessão.

## Sessões

Sessões ficam na collection `sessions` com validade de 30 dias.

Logout remove a sessão.

## Anexos

O sistema grava no banco apenas referência de arquivo. O arquivo em si fica no storage.

Modos:

- `local`: pasta `uploads/`.
- `supabase`: bucket privado no Supabase Storage.

Rotas:

- Upload: `POST /api/upload`
- Acesso autenticado: `GET /api/files/:path`

## Storage em servidor próprio

Opções:

1. Pasta local em disco, com backup regular.
2. Compartilhamento de rede interno.
3. MinIO/S3 compatível.
4. Azure Blob.
5. Manter Supabase Storage enquanto migra banco.

Se usar storage local em produção:

- garantir persistência do diretório `uploads/`,
- incluir no backup,
- proteger contra listagem pública,
- manter acesso via aplicação autenticada.

## Backup JSON

O backup JSON contém todas as collections do banco, mas não contém necessariamente os binários dos anexos quando o storage é externo.

Para backup completo:

1. Exportar JSON do banco.
2. Exportar bucket/pasta de anexos.

## Limpeza para produção

Scripts:

- `scripts/reset-operational-data.js`
- `scripts/reset-operational-supabase.ps1`

Fluxo recomendado:

```powershell
.\scripts\reset-operational-supabase.ps1
.\scripts\reset-operational-supabase.ps1 -AdminEmail "admin@empresa.com" -Force
```

O primeiro comando simula. O segundo limpa de fato.

O script cria backup antes da limpeza.
