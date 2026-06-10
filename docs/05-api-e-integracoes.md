# 05 - API e integrações

## Autenticação

Login:

```http
POST /api/login
Content-Type: application/json
```

Body:

```json
{
  "email": "usuario@empresa.com",
  "password": "senha"
}
```

Resposta:

```json
{
  "token": "...",
  "user": {}
}
```

Enviar token nas demais rotas:

```http
Authorization: Bearer TOKEN
```

Logout:

```http
POST /api/logout
```

Troca de senha:

```http
POST /api/me/password
```

Body:

```json
{
  "currentPassword": "senha_atual",
  "newPassword": "nova_senha"
}
```

## Dados gerais

```http
GET /api/data
```

Retorna todas as coleções permitidas para o usuário.

## CRUD genérico

Coleções:

- `vehicles`
- `drivers`
- `bookings`
- `quickExits`
- `fuel`
- `maintenance`
- `checklists`
- `documents`
- `users`

Criar:

```http
POST /api/:collection
```

Editar:

```http
PUT /api/:collection/:id
```

Remover:

```http
DELETE /api/:collection/:id
```

## Modo motorista

Retirada:

```http
POST /api/mobile/checkout
```

Body:

```json
{
  "vehicleId": "id",
  "destination": "Cliente ou destino",
  "reason": "Retirada pelo modo motorista"
}
```

Devolução:

```http
POST /api/mobile/return
```

Body:

```json
{
  "quickExitId": "id",
  "notes": "Veículo devolvido à empresa.",
  "returnLatitude": -0.000,
  "returnLongitude": -0.000,
  "returnAccuracy": 25,
  "returnLocationAt": "2026-06-10T08:00"
}
```

## Eventos em tempo real

```http
GET /api/events
```

Usa Server-Sent Events.

Evento enviado:

```text
event: data-changed
data: {"collection":"quickExits","action":"checkout","id":"...","at":"..."}
```

## Upload e anexos

Upload:

```http
POST /api/upload
```

Aceita multipart/form-data ou JSON conforme implementação atual.

Acesso a arquivo:

```http
GET /api/files/:path
```

## Discord

Variável:

```text
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Quando uma saída rápida aberta é criada, o servidor envia mensagem:

```text
Saída de veículo registrada
Motorista: ...
Veículo: ...
Destino: ...
Saída: ...
Registrado por: ...
```

Essa integração é assíncrona. Se o Discord falhar, a retirada não é bloqueada; o erro fica no log do servidor.

## Integração SQL para Discord/consultas externas

No Supabase/Postgres atual, os dados ficam em:

```text
public.am3_fleet_records
```

Campos:

- `collection`
- `id`
- `payload`
- `created_at`
- `updated_at`

Exemplo de consulta resumida de veículos:

```sql
WITH vehicles AS (
  SELECT
    id,
    payload
  FROM public.am3_fleet_records
  WHERE collection = 'vehicles'
),
open_exits AS (
  SELECT
    payload
  FROM public.am3_fleet_records
  WHERE collection = 'quickExits'
    AND lower(payload->>'status') = 'aberta'
)
SELECT
  v.payload->>'plate' AS placa,
  v.payload->>'model' AS veiculo,
  CASE
    WHEN q.payload IS NULL THEN 'DISPONIVEL'
    ELSE concat(
      'EM USO | ',
      coalesce(d.payload->>'name', 'Motorista não encontrado'),
      ' | ',
      coalesce(q.payload->>'destination', 'Destino não informado')
    )
  END AS resumo
FROM vehicles v
LEFT JOIN open_exits q ON q.payload->>'vehicleId' = v.id
LEFT JOIN public.am3_fleet_records d
  ON d.collection = 'drivers'
 AND d.id = q.payload->>'driverId'
ORDER BY v.payload->>'plate';
```

Para integração externa, usar usuário somente leitura.
