# Checklist de Producao do AM3 Fleet

## Antes de liberar para a equipe

- Trocar a senha do usuario `admin@empresa.com`:

```powershell
.\scripts\change-admin-password.ps1
```

- Criar um usuario SQL exclusivo para a aplicacao:

```sql
-- abrir scripts/create-fleetdesk-sql-user.sql no SQL Server Management Studio
-- trocar TROQUE_ESTA_SENHA_FORTE por uma senha forte
-- executar o script
```

- Atualizar o script de inicializacao para usar o usuario SQL exclusivo:

```powershell
$env:DB_USER="FleetDeskApp"
$env:DB_PASSWORD="senha_forte_do_FleetDeskApp"
```

- Confirmar que a aplicacao roda em modo relacional:

```powershell
$env:DB_SQLSERVER_MODE="relational"
```

## Depois da seguranca

- Validar backup manual do banco `FleetDesk`:

```powershell
.\scripts\backup-sqlserver-rubens.ps1
```

- Depois de validar o backup manual, criar rotina diaria pelo Agendador de Tarefas ou SQL Server Agent.
- Rodar o FleetDesk como servico Windows.
- Criar usuarios reais da equipe.
- Validar acesso de outro computador da rede.
- Remover ou arquivar a tabela antiga `FleetDeskRecords` depois de alguns dias de uso estavel.

## Caminho Azure

- Criar Azure SQL Database para o AM3 Fleet.
- Executar `scripts/sqlserver-relational-schema.sql` no banco da Azure.
- Configurar a aplicacao com:

```powershell
$env:DB_ENCRYPT="true"
$env:DB_TRUST_SERVER_CERTIFICATE="false"
```

- Nao usar `DB_TDS_VERSION=7_2` no Azure SQL, salvo necessidade especifica.
- Testar `GET /api/health` depois da publicacao.
- Conferir firewall do Azure SQL antes de liberar para uso externo.
