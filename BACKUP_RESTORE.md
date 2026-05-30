# Backup e Restauracao do AM3 Fleet

O AM3 Fleet em producao usa:

- Supabase/Postgres para dados.
- Supabase Storage para anexos.

## Backup recomendado

Use dois niveis:

1. Backup automatico do proprio Supabase.
2. Exportacao JSON manual pelo AM3 Fleet, para ter uma copia simples dos cadastros e movimentos.

## Backup JSON local

No PowerShell:

```powershell
cd "C:\Users\am3solucoes\Documents\Codex\2026-05-25\voc-conhece-alguma-aplica-o-web\am3-fleet"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\backup-supabase.ps1
```

Informe:

```text
Host do Supabase: aws-1-sa-east-1.pooler.supabase.com
Usuario do banco Supabase: postgres.tmcdslecowxoztikmdbp
Senha do banco Supabase: sua senha do Supabase
```

O arquivo sera criado em:

```text
backups\am3-fleet-backup-AAAA-MM-DD...
```

## Restaurar JSON

Use com cuidado: a restauracao substitui os dados atuais pelo conteudo do arquivo.

```powershell
.\scripts\restore-supabase.ps1 "backups\am3-fleet-backup-AAAA-MM-DD.json"
```

## Backup pelo Render

A tela **Sistema** do AM3 Fleet tambem gera backup JSON, mas no Render o arquivo fica dentro do ambiente temporario do servico. Para uma copia local, prefira rodar `scripts\backup-supabase.ps1` no seu computador.

## Anexos

Os anexos ficam no bucket:

```text
am3-fleet
```

Para uma rotina mais completa, exporte periodicamente os arquivos do Supabase Storage pelo painel ou pela ferramenta oficial do Supabase.
