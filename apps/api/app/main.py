import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import create_tables
from app.routes import projects, agents, runs, analytics, alerts

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AgentOps Radar API",
    description="Observability, evaluation, and debugging platform for AI agents",
    version="1.0.0",
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


@app.on_event("startup")
def on_startup():
    logger.info("Creating database tables...")
    create_tables()
    logger.info("AgentOps Radar API started")


@app.get("/health")
def health():
    return {"status": "ok", "service": "agentops-radar-api"}
