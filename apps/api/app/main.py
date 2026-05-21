import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import create_tables
from app.routes import projects, agents, runs, analytics, alerts, similarity

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AgentOps Radar API",
    description="Observability, evaluation, and debugging platform for AI agents",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(agents.router)
app.include_router(runs.router)
app.include_router(analytics.router)
app.include_router(alerts.router)
app.include_router(similarity.router)   # pgvector similarity search


@app.on_event("startup")
def on_startup():
    logger.info("Creating database tables...")
    create_tables()

    # Enable pgvector extension + add vector column + IVFFlat index.
    # Called after create_all() so the trace_embeddings table exists first.
    try:
        from app.models.trace_embedding import ensure_pgvector
        ensure_pgvector()
        logger.info("pgvector extension and index ready")
    except Exception as exc:
        # Non-fatal: similarity search won't work but everything else will.
        logger.warning("pgvector setup failed (similarity search disabled): %s", exc)

    logger.info("AgentOps Radar API v2 started")


@app.get("/health")
def health():
    return {"status": "ok", "service": "agentops-radar-api", "version": "2.0.0"}
