# Anexos no Supabase Storage

O AM3 Fleet suporta dois modos de anexos:

- `local`: salva na pasta `uploads`, bom para teste local.
- `supabase`: salva no Supabase Storage, recomendado para acesso externo.

## Criar bucket

No Supabase:

1. Abra o projeto.
2. Entre em **Storage**.
3. Clique em **New bucket**.
4. Nome:

```text
am3-fleet
```

5. Deixe privado.

## Pegar chave do servidor

1. Entre em **Project Settings**.
2. Entre em **API Keys**.
3. Copie a chave **service_role**.

Use essa chave somente no servidor onde o Node roda.

## Rodar com Storage

No PowerShell:

```powershell
cd "C:\Users\am3solucoes\Documents\Codex\2026-05-25\voc-conhece-alguma-aplica-o-web"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\start-supabase.ps1
```

Quando o script perguntar:

```text
Usar Supabase Storage para anexos agora? (S/N)
```

Responda `S` e cole a `service_role key`.

## Como os arquivos ficam protegidos

O bucket pode ser privado. A aplicacao salva o arquivo no Storage e guarda no banco um caminho como:

```text
/api/files/...
```

Quando o usuario abre o anexo pela tela do AM3 Fleet, o servidor busca o arquivo no Supabase Storage usando a chave segura do servidor.
