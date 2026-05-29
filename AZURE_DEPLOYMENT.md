# AM3 Fleet na Azure

Este roteiro prepara o AM3 Fleet para sair do uso local e passar a usar um banco acessivel de qualquer lugar com seguranca.

## Decisao recomendada

Use **Azure SQL Database** para o banco de dados.

Motivos:

- Mantem a familia SQL Server, que voce ja conhece.
- Nao precisa expor o SQL Server 2008 local na internet.
- A Microsoft cuida de atualizacao, disponibilidade, backups e criptografia da infraestrutura.
- A aplicacao atual ja fala com SQL Server, entao a mudanca e menor do que trocar para PostgreSQL ou outro banco.

## Criar o banco no portal da Azure

1. Entre no portal da Azure.
2. Crie um recurso **Azure SQL Database**.
3. Crie um servidor logico, por exemplo:

```text
am3-fleet-sql
```

4. Crie o banco:

```text
AM3Fleet
```

5. Escolha a oferta gratuita se ela estiver disponivel na sua assinatura.
6. Em rede/firewall, libere somente os IPs que vao acessar o banco:
   - seu computador, enquanto estiver testando;
   - o servico onde a aplicacao Node for publicada.

Evite habilitar acesso publico amplo para qualquer IP. O banco pode ser publico na Azure, mas deve ficar restrito por firewall.

## Variaveis da aplicacao

Use o arquivo `.env.azure.example` como referencia. No Azure, configure esses valores como variaveis do aplicativo, nao dentro do codigo.

```text
DB_TYPE=sqlserver
DB_SQLSERVER_MODE=relational
DB_HOST=am3-fleet-sql.database.windows.net
DB_PORT=1433
DB_DATABASE=AM3Fleet
DB_USER=am3fleet_app
DB_PASSWORD=sua_senha_forte
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=false
```

Para o SQL Server 2008 local, continue usando o script atual `scripts/start-sqlserver-rubens.ps1`, que mantem `DB_TDS_VERSION=7_2`.

Para Azure SQL, nao informe `DB_TDS_VERSION`, salvo se houver uma necessidade especifica.

## Criar as tabelas no Azure SQL

Depois de criar o banco, rode o script:

```text
scripts/sqlserver-relational-schema.sql
```

Ele cria as tabelas relacionais usadas pelo AM3 Fleet.

## Migrar os dados

Fluxo recomendado:

1. Faca um backup/exportacao pelo AM3 Fleet atual.
2. Teste a conexao com o Azure SQL usando as variaveis do arquivo `.env.azure.example`.
3. Rode a migracao para inserir os dados no Azure SQL.
4. Acesse o sistema apontando para o banco da Azure e confira:
   - login;
   - veiculos;
   - motoristas;
   - saidas rapidas;
   - prestacao de contas;
   - relatorios.

## Publicar a aplicacao

Depois que o banco estiver validado, publique a aplicacao Node em um servico web.

Opcoes:

- **Azure App Service**: mais simples para manter Node rodando e usar HTTPS.
- **Azure VM pequena**: mais parecida com um servidor tradicional, mas voce cuida mais da manutencao.

Para comecar, a melhor escolha e Azure App Service. Ele entrega uma URL `azurewebsites.net` com HTTPS. Dominio proprio normalmente exige plano pago.

## Checklist antes de liberar

- Trocar senha do administrador.
- Criar usuarios reais da equipe.
- Confirmar que o banco esta em `DB_ENCRYPT=true` e `DB_TRUST_SERVER_CERTIFICATE=false`.
- Restringir firewall do Azure SQL.
- Validar backup.
- Validar anexos/uploads, pois arquivos enviados hoje ficam na pasta local `uploads`.
- Testar acesso externo por celular ou outra rede.
- Definir se a URL sera provisoria `azurewebsites.net` ou dominio proprio.

