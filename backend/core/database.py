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
    model = Column(String, nullable=False)               # Ollama model used with this KB
    embed_model = Column(String, nullable=False)
    chroma_collection = Column(String, nullable=False)   # ChromaDB collection name
    source_type = Column(String, nullable=False)         # url | file | folder | db
    source_meta = Column(JSON, nullable=True)
    doc_count = Column(Integer, default=0)
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


async def init_db():
    async with engine.begin() as conn:
        # checkfirst=True: skip CREATE TABLE if the table already exists
        # This prevents duplicate key errors on container restart
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
