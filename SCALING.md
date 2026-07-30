# GlowOra — Scaling Guide (to 1,000,000+ users)

This is the playbook for handling a big launch and growing without breaking or slowing down. **The most important idea: scale comes from architecture + infrastructure, not from the framework.** GlowOra's backend is already built to scale horizontally — this guide shows how to deploy it that way.

---

## How many users can it handle?

| Setup | Concurrent users (active at once) | Registered users |
|---|---|---|
| 1 small server, no Redis | ~500–2,000 | lakhs (fine) |
| 1 server + PM2 clustering + Redis | ~5,000–15,000 | millions (fine) |
| Multiple servers + load balancer + Atlas + Redis | **50,000–100,000+** | unlimited |
| + read replicas + sharding | **millions concurrent** | unlimited |

> "Registered users" is just rows in the DB — that scales trivially. The real number to watch is **concurrent** users (active at the same second). A typical launch sees far fewer concurrent than registered.

Get the *real* number for your hardware by running the load test (below) — never trust an estimate over a measurement.

---

## What's already built in (scale-ready features)

- **Stateless API + JWT** — any instance can serve any request → horizontal scaling works.
- **PM2 cluster mode** (`ecosystem.config.cjs`) — one Node process per CPU core on each server.
- **BullMQ job queue** — notifications/emails/broadcasts run in the background, so API responses stay fast under load.
- **Socket.IO Redis adapter** — chat works correctly across many servers behind a load balancer.
- **Redis caching + OTP/session store** (with in-memory dev fallback).
- **gzip compression**, tuned **Mongo connection pool**, pagination on every list.
- **Rate limiting**, health check (`/health`), graceful shutdown — ready for a load balancer + autoscaler.

---

## The scaling ladder (do these in order, as traffic grows)

### Stage 0 — Launch day (1 good server)
```
[ Users ] → [ Nginx/ALB ] → [ 1 server: PM2 cluster (all cores) ]
                                   ↓
                        [ MongoDB Atlas M10 ] [ Redis ]
```
- Run the API with **PM2 cluster mode** (`pm2 start ecosystem.config.cjs`).
- Use **MongoDB Atlas** (managed, not local) — start at M10/M20.
- Use a **managed Redis** (Upstash / AWS ElastiCache) — powers queue + socket adapter + cache.
- Put a CDN (**Cloudflare / CloudFront**) in front of images/static.
- Handles ~5k–15k concurrent. Enough for almost any launch.

### Stage 1 — Growth (multiple servers)
```
[ Users ] → [ Load Balancer ] → [ server 1 ] [ server 2 ] [ server 3 ] ...
                                        ↓ (all share)
                          [ MongoDB Atlas ]   [ Redis ]
```
- Run the **same app on N servers** (containers/EC2/ECS) behind a load balancer.
- Because the app is **stateless + Redis-backed**, this "just works" — no code change.
- This is **horizontal scaling**: more traffic → add more servers. Practically unlimited.
- Handles 50k–100k+ concurrent.

### Stage 2 — Database scaling (the real bottleneck)
The DB is almost always what breaks first, not the app.
- **Indexes** — already defined on hot fields; verify with `explain()` on slow queries.
- **Read replicas** — send read-heavy queries (salon browsing, search) to replicas.
- **Meilisearch/Elasticsearch** — move salon/product search off MongoDB when it gets heavy.
- **Sharding** — only at very large scale, shard by city/region.
- **Cache aggressively in Redis** — cache nearby-salons, cities, banners (they rarely change).

### Stage 3 — Split services (only when huge)
- Run the **notification worker** as its own process/container (already separable — just run `src/workers/notification.worker.js`).
- Split chat/socket servers from the REST API.
- Move media processing (image resize) to a separate service / Lambda.

---

## Deployment checklist (production)

- [ ] `NODE_ENV=production`
- [ ] Rotate ALL secrets in `.env` (JWT, cookie, ENCRYPTION_KEY = 64 hex)
- [ ] MongoDB **Atlas** with IP allowlist + strong user (not local Mongo)
- [ ] Managed **Redis** (Upstash/ElastiCache) — set `REDIS_URL`
- [ ] TLS/HTTPS terminated at the load balancer (never plain HTTP)
- [ ] `pm2 start ecosystem.config.cjs` (or Docker + orchestrator)
- [ ] CDN in front of Cloudinary/static assets
- [ ] Sentry (errors) + uptime monitoring + basic dashboards
- [ ] `npm audit` clean
- [ ] Autoscaling rule: add an instance when CPU > 70% for 5 min
- [ ] Run the load test below and confirm p95 < 500ms at target load

---

## Load testing (measure, don't guess)

```bash
# install k6: https://k6.io/docs/get-started/installation/
k6 run loadtest/k6-smoke.js                       # local
k6 run -e BASE=https://api.glowora.life loadtest/k6-smoke.js   # against prod
```
The script ramps to 1,000 virtual users and asserts p95 latency < 500ms and error rate < 1%. Raise the target to rehearse a launch spike. If it fails: check DB (indexes/replicas) first, then add servers.

---

## Env vars for scaling

```
REDIS_URL=redis://<managed-redis>       # enables queue + socket adapter + cache
DB_MAX_POOL=50                          # DB sockets per instance
DB_MIN_POOL=5
```

## Golden rules

1. **The database is the first bottleneck — cache reads and index everything.**
2. **Keep the app stateless — then scaling is just "add servers".**
3. **Do slow work (push/email/reports) in the queue, never in the request.**
4. **Measure with load tests before every big launch; don't guess.**
5. **Scale up (bigger DB) first, then scale out (more servers) — in that order it's cheaper.**

---
© 2026 GlowOra.life
