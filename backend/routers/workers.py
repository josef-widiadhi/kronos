"""
Default Worker Seeds
====================
Six specialist RAG workers that are pre-created on first startup:

1. doc_ingestor      — watches /watch_folder for new files, auto-ingests
2. url_crawler       — actively crawls URLs you provide into a KB
3. gdrive_reader     — reads from Google Drive shared links
4. rag_validator     — validates RAG answer quality, scores confidence
5. summarizer        — summarizes and catalogs ingested documents
6. worker_monitor    — monitors all other workers, reports health/activity

All workers are staged on creation. Deploy individually from the Agents page.
"""
import os
import asyncio
import logging
from typing import Optional, List
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.config import settings
from core.database import get_db, Agent, KBCollection
from routers.auth import get_current_owner

router = APIRouter()
logger = logging.getLogger("kronos.workers")


# ── Default worker definitions ────────────────────────────────────────────────

DEFAULT_WORKERS = [
    {
        "name": "doc_ingestor",
        "agent_type": "folder_watcher",
        "description": "Watches /watch_folder for new documents (PDF, DOCX, TXT, MD) and auto-ingests them into a KB collection. Mount your local folder via KRONOS_WATCH_FOLDER in .env.",
        "system_prompt": (
            "You are a document specialist with deep knowledge of the ingested document library. "
            "Answer questions accurately using only the document content in your knowledge base. "
            "Always cite the source document and page/section when answering. "
            "If a document is not in your knowledge base, say so clearly."
        ),
        "config": {
            "watch_path": "/watch_folder",
            "auto_ingest": True,
            "supported_extensions": [".pdf", ".docx", ".txt", ".md", ".csv"],
            "poll_interval_seconds": 30,
        },
    },
    {
        "name": "url_crawler",
        "agent_type": "url_crawler",
        "description": "Actively crawls web URLs you provide and builds a searchable knowledge base from the content. Supports single pages, sitemaps, and recursive crawling.",
        "system_prompt": (
            "You are a web knowledge specialist. You have crawled and indexed web content. "
            "Answer questions using the indexed web content, always citing the source URL. "
            "If the answer requires recent data beyond your crawl, say so and suggest re-crawling."
        ),
        "config": {
            "max_depth": 2,
            "max_pages_per_domain": 50,
            "respect_robots_txt": True,
            "include_patterns": [],
            "exclude_patterns": [".pdf", ".zip", ".exe"],
        },
    },
    {
        "name": "gdrive_reader",
        "agent_type": "folder_watcher",
        "description": "Reads documents from Google Drive via shared public links or Google Drive API. Ingests Docs, Sheets summaries, and PDFs.",
        "system_prompt": (
            "You are a Google Drive document specialist. You have access to documents shared via Google Drive. "
            "Answer questions from the Drive content, citing the document title and owner. "
            "Note when documents may have been updated since your last sync."
        ),
        "config": {
            "source": "google_drive",
            "sync_interval_minutes": 60,
            "supported_types": ["document", "spreadsheet", "pdf"],
        },
    },
    {
        "name": "rag_validator",
        "agent_type": "rag_validator",
        "description": "Validates the quality and accuracy of RAG-generated answers. Scores confidence (0-1), identifies hallucinations, checks source grounding, and flags low-quality responses.",
        "system_prompt": (
            "You are a RAG quality assurance specialist. Your job is to critically evaluate AI-generated answers. "
            "For each answer, assess:\n"
            "1. GROUNDING (0-1): Is the answer supported by the provided sources?\n"
            "2. ACCURACY (0-1): Is the factual content correct based on sources?\n"
            "3. COMPLETENESS (0-1): Does it fully answer the question?\n"
            "4. HALLUCINATION RISK: Flag any claims not in the sources.\n"
            "Return structured JSON: {grounding, accuracy, completeness, hallucination_flags, recommendation, overall_score}"
        ),
        "config": {
            "score_threshold": 0.7,
            "auto_flag_below_threshold": True,
            "validation_model": "fast",
        },
    },
    {
        "name": "summarizer",
        "agent_type": "custom",
        "description": "Automatically summarizes and catalogs ingested documents. Creates structured summaries, extracts key topics, entities, dates, and builds a searchable document catalog.",
        "system_prompt": (
            "You are a document summarization and cataloging specialist. "
            "When given a document, produce:\n"
            "1. EXECUTIVE SUMMARY: 2-3 sentence overview\n"
            "2. KEY TOPICS: comma-separated list of main topics\n"
            "3. KEY ENTITIES: people, organizations, products mentioned\n"
            "4. KEY DATES: important dates/timelines mentioned\n"
            "5. DOCUMENT TYPE: report/policy/manual/article/etc\n"
            "6. RECOMMENDED TAGS: for cataloging\n"
            "Format as structured JSON for easy indexing."
        ),
        "config": {
            "auto_summarize_on_ingest": True,
            "extract_entities": True,
            "generate_tags": True,
            "summary_max_tokens": 500,
        },
    },
    {
        "name": "worker_monitor",
        "agent_type": "rag_validator",
        "description": "Monitors all deployed KRONOS workers. Tracks health, query counts, response times, error rates, and knowledge base freshness. Alerts on degraded workers.",
        "system_prompt": (
            "You are the KRONOS system monitor. You have visibility into all deployed AI workers. "
            "When asked about worker status, report:\n"
            "- Which workers are running/stopped/errored\n"
            "- Query counts and recent activity\n"
            "- Knowledge base freshness (last ingest time)\n"
            "- Any performance anomalies or errors\n"
            "- Recommendations for workers that need attention\n"
            "Be concise and actionable. Flag critical issues clearly."
        ),
        "config": {
            "monitor_interval_seconds": 30,
            "alert_on_worker_down": True,
            "alert_on_kb_stale_hours": 24,
            "track_metrics": ["query_count", "error_rate", "response_time_avg"],
        },
    },
]


async def seed_default_workers(db: AsyncSession, model: str) -> List[Agent]:
    """Create default workers if they don't already exist."""
    created = []
    for w in DEFAULT_WORKERS:
        # Check if already exists
        result = await db.execute(select(Agent).where(Agent.name == w["name"]))
        if result.scalar_one_or_none():
            continue

        agent = Agent(
            name=w["name"],
            description=w["description"],
            agent_type=w["agent_type"],
            model=model,
            system_prompt=w["system_prompt"],
            config=w["config"],
            status="staged",
        )
        db.add(agent)
        created.append(agent)
        logger.info(f"Seeded default worker: {w['name']}")

    if created:
        await db.commit()
        logger.info(f"Created {len(created)} default workers")

    return created


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/seed")
async def seed_workers(
    model: str = "llama3.1:8b",
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Seed the 6 default specialist workers.
    Pass ?model=qwen2.5:7b-instruct to use a specific model.
    """
    created = await seed_default_workers(db, model)
    if not created:
        return {"message": "All default workers already exist", "created": 0}
    return {
        "message": f"Created {len(created)} default workers",
        "created": len(created),
        "workers": [w.name for w in created],
    }


@router.get("/defaults")
async def list_defaults(_: str = Depends(get_current_owner)):
    """List the default worker templates."""
    return {
        "count": len(DEFAULT_WORKERS),
        "workers": [
            {
                "name": w["name"],
                "type": w["agent_type"],
                "description": w["description"],
            }
            for w in DEFAULT_WORKERS
        ],
    }


@router.post("/folder-scan")
async def trigger_folder_scan(
    kb_collection_id: str,
    folder_path: str = "/watch_folder",
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Manually trigger a scan of the watch folder and ingest any new files.
    """
    from routers.rag import chunk_text, embed_texts
    import chromadb, uuid
    from sqlalchemy import update

    result = await db.execute(select(KBCollection).where(KBCollection.id == kb_collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="KB Collection not found")

    folder = Path(folder_path)
    if not folder.exists():
        return {"error": f"Folder {folder_path} not found. Is KRONOS_WATCH_FOLDER set?", "ingested": 0}

    supported = {".txt", ".md", ".csv"}
    files = [f for f in folder.rglob("*") if f.suffix.lower() in supported and f.is_file()]

    total_chunks = 0
    processed = []
    errors = []

    chroma = chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT)
    collection = chroma.get_collection(kb.chroma_collection)

    for file_path in files[:20]:  # cap at 20 files per scan
        try:
            text = file_path.read_text(encoding="utf-8", errors="ignore")
            if not text.strip():
                continue
            chunks = chunk_text(text)
            embeddings = await embed_texts(chunks, model=kb.embed_model)
            ids = [str(uuid.uuid4()) for _ in chunks]
            collection.add(
                ids=ids,
                embeddings=embeddings,
                documents=chunks,
                metadatas=[{"source": str(file_path), "chunk_idx": i} for i, _ in enumerate(chunks)],
            )
            total_chunks += len(chunks)
            processed.append(str(file_path.name))
        except Exception as e:
            errors.append({"file": str(file_path.name), "error": str(e)})

    if total_chunks > 0:
        await db.execute(
            update(KBCollection)
            .where(KBCollection.id == kb_collection_id)
            .values(doc_count=KBCollection.doc_count + total_chunks)
        )
        await db.commit()

    return {
        "folder": folder_path,
        "files_found": len(files),
        "files_processed": len(processed),
        "chunks_ingested": total_chunks,
        "processed": processed,
        "errors": errors,
    }
