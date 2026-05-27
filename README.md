# Sync Service — CQRS Read Model

> Consume `data.*` events de TODOS los microservicios y los proyecta en MongoDB como vistas denormalizadas. Es el "read model" del patrón CQRS del proyecto.

## Qué hace

En el proyecto, cada microservicio escribe en su **propia Postgres** (gateway tiene su DB, email la suya, identity la suya, etc.). Eso da aislamiento pero **complica las consultas cross-canal**. Por ejemplo:

> "Dame TODAS las conversaciones del usuario X — WhatsApp + Instagram + Slack + email"

Sin un read model, eso requeriría joinear 5 bases de datos distintas (imposible — son DBs separadas). Con **sync**, el gateway hace una sola query a Mongo y le devuelve el resultado unificado al instante.

### Cómo funciona

```
┌────────────┐   data.identity.user.linked    ┌─────────────────┐
│ identity   │ ──────────────────────────────▶│                 │
└────────────┘                                │                 │
                                              │                 │
┌────────────┐   data.whatsapp.message.*      │                 │
│ whatsapp   │ ──────────────────────────────▶│                 │
└────────────┘                                │ SYNC (este svc) │
                                              │                 │
┌────────────┐   data.email.message.received  │ ┌─────────────┐ │
│ email      │ ──────────────────────────────▶│ │  Projector  │ │──▶ MongoDB
└────────────┘                                │ └─────────────┘ │   (read model)
                                              │                 │
┌────────────┐   data.scraping.job.completed  │                 │
│ scrapping  │ ──────────────────────────────▶│                 │
└────────────┘                                └─────────────────┘
                                                      ▲
                                                      │ GET /internal/query/*
                                                      │ (X-Internal-Auth)
                                              ┌───────┴────────┐
                                              │    Gateway     │
                                              └────────────────┘
```

Cada microservicio publica eventos `data.<servicio>.<entidad>.<acción>` después de cada commit en su Postgres. El sync los consume, denormaliza y los upserta en colecciones de MongoDB (`UnifiedUser`, `UnifiedConversation`, `UnifiedMessage`, `UnifiedEmail`).

### ⚠️ Excepción a la regla "no HTTP directo entre servicios"

Per la skill del proyecto, los servicios solo hablan vía RabbitMQ — **excepto** este caso. El **gateway llama a este servicio vía HTTPS** porque es el único patrón en el que tiene sentido (queries síncronas que devuelven datos agregados, no acciones). Está documentado como excepción en [../CLAUDE.md](../CLAUDE.md) y protegido con header `X-Internal-Auth`.

## Stack

| Pieza | Valor |
|---|---|
| Framework | NestJS 10 |
| Lenguaje | TypeScript 5 |
| **DB** | **MongoDB 7** (NO Postgres — es read model denormalizado) |
| Mensajería | RabbitMQ — consume `data.*` events |
| Puerto | `3012` |

> **Por qué MongoDB y no Postgres:** las proyecciones son documentos anidados (un User tiene un array de `identities[]`, un Conversation tiene metadata variable según canal, etc.). Mongo encaja perfecto para este shape. Y como es read-only, no necesitamos JOINs ni transacciones — solo upserts idempotentes por `_id`.

## Modelo de datos (colecciones)

Todos los `_id` son el UUID del producer (idempotente y replay-safe).

### `UnifiedUser`
Source: `data.identity.user.linked`. Aggregate del usuario con todas sus identities cross-canal + contadores.

```typescript
{
  _id: "user-uuid",
  displayName: "Christian",
  identities: [
    { channel: "whatsapp", channelUserId: "573205711428", trustScore: 0.95 },
    { channel: "instagram", channelUserId: "17841...", trustScore: 0.9 },
    { channel: "email", channelUserId: "scristxyz@gmail.com", trustScore: 1.0 }
  ],
  conversationCount: 14,
  messageCount: 230,
  lastSeenAt: ISODate("..."),
  firstSeenAt: ISODate("...")
}
```

### `UnifiedConversation`
Source: `data.<channel>.conversation.created`. Conversaciones de cualquier canal con un shape uniforme.

### `UnifiedMessage`
Source: `data.<channel>.message.received` (USER → BOT) + `data.<channel>.message.sent` (BOT → USER). Append-only.

### `UnifiedEmail`
Source: `data.email.message.sent` + `data.email.message.received`. Campo `direction` (`inbound` / `outbound`) discrimina. Lifecycle del outbound mirror del producer.

### `UnifiedScrapingTask`
Source: `data.scraping.job.completed`. Snapshots de scraping jobs con su resultado.

## Eventos consumidos (`data.*`)

| Routing key pattern | Producer | Projector |
|---|---|---|
| `data.identity.user.linked` | identity | `identity.projector.ts` |
| `data.<channel>.conversation.created/updated/deleted` | whatsapp / instagram / slack / agent | `conversation.projector.ts` |
| `data.<channel>.message.received` | whatsapp / instagram / slack / agent | `message.projector.ts` |
| `data.<channel>.message.sent` | whatsapp / instagram / slack / agent | `message.projector.ts` |
| `data.email.message.sent / received / delivered / bounced / opened / clicked` | email | `email.projector.ts` |
| `data.scraping.job.completed / failed` | scrapping | `scraping.projector.ts` |

Las routing keys empiezan con `data.` (no `channels.`) — por convención del proyecto, `channels.*` son comandos/responses, `data.*` son eventos de cambio de estado para CQRS.

## Endpoints HTTP (internos — solo llamados por el gateway)

Todos requieren header `X-Internal-Auth: <token>` (configurado en `INTERNAL_AUTH_TOKEN` del `.env`).

| Método | Path | Devuelve |
|---|---|---|
| GET | `/internal/query/users` | Lista de UnifiedUsers (con filtros) |
| GET | `/internal/query/users/:userId` | Un user con todas sus identities |
| GET | `/internal/query/users/:userId/conversations` | Todas las convos del user, cross-canal |
| GET | `/internal/query/users/:userId/scraping-tasks` | Jobs de scraping del user |
| GET | `/internal/query/users/:userId/emails` | Emails (in + out) del user |
| GET | `/internal/query/conversations` | Lista global con filtros |
| GET | `/internal/query/conversations/:id` | Una convo |
| GET | `/internal/query/conversations/:id/messages` | Mensajes de la convo |
| GET | `/internal/query/scraping-tasks` | Lista de scraping jobs |
| GET | `/internal/query/scraping-tasks/:id` | Un job |
| GET | `/internal/query/emails` | Lista global de emails |
| GET | `/internal/query/emails/:id` | Un email |
| GET | `/internal/query/search?q=...` | Búsqueda cross-collection |
| GET | `/health` | Health check (sin auth) |

> ⚠️ **Estos endpoints NO se exponen al frontend** — son privados gateway↔sync. El gateway los wraps en sus propios endpoints `/v1/*` con auth/permissions/etc.

## Configuración (`.env`)

```env
SYNC_PORT=3012
SYNC_DATABASE_URL=mongodb://mongo:27017/sync_db?replicaSet=rs0
RABBITMQ_URL=amqp://admin:password@rabbitmq:5672
INTERNAL_AUTH_TOKEN=<token-compartido-con-el-gateway>
```

## Cómo correrlo

```bash
docker-compose up -d sync
```

Dev local:
```bash
cd sync
pnpm install
pnpm prisma:generate
pnpm start:dev
```

## Replay del read model

Si querés rebuildar el read model desde cero (ej: después de un bug en un projector):

1. Borrar las colecciones de Mongo: `db.UnifiedUser.drop()`, etc.
2. Re-publicar todos los eventos pasados desde cada producer (cada microservicio tiene su comando de "replay all" en su propio service)
3. Sync va a consumir y rebuildar todo

Los proyectores son **idempotentes** (upsert por `_id`), así que el replay es seguro. No se duplica nada.

## ⚠️ Reglas de producer-side (para developers de los otros servicios)

Cuando agregás un nuevo evento `data.*` en otro servicio:

1. **Publicar SIEMPRE después de que Postgres commitó** — nunca antes. Si la transacción falla, el evento no debe salir.
2. **Incluir el `_id` estable** (típicamente el UUID de la fila) — para que el upsert sea idempotente
3. **Documentar la routing key** en `<service>/src/rabbitmq/constants/queues.ts`
4. **Agregar projector aquí** en `sync/src/sync/projectors/` para consumirlo

## Ver también

- **[../CLAUDE.md](../CLAUDE.md)** — patrón CQRS general
- **[../AGENTS.md](../AGENTS.md)** — arquitectura completa
- **[../gateway/README.md](../gateway/README.md)** — quién consume estos endpoints
