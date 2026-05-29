# FleetDesk com SQL Server 2008

## 1. Criar banco

No SQL Server Management Studio:

```sql
CREATE DATABASE FleetDesk;
GO
```

O sistema cria automaticamente a tabela `dbo.FleetDeskRecords` na primeira inicializacao.

## 2. Rodar apontando para o SQL Server

No PowerShell, dentro da pasta do projeto:

```powershell
$env:DB_TYPE="sqlserver"
$env:DB_HOST="SERVIDOR_OU_IP"
$env:DB_PORT="1433"
$env:DB_DATABASE="FleetDesk"
$env:DB_USER="seu_usuario"
$env:DB_PASSWORD="sua_senha"
$env:DB_TDS_VERSION="7_2"
npm start
```

Para o servidor ja configurado `Rubens`, use:

```powershell
.\scripts\start-sqlserver-rubens.ps1
```

Esse script pede a senha no terminal e nao grava a senha em arquivo.

Para SQL Server 2008, a aplicacao usa:

- `encrypt=false`
- `trustServerCertificate=true`
- `tdsVersion=7_2`

## 3. Modelo usado

A primeira versao usa uma tabela generica:

```sql
dbo.FleetDeskRecords
```

Cada registro da aplicacao fica salvo como JSON por modulo. Isso facilita a migracao inicial sem reescrever toda a aplicacao. Depois podemos evoluir para tabelas relacionais separadas, como `Veiculos`, `Motoristas`, `Abastecimentos`, `Manutencoes` e `Agendamentos`.

## 4. Voltar para SQLite

Para rodar local sem SQL Server:

```powershell
npm start
```

O SQLite continua salvo em:

```text
data\fleetdesk.sqlite
```
