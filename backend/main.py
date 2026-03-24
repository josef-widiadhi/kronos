"""
KRONOS - Knowledge Runtime Orchestration & Node Operating System
FastAPI Backend
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from core.database import init_db
from routers import ollama, rag, docker, agents, monitor, chat, auth, mcp, workers

logger = logging.getLogger("kronos")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Startup diagnostics — visible in docker logs kronos_api
    logger.warning("=" * 60)
    logger.warning(f"KRONOS starting up")
    logger.warning(f"OWNER_USERNAME     : {settings.OWNER_USERNAME}")
    import os as _os
    raw_hash = _os.environ.get("OWNER_PASSWORD_HASH", "")
    logger.warning(f"OWNER_PASSWORD_HASH: {'SET (' + raw_hash[:8] + '...)' if raw_hash else 'NOT SET - login will fail!'}")
    logger.warning(f"SECRET_KEY         : {'SET' if settings.SECRET_KEY != 'change-me-in-production' else 'DEFAULT (insecure)'}")
    logger.warning("=" * 60)
    yield


app = FastAPI(
    title="KRONOS API",
    description="Knowledge Runtime Orchestration & Node Operating System",
    version="1.0.0",
    lifespan=lifespan,
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

# Routers — no /api prefix, nginx strips it before forwarding
app.include_router(auth.router,    prefix="/auth",    tags=["auth"])
app.include_router(ollama.router,  prefix="/ollama",  tags=["ollama"])
app.include_router(rag.router,     prefix="/rag",     tags=["rag"])
app.include_router(docker.router,  prefix="/docker",  tags=["docker"])
app.include_router(agents.router,  prefix="/agents",  tags=["agents"])
app.include_router(monitor.router, prefix="/monitor", tags=["monitor"])
app.include_router(chat.router,    prefix="/chat",    tags=["chat"])
app.include_router(mcp.router,     prefix="/mcp",     tags=["mcp"])
app.include_router(workers.router,  prefix="/workers",  tags=["workers"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "KRONOS"}
