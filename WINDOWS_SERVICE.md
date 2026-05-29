# FleetDesk como Servico Windows

O Windows nao executa scripts PowerShell comuns como servico nativo sem um wrapper. A opcao mais simples e estavel e usar o NSSM.

## 1. Preparar NSSM

Instale o NSSM no PATH do Windows ou coloque o arquivo:

```text
tools\nssm.exe
```

## 2. Instalar servico

Abra o PowerShell como Administrador:

```powershell
cd "C:\Users\am3solucoes\Documents\Codex\2026-05-25\voc-conhece-alguma-aplica-o-web"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\install-windows-service-nssm.ps1
```

O servico sera criado como:

```text
FleetDesk
```

## 3. Verificar logs

```text
logs\fleetdesk-service.log
logs\fleetdesk-service-error.log
```

## 4. Remover servico

Abra o PowerShell como Administrador:

```powershell
.\scripts\uninstall-windows-service-nssm.ps1
```

## Observacao

Enquanto o servico nao estiver instalado, a alternativa atual via pasta Inicializar continua funcionando.
