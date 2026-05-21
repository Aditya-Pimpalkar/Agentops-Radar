# AgentOps Radar — Project Report

**Platform:** AI Agent Observability, Evaluation & Debugging  
**Build Date:** May 2026  
**Author:** Aditya Pimpalkar

---

## Executive Summary

AgentOps Radar is a production-grade observability platform built for AI agent workflows. It solves the core problem that most LLM/agent frameworks have no native tooling to answer: *Why did my agent fail? How do I reproduce it? How do I know it won't fail the same way again?*

The platform captures every model call, tool invocation, retrieval step, guardrail check, and retry — structures it as a searchable, replayable trace — and automatically scores each run across 8 rule-based dimensions plus an LLM-as-judge. Failed runs are embedded with OpenAI's `text-embedding-3-small` and stored in pgvector so engineers can instantly find semantically similar past failures.

---

## Problem Statement

Modern AI agents are non-deterministic and opaque. When a production agent fails:

1. There is no structured log of *what steps the agent took*, only unstructured stdout.
2. Root-cause analysis requires manually replaying the agent — which is slow and non-reproducible.
3. There is no way to measure *whether a fix actually improved the agent's behaviour* across a population of historical traces.
4. Similar failures keep occurring because there's no way to detect that a new failure looks like a previous one.

AgentOps Radar addresses all four problems: structured trace capture, deterministic replay, quantified scoring, and semantic failure search.

---

## Architecture Overview

```
Client (Python SDK / REST)
        │  HTTP /v1/ingest  or  gRPC :9090
        ▼
Go Ingestion Service (:8080 / :9090)
  ├─ HTTP gateway (gateway.go) — zero-copy in-process bridge
  ├─ gRPC server (server.go) — auth, UUID assignment
  └─ franz-go Kafka producer — AllISRAcks, idempotent, 5ms linger
        │
        ▼
Kafka (KRaft, 3 partitions per topic, key=run_id)
  ├─ trace.run.start
  ├─ trace.event.add
  └─ trace.run.end
        │
    ┌───┴──────────────────────┐
    ▼                          ▼                          ▼
store_consumer           eval_consumer             embed_consumer
(radar-store)            (radar-eval)              (radar-embed)
  │ Writes runs +           │ 8 rule-based             │ Failed/low-conf runs
  │ events to PG            │ evaluators +             │ only; OpenAI
  │                         │ LLM judge (gpt-4o-mini)  │ text-embedding-3-small
  ▼                         ▼                          ▼
PostgreSQL + pgvector (runs, trace_events, evaluations, trace_embeddings)
        │
        ▼
FastAPI (:8000) + Celery Worker (Redis)
  ├─ /api/runs/{id}/trace
  ├─ /api/runs/{id}/evaluate
  ├─ /api/runs/{id}/replay
  ├─ /api/runs/{id}/similar  ─── pgvector cosine search
  └─ /api/analytics/*
        │
        ▼
Next.js Dashboard (:3000)
  ├─ /dashboard   — failure rate, latency p50/p95, eval pass rate
  ├─ /runs        — paginated run list with badges
  ├─ /runs/[id]   — trace timeline, eval scorecard, replay panel, similar failures
  └─ /playground  — live streaming trace demo
```

---

## Component Deep-Dives

### 1. Go Ingestion Service

**Why Go?** Trace ingestion is the hot path — it must handle bursts of events from many concurrent agents with sub-millisecond overhead. Go's goroutine concurrency model and minimal GC pauses make it ideal for this role. A Python service here would introduce unnecessary overhead and unpredictable latency under load.

**Architecture decision — in-process gRPC bridge:**  
Rather than running an HTTP service that dials a separate gRPC server over loopback, `gateway.go` holds a direct Go interface reference to the `IngestionServiceServer`. HTTP handlers call `gw.svc.StartRun()` directly. The API key is injected via `metadata.NewIncomingContext` so the gRPC `authenticate()` function works without any network layer.

*Why not a real gRPC → HTTP reverse proxy?* The standard approach (`grpc-gateway`) generates protobuf-serialised structs over the wire, which requires all types to implement `proto.Message`. Using hand-written stubs without a protoc toolchain means plain Go structs — the in-process bridge avoids the codec entirely.

**Kafka producer settings:**  
- `AllISRAcks()` (acks=-1): required for idempotency; franz-go enables the idempotent producer by default which requires all in-sync replicas to acknowledge.  
- `5ms linger`: batches events from concurrent requests into fewer Kafka records, improving throughput without meaningful latency impact.  
- `ProduceSync`: back-pressure friendly — if Kafka is behind, the HTTP response waits, giving the caller a clear signal.

---

### 2. Kafka Fan-out (3 Consumer Groups)

**Why Kafka over a direct DB write?** The ingestion service can receive thousands of events per second from multiple agents. Writing synchronously to PostgreSQL on every event would make the ingestion latency dependent on DB write latency and connection pool pressure. Kafka decouples the write path from processing — ingestion returns immediately after producing to Kafka, and consumers process at their own pace.

**Co-partitioning by `run_id`:**  
All three topics use `run_id` as the partition key. This means all messages for a given run land on the same partition in each topic. Within a partition, Kafka guarantees ordering. This is critical: `store_consumer` must see `run.start` before `event.add` and `event.add` before `run.end` — otherwise the FK constraint (`trace_events.run_id → runs.id`) would fail.

**Three isolated consumer groups:**  
- `radar-store`: pure DB writes, no external calls. Fastest consumer; must complete before eval and embed consumers query the DB.
- `radar-eval`: evaluates run quality. Has a 2-second delay to let `store_consumer` finish first (a simple operational guard — a production system might use a saga pattern instead).
- `radar-embed`: generates OpenAI embeddings for failed/low-confidence runs. Has a 3-second delay for the same reason. Skips successful high-confidence runs to minimise OpenAI API costs.

Isolating concerns into separate consumer groups means each can scale independently, fail independently, and be redeployed without affecting the others.

---

### 3. Evaluation Engine

**Rule-based evaluators (always run, zero cost):**

| Evaluator | Signal | Threshold |
|---|---|---|
| `groundedness` | Retrieval evidence × confidence | 0.70 |
| `relevance` | Output completeness | 0.60 |
| `safety` | Guardrail violation count | 0.80 |
| `tool_call_correctness` | Tool error rate | 0.70 |
| `latency` | Run duration vs. SLA | 0.60 |
| `format_compliance` | Output structure + actionability | 0.80 |
| `retry_loop` | Retry count | 0.50 |
| `evidence` | Retrieval hit count | 0.60 |

**Why rule-based first?** LLM judges are expensive and slow. The 8 rule-based evaluators run in microseconds and catch the majority of systematic failures: too many retries, too few evidence hits, tool call errors, guardrail violations. The LLM judge is called only when the operator explicitly enables it (and has an OpenAI key), and only evaluates *output quality* — the subjective dimension that rules can't quantify.

**LLM judge (opt-in):**  
`gpt-4o-mini` receives the agent's input, final output, and key trace metadata. It scores across accuracy, completeness, relevance, and safety on a 0.0–1.0 scale. Stored as a 9th `evaluations` row with `evaluator_name='llm_judge'`. The model choice (`gpt-4o-mini` over `gpt-4o`) is a deliberate cost-quality tradeoff — for evaluation of agent outputs, the mini model is sufficient and 10–15× cheaper.

---

### 4. Semantic Similarity Search (pgvector)

**The problem it solves:** When an agent fails, the first question is "have we seen this before?" Without semantic search, engineers grep logs manually. With pgvector, the UI shows the 5 most similar past failures ranked by cosine similarity, letting engineers immediately see if this is a known failure pattern.

**Embedding strategy:**  
The embedding text is constructed from: run input, final output, status, confidence score, and a pipe-delimited trace summary (`retrieval:search_logs:success hits=8 | tool_call:check_metrics:error error=timeout | ...`). This gives the embedding model both semantic context (what the agent was doing) and structural signals (which steps failed).

**IVFFlat index (`lists=100`):**  
Approximate nearest-neighbour search. `lists=100` means Postgres clusters the 1536-dimensional vectors into 100 Voronoi cells during index construction. Queries probe a subset of cells (controlled by `ivfflat.probes`), trading recall for speed. For a table with tens of thousands of embeddings this gives ~5ms query time vs. ~100ms+ for a sequential scan.

**Why only failed/low-confidence runs?** Embedding every run would rapidly inflate costs (each OpenAI call costs ~$0.00002 per 1K tokens, but at scale it adds up). Similar failures are the only actionable result from similarity search — there's no value in finding "runs similar to this successful run."

---

### 5. FastAPI + Celery

**Why FastAPI over Django/Flask?** FastAPI's async-first design, automatic OpenAPI documentation, and Pydantic validation make it well-suited for an internal API that will be consumed by both the dashboard and SDK. SQLAlchemy 2.0's new session style (no more `Session.query()`) pairs cleanly with FastAPI's dependency injection for DB session management.

**Celery for async tasks:**  
Evaluation and replay can take several seconds (LLM calls, DB queries, re-simulation). Blocking the HTTP response on these would make the API feel slow. Celery workers pick up tasks from the Redis broker and process them asynchronously. The `evaluate_run` and `replay_run` endpoints return immediately with a task ID, and the dashboard polls for completion.

**Replay simulation:**  
Rather than re-running the actual agent (which would require the agent runtime to be available), replay re-applies evaluators to the original trace with modified parameters (`prompt_override`, `guardrail_strictness`). This is a simulation of "what would the evaluation score have been" — useful for regression testing configuration changes without executing the agent.

---

### 6. pgvector + PostgreSQL Schema Design

**`failure_labels JSONB`:**  
Instead of a separate `failure_labels` table, labels are stored as a JSONB array on the `runs` row. This allows fast JSON containment queries (`@>`) without a join, and lets the schema evolve (add new label types) without migrations.

**`metadata JSONB` on `trace_events`:**  
Events carry arbitrary key-value metadata (model name, temperature, tool arguments, guardrail results). JSONB avoids a wide table with mostly-null columns and allows partial indexing on specific keys later.

**`trace_embeddings` with `ON CONFLICT (run_id) DO UPDATE`:**  
The upsert pattern means re-embedding a run (e.g., after the agent run is updated) is idempotent. No risk of duplicate embeddings.

---

### 7. Next.js Dashboard

**Server components + client fetches:**  
Page-level data (run list, analytics) is fetched server-side via `INTERNAL_API_URL` (container-to-container, no public network hop). Dynamic panels (trace timeline, replay results) are fetched client-side via `NEXT_PUBLIC_API_URL` so they can update without full page reloads.

**Playground (live streaming trace):**  
The `/playground` page demonstrates the ingestion pipeline end-to-end: it creates a run, fires 5–6 events 400–500ms apart using `setInterval`, and ends the run. Events appear in the UI in real time, showing the pipeline latency from browser → Go → Kafka → store_consumer → PostgreSQL → FastAPI → dashboard.

---

### 8. Python SDK

The SDK is a thin wrapper that makes the common patterns ergonomic:

```python
with client.run(..., input="Investigate latency") as run:
    run.event("retrieval", name="search_logs", output={"hits": 8}, latency_ms=320)
    run.end(final_output="DB pool exhaustion", confidence_score=0.87)
```

The `with` block handles `StartRun` on enter and `EndRun` on exit (with `status="error"` if an exception propagates). `run.event()` fires `AddEvent`. No threads or async machinery — the SDK is synchronous and blocking, keeping it simple and debuggable.

---

### 9. Kubernetes (Helm + KEDA)

**KEDA ScaledObject on ingestion:**  
The ingestion service is stateless and CPU-bound. KEDA monitors the `radar-store` consumer group lag. When lag exceeds 100 messages per replica, it scales up; when lag drains, it scales down. This is preferable to CPU-based HPA because ingestion load is directly proportional to Kafka lag, not CPU.

**Why KRaft (no Zookeeper)?**  
Zookeeper adds a separate 3-node quorum that must be healthy for Kafka to function. KRaft folds the Raft-based metadata consensus into Kafka itself. For a single-node dev/test deployment, this reduces the service count by 3 and eliminates the Zookeeper → Kafka dependency chain from health checks.

---

## Key Design Decisions & Trade-offs

| Decision | Rationale | Trade-off |
|---|---|---|
| Go for ingestion, Python for everything else | Go's throughput for the hot path; Python's ecosystem for ML/evaluation | Two language build contexts; harder to share code |
| In-process gRPC bridge | Avoids protoc toolchain, zero serialisation overhead | API key injection via metadata is non-obvious |
| Kafka fan-out with 3 consumer groups | Independent scaling and failure isolation | 2–3s sleep-based ordering guard is fragile under very high load |
| pgvector over Pinecone/Weaviate | Zero new infra; Postgres already present | IVFFlat approximate search; needs `VACUUM ANALYZE` after large batch inserts |
| Rule-based + LLM judge | Deterministic rules catch systematic failures cheaply; LLM catches quality issues | LLM judge adds latency and cost; not run by default |
| Replay = re-evaluation, not re-execution | No agent runtime dependency | Replay scores are estimates, not true re-runs |
| JSONB for metadata/labels | Schema flexibility; no join for label queries | JSONB operators less intuitive than relational joins |

---

## Pipeline Flow — End to End

```
1. Client calls POST /v1/ingest/runs/start
   → Go validates API key, assigns run_id (UUID v4), produces to trace.run.start

2. Client calls POST /v1/ingest/runs/{run_id}/events (N times)
   → Go validates fields, produces to trace.event.add (key=run_id, same partition)

3. Client calls POST /v1/ingest/runs/{run_id}/end
   → Go produces to trace.run.end

4. store_consumer (radar-store group):
   → run.start → INSERT INTO runs
   → event.add  → INSERT INTO trace_events
   → run.end    → UPDATE runs SET status, confidence_score, final_output

5. eval_consumer (radar-eval group, 2s delay):
   → run.end → run_all_evaluators() → INSERT INTO evaluations (8 rows)
   → if LLM_JUDGE_ENABLED: run_llm_judge() → INSERT INTO evaluations (1 row)

6. embed_consumer (radar-embed group, 3s delay):
   → run.end → if failed or low-confidence:
      build embedding text from runs + trace_events
      POST to OpenAI embeddings API
      UPSERT into trace_embeddings (vector(1536))

7. Dashboard / API client:
   GET /api/runs/{id}/trace        → full event tree from trace_events
   GET /api/runs/{id}/evaluate     → 8-9 evaluation rows with PASS/FAIL
   GET /api/runs/{id}/similar      → top-5 cosine neighbours from trace_embeddings
   POST /api/runs/{id}/replay      → re-evaluate with modified params via Celery
```

---

## Testing & Verification

### Integration Test — End-to-End Pipeline
```bash
cd apps/demo-agent
pip install -r requirements.txt
python main.py --seed    # 3 successful + 1 failed run
python main.py --fail    # single failing run (weak evidence, retries)
```

After seeding, verify in PostgreSQL:
```sql
SELECT id, status, confidence_score, total_tokens FROM runs ORDER BY started_at DESC LIMIT 5;
SELECT evaluator_name, score, passed FROM evaluations WHERE run_id = '<id>';
SELECT similarity(1, embedding <=> target.embedding) FROM trace_embeddings;
```

### LLM Judge + Embeddings (requires OpenAI key)
1. Set `OPENAI_API_KEY=sk-...` and `LLM_JUDGE_ENABLED=true` in `.env`
2. Rebuild affected services: `docker compose up -d --build api consumer-eval consumer-embed`
3. Run `python main.py --fail` — the failing run triggers both the LLM judge and embedding
4. Verify: `SELECT evaluator_name, score FROM evaluations WHERE evaluator_name='llm_judge';`
5. Verify: `SELECT run_id, model FROM trace_embeddings;`
6. Call `GET /api/runs/{id}/similar` — should return similar past failures with cosine scores

---

## Service Port Map

| Service | Host Port | Container Port | Protocol |
|---|---|---|---|
| Next.js Dashboard | 3000 | 3000 | HTTP |
| FastAPI | 8000 | 8000 | HTTP |
| Go HTTP Gateway | 8080 | 8080 | HTTP |
| Go gRPC | 9091 | 9090 | gRPC |
| Kafka Broker | 9095 | 9092 | Kafka |
| Kafka External | 9096 | 9094 | Kafka |
| PostgreSQL | 5433 | 5432 | TCP |
| Redis | 6380 | 6379 | TCP |

---

## Scalability Characteristics

| Bottleneck | Current capacity | Scale-out path |
|---|---|---|
| Ingestion throughput | ~10K events/s per replica | KEDA: 2→20 pods on Kafka lag |
| Kafka partitions | 3 per topic | Increase `KAFKA_NUM_PARTITIONS` + add brokers |
| PostgreSQL writes | ~2K rows/s single-node | Read replicas + connection pooling (pgBouncer) |
| pgvector search | ~5ms (IVFFlat, 100K rows) | Tune `ivfflat.probes`; HNSW index for higher recall |
| LLM judge throughput | ~2 runs/s (gpt-4o-mini rate limit) | Batch requests; async Celery concurrency |
| Embedding throughput | ~100 embeddings/min | Batch OpenAI calls; embed_consumer concurrency |

---

## Security Notes

- **API key authentication**: Every ingestion and API request requires `X-API-Key` header. The key is validated in the Go gRPC server and FastAPI middleware.
- **Dev defaults**: `API_KEY=dev-api-key-change-in-production` and `SECRET_KEY=change-this-secret-key-in-production` must be rotated before any non-local deployment.
- **OpenAI key handling**: `OPENAI_API_KEY` is passed through Docker environment variables and never hardcoded in source. The `.env` file (gitignored) holds the real key.
- **CORS**: `allow_origins=["*"]` is acceptable for a dev/internal tool; should be locked to specific origins for production.

---

## Summary

AgentOps Radar is a full-stack, production-architected AI observability platform demonstrating:

- **High-throughput event ingestion** via Go + Kafka with idempotent producers
- **Decoupled event processing** via 3 independent Kafka consumer groups
- **Automated multi-dimensional evaluation** combining deterministic rule-based checks with an LLM judge
- **Semantic failure search** via OpenAI embeddings + pgvector IVFFlat cosine index
- **Replay-based regression testing** to quantify the impact of agent improvements
- **Production-ready deployment** via Docker Compose (dev) and Kubernetes Helm chart with KEDA autoscaling

The platform is designed to be the observability layer that any agent framework — LangGraph, AutoGen, custom Python, or otherwise — can plug into with a single Python `with` block or a `curl` call.
