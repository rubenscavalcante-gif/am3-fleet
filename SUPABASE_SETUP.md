# AM3 Fleet com Supabase

Este e o caminho mais simples para colocar o banco do AM3 Fleet fora do computador local.

## 1. Criar conta e projeto

1. Acesse o Supabase.
2. Crie uma conta.
3. Crie um novo projeto.
4. Guarde:
   - host do banco;
   - usuario;
   - senha;
   - nome do banco, geralmente `postgres`;
   - porta, geralmente `5432`.

## 2. Configurar o banco

O AM3 Fleet cria automaticamente a tabela:

```sql
public.am3_fleet_records
```

Ela guarda os registros da aplicacao em JSON. Isso permite migrar mais rapido sem alterar as telas agora.

## 3. Rodar local apontando para Supabase

No PowerShell, dentro da pasta do projeto:

```powershell
.\scripts\start-supabase.ps1
```

O script pergunta host, usuario e senha no terminal.

## 4. Migrar dados atuais

Primeiro gere um backup JSON pela tela **Sistema** do AM3 Fleet atual.

Depois rode:

```powershell
$env:DB_HOST="db.seu-projeto.supabase.co"
$env:DB_USER="postgres"
$env:DB_PASSWORD="sua_senha"
$env:DB_SSL="true"
$env:DB_SSL_REJECT_UNAUTHORIZED="false"
npm run import:postgres -- "backups\arquivo-do-backup.json"
```

## 5. Pontos importantes

- O banco fica online no Supabase.
- Os anexos podem ficar no Supabase Storage quando `STORAGE_DRIVER=supabase`.
- Depois disso, publicamos a aplicacao Node em um servico web simples.

## 6. Supabase Storage para anexos

No Supabase:

1. Acesse **Storage**.
2. Crie um bucket chamado:

```text
am3-fleet
```

3. Pode deixar o bucket privado.
4. Acesse **Project Settings > API Keys**.
5. Copie a chave **service_role**.

No PowerShell, ao iniciar com `scripts\start-supabase.ps1`, responda `S` quando o script perguntar se deseja usar Supabase Storage e cole a `service_role key`.

Variaveis usadas:

```powershell
$env:STORAGE_DRIVER="supabase"
$env:SUPABASE_URL="https://tmcdslecowxoztikmdbp.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="sua_service_role_key"
$env:SUPABASE_STORAGE_BUCKET="am3-fleet"
```

A `service_role key` deve ficar apenas no servidor. Nao coloque essa chave no navegador nem envie para usuarios.
