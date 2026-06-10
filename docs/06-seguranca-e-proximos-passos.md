# 06 - Segurança e próximos passos

## Pontos de segurança atuais

Implementado:

- Login por e-mail e senha.
- Sessão persistida no banco.
- Logout remove sessão.
- Troca de senha pelo usuário.
- Perfil `admin`.
- Perfil `motorista`.
- Bucket de anexos pode ser privado quando usado Supabase Storage.
- Webhook Discord fica em variável de ambiente.

## Pontos a melhorar antes de escala maior

Recomendado:

- Trocar hash SHA-256 simples por bcrypt ou argon2.
- Adicionar política de senha.
- Adicionar reset de senha administrativo.
- Adicionar expiração configurável de sessão.
- Adicionar rate limit no login.
- Adicionar logs estruturados.
- Adicionar testes automatizados.
- Separar permissões por tela/ação com mais granularidade.
- Criar rotina automática de backup.
- Revisar CORS para domínio final.
- Revisar headers de segurança.

## Banco

Para produção inicial, Postgres em modelo JSON é aceitável.

Para longo prazo:

- criar schema relacional,
- migrar coleções para tabelas,
- adicionar constraints e foreign keys,
- adicionar índices por placa, motorista, status e datas,
- criar migrations versionadas.

## Infraestrutura

Recomendado:

- HTTPS obrigatório.
- Banco em servidor gerenciado ou servidor interno com backup.
- Storage persistente com backup.
- Ambiente separado para homologação.
- Deploy controlado por Git.
- Monitoramento do endpoint `/api/health`.

## LGPD e rastreabilidade

O sistema armazena:

- dados de motoristas,
- geolocalização de devolução,
- histórico de uso de veículos,
- comprovantes/anexos.

Recomendações:

- Definir política interna de retenção.
- Informar colaboradores sobre uso de geolocalização no momento da devolução.
- Restringir acesso a relatórios e anexos.
- Definir quem pode exportar CSV.
- Manter auditoria habilitada.

## Próximas melhorias funcionais sugeridas

- Tela de configuração para webhook Discord.
- Aviso no Discord também para devolução.
- Reset de senha por admin.
- Exportação Excel `.xlsx`.
- Dashboard com filtros salvos.
- Relatório de uso por veículo/motorista.
- Controle de custos por centro de custo.
- Permissões por papel além de `admin` e `motorista`.
- API externa documentada com OpenAPI.
- Tela de manutenção preventiva por vencimento.

## Cuidados ao migrar para servidor próprio

- Testar PWA/geolocalização somente em HTTPS.
- Conferir timezone do servidor.
- Conferir tamanho máximo de upload.
- Garantir backup dos anexos.
- Garantir que `HOST=0.0.0.0`.
- Garantir que a porta do Node esteja atrás de proxy reverso.
- Não expor banco diretamente na internet sem firewall/VPN.
