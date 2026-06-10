# 04 - Operação, backup e preparação de produção

## Rotina operacional recomendada

Diário:

- Verificar se a aplicação abre.
- Verificar se login funciona.
- Verificar se anexos abrem.
- Verificar se Discord recebeu mensagens, caso a integração esteja ativa.

Semanal:

- Gerar backup JSON.
- Conferir armazenamento de anexos.
- Conferir logs do servidor.

Mensal:

- Testar restauração em ambiente separado.
- Revisar usuários ativos.
- Conferir documentos e manutenções vencidas.

## Backup JSON local

```powershell
cd "C:\caminho\am3-fleet"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\backup-supabase.ps1
```

O backup é salvo em:

```text
backups\am3-fleet-backup-AAAA-MM-DD...
```

## Restore

Use com muito cuidado. O restore substitui o estado atual.

```powershell
.\scripts\restore-supabase.ps1 "backups\arquivo.json"
```

## Limpeza de dados de teste

Simulação:

```powershell
.\scripts\reset-operational-supabase.ps1
```

Execução real:

```powershell
.\scripts\reset-operational-supabase.ps1 -AdminEmail "admin@empresa.com" -Force
```

O script:

- cria backup antes,
- mantém somente o admin informado,
- apaga cadastros, movimentos, anexos registrados no banco, auditoria e sessões.

Importante: se os anexos estiverem no storage, a limpeza remove as referências do banco, mas não necessariamente apaga os arquivos binários do bucket/pasta. A equipe deve limpar o storage separadamente se quiser remover arquivos antigos.

## Checklist de produção

Antes de liberar para usuários:

- Banco definitivo criado.
- Usuário de banco com menor privilégio possível.
- `.env` criado somente no servidor.
- HTTPS ativo.
- `HOST=0.0.0.0` no servidor.
- `APP_TIME_ZONE=America/Sao_Paulo`.
- Storage persistente configurado.
- Backup testado.
- Restore testado em ambiente separado.
- Usuário admin real confirmado.
- Usuário admin genérico removido ou senha trocada.
- Discord testado, se usado.
- PWA testado em Android/iOS.
- Geolocalização testada no domínio HTTPS.
- Exportação CSV testada no Excel.
- Logs monitorados.

## Observações de PWA

Após deploy com alteração de frontend, celulares podem manter cache antigo.

O projeto usa `service-worker.js`. Sempre incrementar `CACHE_NAME` quando alterar shell do app.

Usuários podem precisar:

- fechar e abrir o PWA,
- atualizar a página,
- remover e instalar novamente o PWA em casos extremos de cache antigo.

## Logs

Hoje os logs saem no stdout/stderr do processo Node.

Em produção própria, configurar coleta de logs:

- systemd journal,
- PM2 logs,
- Docker logs,
- Windows Event Viewer/serviço,
- ferramenta interna.

## Monitoramento mínimo

Endpoint:

```text
GET /api/health
```

Resposta esperada:

```json
{
  "ok": true,
  "app": "AM3 Fleet"
}
```
