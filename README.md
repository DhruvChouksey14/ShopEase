<div align="center">

# ShopEase — Distributed E-Commerce Platform

**A production-grade, event-driven microservices platform for online retail**

Built with saga orchestration, distributed locking, idempotent writes, circuit breakers,
and dual-broker messaging (Kafka + RabbitMQ) — the same patterns used in high-throughput
transactional systems applied to a shopping-cart-and-checkout domain.

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Kafka](https://img.shields.io/badge/Kafka-7.5-231F20?logo=apachekafka&logoColor=white)](https://kafka.apache.org)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-3.13-FF6600?logo=rabbitmq&logoColor=white)](https://www.rabbitmq.com)
[![Elasticsearch](https://img.shields.io/badge/Elasticsearch-8.12-005571?logo=elasticsearch&logoColor=white)](https://www.elastic.co)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)


[Architecture](#architecture) · [Features](#features) · [Tech Stack](#tech-stack) · [Getting Started](#getting-started) · [API](#api-overview) · [Design Patterns](#design-patterns--resilience) · [Observability](#observability)

</div>

---

## Overview

ShopEase is a full e-commerce backend + frontend built as **10 independently deployable services**
(9 Node.js microservices + a React SPA) communicating over HTTP, Kafka, and RabbitMQ. Every
integration is real, not mocked: Google Sign-In, SendGrid transactional email, Razorpay payments
with signature-verified webhooks, Elasticsearch-backed search, and Redis-based distributed locking.


---

## Architecture

The system is split into three views so each stays readable: the **request path** (synchronous,
gateway to services to databases), the **event backbone** (asynchronous, Kafka + RabbitMQ), and
the **checkout saga** (the one flow that touches both).

### 1. Request path — client, gateway, services, data

```mermaid
flowchart LR
    FE["Frontend\nReact + Vite\n:3000"] --> GW

    GW["API Gateway\nJWT · Rate limit\nCircuit breaker\n:4000"]

    subgraph Identity
        US["User Service\n:4001"]
    end

    subgraph Commerce["Catalog & Discovery"]
        CS["Catalog Service\n:4003"]
        SS["Search Service\n:4002"]
        CRT["Cart Service\n:4008"]
    end

    subgraph Transactions
        OS["Order Service\n:4005"]
        PS["Payment Service\n:4006"]
        IS["Inventory Service\n:4007"]
    end

    GW --> US
    GW --> CS
    GW --> SS
    GW --> CRT
    GW --> OS
    GW --> PS
    GW --> IS

    OS -->|reserve / confirm / release| IS
    OS -->|create payment order| PS
    OS -->|hydrate cart| CRT

    US --> PGU[("user_db\nPostgres")]
    CS --> PGC[("catalog_db\nPostgres")]
    OS --> PGO[("order_db\nPostgres")]
    PS --> PGP[("payment_db\nPostgres")]
    IS --> PGI[("inventory_db\nPostgres")]
    SS --> ES[("Elasticsearch")]
    CRT --> RD[("Redis")]
    IS -.locks.-> RD
    US -.refresh tokens.-> RD
    GW -.rate limits.-> RD
```

### 2. Event backbone — Kafka domain events + RabbitMQ background jobs

```mermaid
flowchart LR
    subgraph Producers
        US2["User Service"]
        CS2["Catalog Service"]
        IS2["Inventory Service"]
        OS2["Order Service"]
        PS2["Payment Service"]
    end

    subgraph Kafka["Kafka topics"]
        K1["notification.otp-email\nnotification.welcome-email"]
        K2["catalog.product-*\ncatalog.category-*"]
        K3["inventory.stock-updated"]
        K4["order.confirmed / cancelled\nfailed / shipped / delivered"]
        K5["payment.success / failed"]
    end

    subgraph Consumers
        NS2["Notification Service"]
        SS2["Search Service"]
        IS3["Inventory Service"]
        OS3["Order Service"]
    end

    US2 --> K1 --> NS2
    CS2 --> K2 --> SS2
    CS2 --> K2 --> IS3
    IS2 --> K3 --> SS2
    OS2 --> K4 --> NS2
    OS2 --> K4 --> SS2
    PS2 --> K5 --> OS3

    OS2 -->|invoice.generate| WQ["RabbitMQ"]
    WQ --> WS2["Worker Service\n(PDF invoices)"]
    WS2 -->|invoice.email| WQ2["RabbitMQ"]
    WQ2 --> NS2
```

Every Kafka consumer topic has a matching `dlq.<service-name>` topic — after `DLQ_MAX_RETRIES`
(3) consecutive failures a message is forwarded there instead of blocking the consumer. Every
RabbitMQ queue `X` gets a retry topology: `X` (main) → on reject → `X.retry` (TTL hold) →
dead-letters back to `X` → after `MAX_ATTEMPTS` (5) → `X.dead` (parking lot for manual replay).

### 3. Checkout saga — the flow that ties both together

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant GW as API Gateway
    participant O as Order Service
    participant I as Inventory Service
    participant P as Payment Service
    participant RZ as Razorpay
    participant N as Notification Service
    participant W as Worker Service

    U->>GW: POST /orders (idempotencyKey)
    GW->>O: forward (JWT verified -> x-user-id)
    O->>O: create Order (PENDING)
    O->>I: reserve stock (per SKU, Redis lock)
    I-->>O: reserved
    O->>P: create payment order
    P->>RZ: create Razorpay order
    RZ-->>P: gatewayOrderId
    P-->>O: paymentOrderId + keyId
    O-->>U: checkout details -> open Razorpay widget

    U->>RZ: pay (test card)
    RZ-->>P: webhook: payment.captured (signed)
    P->>P: verify signature -> CAPTURED
    P--)O: Kafka: payment.success
    O->>I: confirm stock (permanent decrement)
    O->>O: status -> CONFIRMED
    O-->>U: WebSocket push: order confirmed
    O--)N: Kafka: order.confirmed
    N->>N: send confirmation email
    O--)W: RabbitMQ: generate invoice
    W->>W: render PDF, publish invoice.email
    N->>N: email invoice attachment

    Note over O,I: Any step failing triggers compensateAll()<br/>in reverse order - release stock, refund payment
```

**Forward path:** `RESERVE_STOCK -> CREATE_PAYMENT -> CONFIRM_STOCK -> COMPLETE`
**Compensation path** (on any failure): release/refund whatever forward steps actually completed, in reverse order.

---

## Features

| Category | What's implemented |
| --- | --- |
| **Auth** | Email + OTP (HMAC-hashed, rate-limited, timing-safe verification), Google Sign-In, JWT access + rotating refresh tokens with reuse detection |
| **Catalog & Search** | Full CRUD product/category management, Elasticsearch-backed fuzzy search + autocomplete kept in sync via Kafka |
| **Cart** | Redis-backed, per-user, survives across devices |
| **Checkout** | Orchestrated saga across inventory -> payment -> stock confirmation, with compensating transactions on failure |
| **Payments** | Real Razorpay integration (test mode), signature-verified webhooks, refunds, full audit log, idempotent payment creation |
| **Inventory** | Per-SKU Redis distributed locks (Lua scripts, deadlock-safe via sorted key acquisition), reservation-expiry sweep |
| **Notifications** | OTP / welcome / order-lifecycle emails via SendGrid, driven by Kafka and RabbitMQ consumers |
| **Invoices** | Background PDF generation (`worker-service`) via RabbitMQ, emailed as an attachment |
| **Real-time** | Live order status pushed to the browser over Socket.IO |
| **Resilience** | Per-service circuit breakers at the gateway, Kafka DLQ topics, RabbitMQ DLX retry queues, exponential backoff on inter-service calls |
| **Observability** | Every service exposes Prometheus-format `/metrics`; pre-wired Grafana + Prometheus stack |
| **Admin** | Category/product/order/inventory management, role-gated (`ADMIN`) at the gateway |

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React 18, Vite, Tailwind CSS, Zustand, React Router, React Hook Form, Axios, Socket.IO client |
| **API Gateway** | Express, JWT, `ioredis`, custom circuit breaker + sliding-window rate limiter |
| **Services** | Express (per service), Prisma ORM (+ `pg` driver adapter), `kafkajs`, `amqplib` |
| **Datastores** | PostgreSQL 15 (one database per service), Redis 7 (cart, locks, refresh tokens, rate limits) |
| **Messaging** | Apache Kafka (domain events), RabbitMQ (background jobs, DLX retry topology) |
| **Search** | Elasticsearch 8 + Kibana |
| **Payments** | Razorpay (order creation, HMAC-signed webhooks, refunds) |
| **Email** | SendGrid |
| **PDF** | PDFKit |
| **Observability** | Prometheus (`prom-client` per service) + Grafana |
| **Infra** | Docker Compose (infra only — services run via `npm run dev`) |

---

## Repository Layout

```
EcommerceEngine/
├── server/
│   ├── api-gateway/         Routing · JWT auth · rate limiting · circuit breaker
│   ├── user-service/        Auth (OTP + Google), JWT issuance, refresh rotation
│   ├── catalog-service/     Products & categories — source of truth
│   ├── inventory-service/   Stock, reservations, Redis distributed locks
│   ├── search-service/      Elasticsearch indexing + query
│   ├── cart-service/        Redis-backed shopping cart
│   ├── order-service/       Checkout saga orchestrator + WebSocket order status
│   ├── payment-service/     Razorpay integration + signed webhooks + refunds
│   ├── notification-service/Transactional email (Kafka + RabbitMQ consumer)
│   └── worker-service/      Background PDF invoice generation (RabbitMQ)
├── shared/
│   ├── constants/kafka-topics.js   Single source of truth for topic names
│   ├── rabbitmq/rabbitmq.js        Connection + DLX retry-topology helper
│   ├── middlewares/                 Shared error handler + Prometheus metrics
│   └── utils/dlqHandler.js          Kafka consumer DLQ wrapper
├── frontend/                 React + Vite + Tailwind + Zustand
├── docker/prometheus.yml     Scrape config for all services
├── docker-compose.yml        Infrastructure: Postgres, Redis, Kafka, RabbitMQ, ES, Prometheus, Grafana
└── LOCAL_SETUP.md            Full setup guide incl. third-party credentials
```

Each service is self-contained — its own `package.json`, `.env.example`, and (where it owns
data) `prisma/schema.prisma` — and can be run, tested, and deployed independently.

---

## Data Model (per service)

Each service owns its database exclusively — no service reaches into another's tables directly;
all cross-service reads go through HTTP or events.

| Service | Models |
| --- | --- |
| `user-service` | `User`, `AuthProvider` |
| `catalog-service` | `Category`, `Product` |
| `inventory-service` | `Stock`, `StockReservation`, `IdempotencyRecord` |
| `order-service` | `Order`, `OrderItem`, `SagaLog`, `IdempotencyRecord` |
| `payment-service` | `PaymentOrder`, `Refund`, `PaymentAuditLog`, `IdempotencyRecord` |

`SagaLog` and `PaymentAuditLog` exist specifically so failures are diagnosable after the fact —
every saga step and every webhook/verification attempt is recorded before and after execution.

---

## Design Patterns & Resilience

| Pattern | Where | Why |
| --- | --- | --- |
| **Saga (orchestration)** | `order-service/src/services/saga.service.js` | Coordinates a multi-service transaction (stock -> payment -> stock confirm) without 2PC, with explicit compensation on failure |
| **Distributed locking** | `inventory-service/src/utils/distributedLock.js` | Redis + Lua scripts, all-or-nothing multi-key acquisition, sorted keys to avoid cross-checkout deadlocks, fails closed on Redis errors |
| **Circuit breaker** | `api-gateway/src/services/proxy.js` | Per-downstream-service breaker (CLOSED -> OPEN -> HALF_OPEN) so one failing service can't cascade into gateway-wide outages |
| **Idempotency keys** | Order creation, payment order creation, refunds, Kafka consumers | Safe retries on network blips without double-charging or double-reserving stock |
| **Rate limiting** | `api-gateway/src/middlewares/rateLimiting.middleware.js` | Redis sliding-window, combined IP + user + per-endpoint limits (e.g. 5 checkout attempts/min) |
| **Dead-letter queues** | Kafka (`shared/utils/dlqHandler.js`) and RabbitMQ (`shared/rabbitmq/rabbitmq.js`) | Poison messages are quarantined instead of blocking a partition/queue forever |
| **Signed webhooks** | `payment-service` | Razorpay webhook signature verified before any state change; raw body preserved via `express.raw()` ahead of the JSON parser |
| **Refresh-token rotation** | `user-service/src/services/auth.service.js` | Each refresh issues a new `jti`; reuse of an old one is treated as a stolen-token signal and force-invalidates the session |
| **Database-per-service** | Every stateful service | No shared schema — services are independently deployable and scalable |

---

## Getting Started

### Prerequisites
- Node.js 18+, npm 9+
- Docker Desktop (or Docker Engine + Compose v2)
- Free accounts: [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (OAuth), [SendGrid](https://signup.sendgrid.com), [Razorpay](https://dashboard.razorpay.com/signup) 

### 1. Start infrastructure
```bash
docker compose up -d
docker compose ps
```

### 2. Configure environment
```bash
for service in api-gateway user-service search-service catalog-service \
               notification-service order-service payment-service \
               inventory-service cart-service worker-service; do
  cp "server/$service/.env.example" "server/$service/.env"
done
```

### 3. Run migrations
```bash
for service in user-service catalog-service inventory-service order-service payment-service; do
  (cd "server/$service" && npx prisma migrate deploy)
done
```

### 4. Start services
```bash
# From each service directory:
npm install && npm run dev

# Or run all in parallel with your preferred process manager (pm2, concurrently, turbo, etc.)
```

### 5. Start the frontend
```bash
cd frontend
npm install
npm run dev   # http://localhost:3000
```

> Razorpay webhooks can't reach `localhost` — tunnel the gateway with [ngrok](https://ngrok.com)
> and register `https://<tunnel>/api/payments/webhooks/razorpay` in the Razorpay dashboard.

---

## API Overview

All traffic goes through the gateway at `http://localhost:4000/api`.

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/users/auth/send-otp` | Public | Request signup OTP |
| `POST` | `/users/auth/verify-otp` | Public | Verify OTP, create account |
| `POST` | `/users/auth/login` | Public | Email + password login |
| `POST` | `/users/auth/google-auth` | Public | Google Sign-In |
| `POST` | `/users/auth/refresh` | Cookie | Rotate access/refresh tokens |
| `GET` | `/catalog/products` | Public | List / filter products |
| `POST` | `/catalog/products` | Admin | Create product |
| `GET` | `/search/products?q=` | Public | Fuzzy search |
| `GET` \| `POST` | `/cart` / `/cart/items` | User | View / modify cart |
| `POST` | `/orders` | User | Checkout — starts the saga |
| `GET` | `/orders/:orderId` | User (owner) / Admin | Order detail |
| `POST` | `/orders/:orderId/verify-payment` | User (owner) | Client-side payment verification |
| `POST` | `/orders/:orderId/cancel` | User (owner) | Cancel + trigger compensation |
| `POST` | `/orders/:orderId/ship` | Admin | Mark shipped |
| `POST` | `/payments/webhooks/razorpay` | Signed | Razorpay event webhook |



---

## Observability

Every service exposes:
- `GET /health` — liveness + downstream dependency (DB) check
- `GET /metrics` — Prometheus format: request-duration histograms, default Node.js process metrics

`docker/prometheus.yml` scrapes all services; point Grafana at `http://prometheus:9090` as a
data source and build dashboards from `http_request_duration_seconds` / `http_requests_total`.

---

## Scaling & Failure Handling

- **Stateless services** — no in-memory session state; horizontal scaling is just running more
  instances behind the gateway. Kafka consumer groups and RabbitMQ competing consumers
  load-balance automatically across instances.
- **Exponential backoff** on inter-service HTTP calls, Kafka producer retries, RabbitMQ DLX
  retries, and SendGrid retries.
- **Fail-closed locking** — if Redis is unreachable during stock reservation, the request is
  rejected rather than risking an oversold SKU.
- **Reservation-expiry sweep** — a background interval releases stock reservations that were
  never confirmed (abandoned checkouts), independent of the saga's own compensation path.

---
