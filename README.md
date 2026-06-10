# AM3 Fleet

Aplicação web/PWA para gestão de frota empresarial.

## Início rápido

```powershell
npm install
npm start
```

URL local:

```text
http://127.0.0.1:4174
```

## Documentação para a equipe

Comece por:

- `DEV_HANDOFF.md`
- `docs/01-arquitetura.md`
- `docs/02-ambiente-e-deploy.md`
- `docs/03-banco-e-storage.md`
- `docs/04-operacao-backup-e-producao.md`
- `docs/05-api-e-integracoes.md`
- `docs/06-seguranca-e-proximos-passos.md`

## Arquivos importantes

- `server.js`: API/backend.
- `database.js`: persistência SQLite/Postgres/SQL Server.
- `app.js`: frontend.
- `index.html`: telas.
- `styles.css`: estilos.
- `service-worker.js`: cache PWA.
- `scripts/`: backup, restore e limpeza.
- `sql/`: schemas mínimos de banco.

## Segurança

Não versionar:

- `.env`
- senhas
- webhooks reais
- service role key
- backups reais
- anexos reais

Use `production.env.example` como modelo.
