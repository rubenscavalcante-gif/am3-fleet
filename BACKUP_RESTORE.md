# Backup e Restauracao do FleetDesk

## Backup manual

O backup e gerado pelo SQL Server no computador/servidor onde o SQL Server roda.

Caminho padrao:

```text
C:\FleetDeskBackups
```

Esse diretorio precisa existir no servidor `Rubens`, e o servico do SQL Server precisa ter permissao de escrita nele.

Para executar:

```powershell
cd "C:\Users\am3solucoes\Documents\Codex\2026-05-25\voc-conhece-alguma-aplica-o-web"
.\scripts\backup-sqlserver-rubens.ps1
```

Para trocar o diretorio:

```powershell
$env:FLEETDESK_BACKUP_DIR="D:\Backups\FleetDesk"
.\scripts\backup-sqlserver-rubens.ps1
```

## Restauracao manual

No SQL Server Management Studio, use um backup `.bak` gerado e rode algo neste formato:

```sql
USE master;
GO

ALTER DATABASE FleetDesk SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
GO

RESTORE DATABASE FleetDesk
FROM DISK = 'C:\FleetDeskBackups\FleetDesk_YYYYMMDDHHMMSS.bak'
WITH REPLACE;
GO

ALTER DATABASE FleetDesk SET MULTI_USER;
GO
```

Antes de restaurar, pare o FleetDesk para evitar usuarios gravando durante a restauracao:

```powershell
.\scripts\stop-fleetdesk.ps1
```

Depois, inicie novamente:

```powershell
.\scripts\start-sqlserver-rubens.ps1
```

## Proximo passo

Depois de validar o backup manual, podemos criar uma rotina diaria pelo Agendador de Tarefas do Windows ou pelo SQL Server Agent, se ele estiver disponivel na sua edicao do SQL Server.
