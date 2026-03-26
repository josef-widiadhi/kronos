from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, Text, DateTime, Boolean, Integer, JSON
from datetime import datetime
import uuid

from core.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# ── Models ────────────────────────────────────────────────────────────────────

class ApprovalRequest(Base):
    """Every destructive / deploy action goes through here first."""
    __tablename__ = "approval_requests"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    action_type = Column(String, nullable=False)        # e.g. "deploy_agent", "inject_docker"
    payload = Column(JSON, nullable=False)               # serialised action params
    requested_by = Column(String, nullable=False)        # always "system" for now
    status = Column(String, default="pending")           # pending | approved | rejected
    owner_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)


class KBCollection(Base):
    """A named RAG knowledge-base collection."""
    __tablename__ = "kb_collections"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, unique=True, nullable=False)
    description = Column(Text, nullable=True)
    model = Column(String, nullable=False)               # Ollama chat model
    embed_model = Column(String, nullable=False)         # Embedding model
    chroma_collection = Column(String, nullable=False)   # ChromaDB collection name
    source_type = Column(String, nullable=False)         # url | file | folder | mixed
    source_meta = Column(JSON, nullable=True)            # legacy
    # Sources: list of {type, config, last_run, status}
    # type: file_upload | folder | urls | gdrive
    sources = Column(JSON, nullable=True, default=list)
    # Watch folder path (per-collection, replaces global KRONOS_WATCH_FOLDER)
    watch_folder = Column(String, nullable=True)
    # Google Drive config
    gdrive_folder_id = Column(String, nullable=True)
    gdrive_credentials = Column(JSON, nullable=True)     # stored OAuth tokens
    # Linked agent
    agent_id = Column(String, nullable=True)             # auto-created agent
    doc_count = Column(Integer, default=0)
    last_ingested_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Agent(Base):
    """A deployed or staged AI worker."""
    __tablename__ = "agents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, unique=True, nullable=False)
    description = Column(Text, nullable=True)
    agent_type = Column(String, nullable=False)          # url_crawler | db_learner | folder_watcher | rag_validator | custom
    model = Column(String, nullable=False)               # Ollama model name
    kb_collection_id = Column(String, nullable=True)     # FK → KBCollection
    system_prompt = Column(Text, nullable=True)
    config = Column(JSON, nullable=True)                  # extra agent config
    # Resource limits enforced at container deploy time
    mem_limit_mb  = Column(Integer, nullable=True)       # e.g. 512, 1024, 2048 — None = no limit
    cpu_shares    = Column(Integer, nullable=True)       # 1024 = 1 CPU, 512 = 0.5 CPU — None = unlimited
    status = Column(String, default="staged")            # staged | deploying | running | stopped | error
    container_id = Column(String, nullable=True)
    container_name = Column(String, nullable=True)
    image_tag = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AgentLog(Base):
    """Live activity log for deployed agents."""
    __tablename__ = "agent_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String, nullable=False)
    level = Column(String, default="info")               # info | warn | error
    message = Column(Text, nullable=False)
    meta = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)




class Dataset(Base):
    """Training dataset generated from KB collections."""
    __tablename__ = "datasets"
    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name        = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    source_type = Column(String, nullable=False)
    source_id   = Column(String, nullable=True)
    format      = Column(String, default="alpaca")
    row_count   = Column(Integer, default=0)
    file_path   = Column(String, nullable=True)
    status      = Column(String, default="empty")
    model_used  = Column(String, nullable=True)
    config      = Column(JSON, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FineTuneJob(Base):
    """Fine-tuning training job."""
    __tablename__ = "finetune_jobs"
    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name            = Column(String, nullable=False)
    base_model      = Column(String, nullable=False)
    dataset_id      = Column(String, nullable=True)
    method          = Column(String, default="lora")
    status          = Column(String, default="queued")
    container_id    = Column(String, nullable=True)
    output_path     = Column(String, nullable=True)
    gguf_path       = Column(String, nullable=True)
    ollama_imported = Column(String, nullable=True)
    config          = Column(JSON, nullable=True)
    log_tail        = Column(Text, nullable=True)
    metrics         = Column(JSON, nullable=True)
    error_message   = Column(Text, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    started_at      = Column(DateTime, nullable=True)
    finished_at     = Column(DateTime, nullable=True)


class SystemSettings(Base):
    """Persistent key-value settings store. Survives restarts."""
    __tablename__ = "system_settings"
    key        = Column(String, primary_key=True)
    value      = Column(Text, nullable=True)
    value_type = Column(String, default="string")  # string | int | bool | json
    category   = Column(String, default="general")
    label      = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class URLWatcher(Base):
    """A scheduled URL watcher — periodically re-crawls URLs into a KB collection."""
    __tablename__ = "url_watchers"

    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name            = Column(String, nullable=False)
    kb_collection_id = Column(String, nullable=False)       # target KB
    urls            = Column(JSON, nullable=False)           # seed URLs to crawl
    mode            = Column(String, default="single")       # single|recursive|sitemap
    max_depth       = Column(Integer, default=1)             # recursive depth limit
    max_pages       = Column(Integer, default=20)            # max pages per crawl run
    include_pattern = Column(String, nullable=True)          # regex filter (include)
    exclude_pattern = Column(String, nullable=True)          # regex filter (exclude)
    schedule        = Column(String, default="manual")       # manual|hourly|daily|weekly
    status          = Column(String, default="idle")         # idle|running|error|paused
    last_run_at     = Column(DateTime, nullable=True)
    last_run_pages  = Column(Integer, default=0)
    last_run_chunks = Column(Integer, default=0)
    last_error      = Column(Text, nullable=True)
    content_hashes  = Column(JSON, nullable=True)           # url→hash for change detection
    total_pages_crawled = Column(Integer, default=0)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

async def init_db():
    async with engine.begin() as conn:
        # checkfirst=True: skip CREATE TABLE if the table already exists
        # This prevents duplicate key errors on container restart
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
