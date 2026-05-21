# AgentOps Radar

**Production-grade AI agent observability, evaluation, and debugging platform.**

AgentOps Radar gives engineering teams full visibility into every model call, tool call, retrieval step, guardrail check, retry, and failure across AI agent workflows — with structured replay, automated scoring, and semantic failure search.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                      │
│                                                                             │
│   Python SDK          REST clients          Demo Agent (incident bot)       │
│   (context manager,   (curl / Postman /     apps/demo-agent/                │
│    decorators)         dashboard frontend)                                  │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │  HTTP POST  /v1/ingest/*   or   gRPC :9090
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    GO INGESTION SERVICE   :8080 / :9090                     │
│                                                                             │
│  ┌────────────────────────┐    ┌──────────────────────────────────────────┐ │
│  │  HTTP Gateway          │    │  gRPC Server (server.go)                 │ │
│  │  (gateway.go)          │───▶│  • authenticates X-API-Key               │ │
│  │                        │    │  • validates required fields             │ │
│  │  • /v1/ingest/runs/    │    │  • assigns UUID (run_id / event_id)      │ │
│  │    start|events|end    │    │  • calls Kafka producer                  │ │
│  │  • /api/runs/* (compat)│    └────────────────┬─────────────────────────┘ │
│  │  • /health  /metrics   │                     │                           │
│  └────────────────────────┘                     │                           │
│                                                  │  ProduceSync             │
│  ┌───────────────────────────────────────────────▼─────────────────────────┐│
│  │  Kafka Producer  (producer.go)  franz-go · AllISRAcks · 5ms linger      ││
│  └───────────────────────────────────────────────────────────────────────── ┘│
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│               KAFKA   (KRaft — no Zookeeper)   confluentinc/cp-kafka:7.6   │
│                                                                             │
│   trace.run.start  ─── 3 partitions, key=run_id ──────────────────────     │
│   trace.event.add  ─── 3 partitions, key=run_id  (co-partitioned)  ─────   │
│   trace.run.end    ─── 3 partitions, key=run_id ──────────────────────     │
│                                                                             │
│   Co-partitioning by run_id guarantees all messages for a run land on      │
│   the same partition → ordered delivery within each consumer group.        │
└──────────┬─────────────────────────┬──────────────────────────┬────────────┘
           │                         │                          │
           ▼                         ▼                          ▼
┌──────────────────┐   ┌──────────────────────────┐  ┌─────────────────────┐
│  store_consumer  │   │     eval_consumer         │  │   embed_consumer    │
│  group:radar-    │   │     group:radar-eval       │  │   group:radar-embed │
│  store           │   │                           │  │                     │
│                  │   │  on trace.run.end:         │  │  on trace.run.end:  │
│  run.start →     │   │  1. sleep 2s (let store   │  │  skip if high-conf  │
│   INSERT runs    │   │     finish writing)        │  │  success runs       │
│                  │   │  2. run_all_evaluators()  │  │                     │
│  event.add →     │   │     (8 rule-based)         │  │  sleep 3s           │
│   INSERT         │   │  3. run_llm_judge()        │  │  _build_embedding_  │
│   trace_events   │   │     (if key + enabled)     │  │  text() from DB     │
│                  │   │  4. INSERT evaluations     │  │                     │
│  run.end →       │   │                           │  │  OpenAI             │
│   UPDATE runs    │   │                           │  │  text-embedding-    │
│   (status,       │   │                           │  │  3-small (1536d)    │
│    confidence,   │   │                           │  │                     │
│    final_output) │   │                           │  │  pgvector upsert    │
└────────┬─────────┘   └────────────┬──────────────┘  └──────────┬──────────┘
         │                          │                             │
         └──────────────────────────┴─────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  POSTGRESQL  +  pgvector                                    │
│                                                                             │
│  runs              id, project_id, agent_id, input, final_output,          │
│                    status, confidence_score, total_tokens, cost,            │
│                    total_latency_ms, failure_labels (JSONB), started_at     │
│                                                                             │
│  trace_events      id, run_id, event_type, name, input, output,            │
│                    metadata (JSONB), latency_ms, status, error_message      │
│                                                                             │
│  evaluations       id, run_id, evaluator_name, score, passed, reason       │
│                                                                             │
│  trace_embeddings  id, run_id, model, embedding vector(1536),              │
│                    embedding_text  ← IVFFlat cosine index (lists=100)       │
│                                                                             │
│  replay_runs       id, original_run_id, prompt_override,                   │
│                    guardrail_strictness, score_delta (JSONB)                │
│                                                                             │
│  alerts / alert_rules / projects / agents                                  │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │  SQLAlchemy 2.0 queries
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   FASTAPI  :8000   +   CELERY WORKER                       │
│                                                                             │
│  Query / replay API:                  Celery tasks (async via Redis):       │
│  POST  /api/runs/start                • evaluate.apply_async()             │
│  POST  /api/runs/{id}/events          • detect_failures.apply_async()      │
│  POST  /api/runs/{id}/end             • replay simulation                  │
│  GET   /api/runs/{id}/trace                                                 │
│  POST  /api/runs/{id}/evaluate        LLM judge (gpt-4o-mini):             │
│  POST  /api/runs/{id}/replay          • called by Celery worker AND        │
│  GET   /api/runs/{id}/replay/         eval_consumer when key is set        │
│        comparison                                                           │
│  GET   /api/runs/{id}/similar   ─── pgvector cosine search                 │
│  POST  /api/runs/{id}/embed     ─── trigger embedding on demand            │
│  GET   /api/analytics/overview                                             │
│  GET   /api/analytics/failures                                             │
│  POST  /api/alerts/rules                                                   │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │  REST (server-side + client-side fetches)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  NEXT.JS DASHBOARD   :3000                                  │
│                                                                             │
│  /dashboard     Failure rate chart, latency p50/p95, eval pass-rate        │
│  /runs          Run list with status badges, confidence, latency            │
│  /runs/[id]     Full trace timeline (event tree)                           │
│                 Evaluation scorecard (8 evaluators, PASS/FAIL badges)      │
│                 Replay panel (before/after score bars + Δ% badges)         │
│                 Similar Failures (cosine similarity bars, status)          │
│  /playground    Live streaming trace demo (events appear ≤500ms apart)    │
│  /alerts        Alert rules + triggered alert list                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│               KUBERNETES   (kind / minikube)                                │
│                                                                             │
│  Helm chart: infra/helm/agentops-radar/                                    │
│                                                                             │
│  Ingress (nginx)   radar.local                                             │
│    /              → dashboard :3000                                        │
│    /api           → api :8000                                              │
│    /v1/ingest     → ingestion :8080                                        │
│                                                                             │
│  KEDA ScaledObject → ingestion Deployment                                  │
│    trigger : Kafka consumer group lag (group=radar-store)                  │
│    lagThreshold : 100 messages per replica                                 │
│    minReplicas : 2   maxReplicas : 20                                      │
│                                                                             │
│  Fallback HPA → CPU 70% utilisation                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Stack

| Layer | Technology |
|---|---|
| Trace ingestion | **Go** — gRPC + HTTP/JSON gateway, franz-go, uber/zap |
| Event streaming | **Kafka** — KRaft mode (no Zookeeper), 3 consumer groups |
| Vector search | **pgvector** — OpenAI `text-embedding-3-small`, IVFFlat cosine index |
| Query / replay API | **FastAPI** + SQLAlchemy 2.0, PostgreSQL JSONB |
| Async evaluation | **Celery** + Redis, rule-based + LLM-as-judge |
| Frontend | **Next.js 14** + TypeScript + Tailwind + Recharts |
| Python SDK | `packages/python-sdk/` — context manager, decorators |
| Kubernetes | **Helm** chart + **KEDA** Kafka-lag HPA, kind deploy script |
| Containerisation | Docker Compose (10 services) |

---

## Quick Start

```bash
# 1. Copy env and set your OpenAI key (needed for LLM judge + embeddings)
cp .env.example .env
# Edit .env and fill in:
#   OPENAI_API_KEY=sk-...
#   LLM_JUDGE_ENABLED=true

# 2. Start all 10 services
docker compose up --build

# 3. Open the dashboard
open http://localhost:3000

# 4. Run the demo agent (seeds realistic incident-investigation traces)
cd apps/demo-agent
pip install -r requirements.txt
python main.py --seed        # 3 successful + 1 failed run
python main.py --fail        # single failing run (weak evidence)
python main.py --replay <id> # replay with stricter guardrails
```

**Service ports (host):**

| Service | Host port |
|---|---|
| Next.js dashboard | 3000 |
| FastAPI | 8000 |
| Go HTTP gateway | 8080 |
| Go gRPC | 9091 |
| Kafka broker | 9095 |
| PostgreSQL | 5433 |
| Redis | 6380 |

---

## Go Ingestion Service

```
apps/ingestion/
├── cmd/server/main.go          entry point — gRPC :9090 + HTTP gateway :8080
├── internal/
│   ├── server/server.go        IngestionServiceServer implementation
│   ├── gateway/gateway.go      HTTP/JSON → in-process gRPC bridge
│   └── kafka/producer.go       franz-go AllISRAcks idempotent producer
├── gen/ingestion/v1/           gRPC stubs (hand-written, no protoc dep)
└── proto/ingestion/v1/         .proto contract
```

```bash
# HTTP
POST /v1/ingest/runs/start
{"project_id": "...", "input": "Investigate checkout latency"}

POST /v1/ingest/runs/{run_id}/events
{"event_type": "retrieval", "name": "search_logs", "output": {"hits": 8}, "latency_ms": 320}

POST /v1/ingest/runs/{run_id}/end
{"status": "success", "confidence_score": 0.87, "final_output": "DB pool exhaustion"}

# Legacy SDK paths also supported
POST /api/runs/start  →  same as /v1/ingest/runs/start
```

---

## Kafka Fan-out

Three independent consumer groups — each concern is isolated and scales separately:

| Consumer | Topics consumed | Responsibility |
|---|---|---|
| `store_consumer` | run.start, event.add, run.end | Write runs + events to PostgreSQL |
| `eval_consumer` | run.end | Rule-based evaluation + LLM judge |
| `embed_consumer` | run.end | OpenAI embeddings → pgvector |

---

## Evaluation Engine

**Rule-based evaluators** (always run):

| Evaluator | What it measures | Pass threshold |
|---|---|---|
| `groundedness` | Retrieval evidence quality × confidence | ≥ 0.70 |
| `relevance` | Output completeness vs. inconclusive markers | ≥ 0.60 |
| `safety` | Guardrail violation count | ≥ 0.80 |
| `tool_call_correctness` | Tool error rate | ≥ 0.70 |
| `latency` | Run latency vs. thresholds | ≥ 0.60 |
| `format_compliance` | Output structure and actionability | ≥ 0.80 |
| `retry_loop` | Retry count | ≥ 0.50 |
| `evidence` | Retrieval hit count | ≥ 0.60 |

**LLM judge** — set `OPENAI_API_KEY` and `LLM_JUDGE_ENABLED=true`:
- Scores output quality (accuracy, completeness, relevance, safety) 0–1 using `gpt-4o-mini`
- Runs after rule-based evaluators in `eval_consumer`
- Stored as a 9th evaluation row with `evaluator_name='llm_judge'`

---

## Semantic Similarity Search

Failed runs are embedded with `text-embedding-3-small` (1536 dimensions) and stored with an IVFFlat cosine index.

```bash
# Embed a run
POST /api/runs/{run_id}/embed

# Find similar past failures
GET /api/runs/{run_id}/similar?limit=5
```

The **Similar Failures** panel on each run detail page shows similarity bars (red ≥ 85%, orange ≥ 70%) and run metadata.

---

## Replay & Regression

```python
client.replay_run(
    run_id,
    prompt_override="Require at least 3 evidence items before concluding",
    guardrail_strictness="high",
)
```

The dashboard **Replay** panel shows before/after score bars with coloured PASS/FAIL badges and Δ% delta numbers.

---

## Python SDK

```python
from agentops_radar import RadarClient

client = RadarClient(base_url="http://localhost:8000", api_key="dev-api-key-change-in-production")

proj  = client.create_project(name="My Agent")
agent = client.register_agent(project_id=proj["id"], name="Incident Bot", framework="LangGraph")

with client.run(project_id=proj["id"], agent_id=agent["id"], input="Investigate latency spike") as run:
    run.event("retrieval", name="search_logs", output={"hits": 8}, latency_ms=320)
    run.event("tool_call",  name="check_metrics", output={"p99_ms": 2450}, latency_ms=150)
    run.end(final_output="DB pool exhaustion confirmed", confidence_score=0.87)

client.evaluate_run(run.run_id)
client.replay_run(run.run_id, prompt_override="Stricter evidence validation")
```

---

## Kubernetes

```bash
# Prerequisites: kind, kubectl, helm, docker
chmod +x infra/deploy-local.sh
./infra/deploy-local.sh
```

Provisions a kind cluster, installs ingress-nginx and KEDA, builds Docker images, and deploys via Helm. The ingestion service scales 2 → 20 pods on Kafka consumer group lag.

---

## Project Structure

```
agentops-radar/
├── apps/
│   ├── api/            FastAPI query / replay / similarity API
│   ├── worker/         Celery evaluator + Kafka consumers
│   │   └── consumers/  store_consumer · eval_consumer · embed_consumer
│   ├── dashboard/      Next.js 14 dashboard
│   ├── ingestion/      Go ingestion service (gRPC + HTTP)
│   └── demo-agent/     Incident investigation demo agent
├── packages/
│   └── python-sdk/     agentops-radar Python SDK
├── infra/
│   ├── helm/           Helm chart (production + local values)
│   ├── k8s/            kind cluster config
│   └── deploy-local.sh kind/minikube deploy script
└── docker-compose.yml  10-service local stack
```
