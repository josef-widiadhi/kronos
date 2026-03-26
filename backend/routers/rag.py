"""
RAG Builder router.
Collections are the center of gravity — each has Sources that feed it.

Sources per collection:
  file_upload  — one-time file ingest (PDF/DOCX/TXT/MD)
  folder       — local folder path (per-collection, not global env var)
  urls         — URL list with crawl mode (replaces URLWatcher standalone page)
  gdrive       — Google Drive folder/file (public share link or OAuth)

Each collection can also deploy its own agent directly.
"""
import os
import re
import uuid
import hashlib
import asyncio
import tempfile
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime
from urllib.parse import urlparse, urljoin

import httpx
import chromadb
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from core.config import settings
from core.database import get_db, KBCollection, Agent
from routers.auth import get_current_owner, create_approval_request

router = APIRouter()
logger = logging.getLogger("kronos.rag")


# ── ChromaDB client ────────────────────────────────────────────────────────────

def get_chroma():
    import time
    last_err = None
    for attempt in range(3):
        try:
            client = chromadb.HttpClient(
                host=settings.CHROMA_HOST,
                port=settings.CHROMA_PORT,
                tenant=chromadb.DEFAULT_TENANT,
                database=chromadb.DEFAULT_DATABASE,
            )
            client.heartbeat()
            return client
        except Exception as e:
            last_err = e
            if attempt < 2:
                time.sleep(2)
    raise Exception(f"ChromaDB not reachable: {last_err}")


# ── Embedding ──────────────────────────────────────────────────────────────────

async def embed_texts(texts: List[str], model: str = None) -> List[List[float]]:
    model = model or settings.EMBED_MODEL
    embeddings = []
    async with httpx.AsyncClient(timeout=60) as client:
        for text in texts:
            r = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/embeddings",
                json={"model": model, "prompt": text},
            )
            r.raise_for_status()
            embeddings.append(r.json()["embedding"])
    return embeddings


def chunk_text(text: str, chunk_size: int = None, overlap: int = None) -> List[str]:
    chunk_size = chunk_size or settings.EMBED_CHUNK_SIZE
    overlap = overlap or settings.EMBED_CHUNK_OVERLAP
    words = text.split()
    chunks, i = [], 0
    while i < len(words):
        chunks.append(" ".join(words[i:i + chunk_size]))
        i += chunk_size - overlap
    return [c for c in chunks if len(c.split()) >= 10]


async def ingest_chunks(
    collection,
    chunks: List[str],
    source: str,
    embed_model: str,
    extra_meta: Dict = None,
) -> int:
    if not chunks:
        return 0
    embeddings = await embed_texts(chunks, model=embed_model)
    ids = [str(uuid.uuid4()) for _ in chunks]
    metas = [{
        "source": source,
        "chunk_idx": i,
        "ingested_at": datetime.utcnow().isoformat(),
        **(extra_meta or {}),
    } for i in range(len(chunks))]
    collection.add(ids=ids, embeddings=embeddings, documents=chunks, metadatas=metas)
    return len(chunks)


# ── Schemas ────────────────────────────────────────────────────────────────────

class CollectionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    model: str
    embed_model: Optional[str] = None

class URLSourceConfig(BaseModel):
    urls: List[str]
    mode: str = "single"          # single | recursive | sitemap
    max_depth: int = 1
    max_pages: int = 20
    include_pattern: Optional[str] = None
    exclude_pattern: Optional[str] = None
    schedule: str = "manual"      # manual | hourly | daily | weekly

class FolderSourceConfig(BaseModel):
    folder_path: str              # absolute path on host (mapped into container)
    schedule: str = "manual"

class GDriveSourceConfig(BaseModel):
    share_url: str                # Google Drive public share URL
    schedule: str = "manual"

class QueryRequest(BaseModel):
    collection_id: str
    query: str
    top_k: int = 5

class URLIngestRequest(BaseModel):
    collection_id: str
    urls: List[str]

class DeployAgentRequest(BaseModel):
    collection_id: str
    model: Optional[str] = None   # override collection model
    agent_name: Optional[str] = None


# ── Collection CRUD ────────────────────────────────────────────────────────────

@router.get("/collections")
async def list_collections(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(KBCollection).order_by(KBCollection.created_at.desc()))
    cols = result.scalars().all()
    # Enrich with linked agent status
    output = []
    for c in cols:
        d = {
            "id": c.id, "name": c.name, "description": c.description,
            "model": c.model, "embed_model": c.embed_model,
            "chroma_collection": c.chroma_collection,
            "source_type": c.source_type, "doc_count": c.doc_count,
            "sources": c.sources or [],
            "watch_folder": c.watch_folder,
            "gdrive_folder_id": c.gdrive_folder_id,
            "agent_id": c.agent_id,
            "last_ingested_at": c.last_ingested_at.isoformat() if c.last_ingested_at else None,
            "created_at": c.created_at.isoformat(),
            "agent_status": None,
        }
        if c.agent_id:
            ar = await db.execute(select(Agent).where(Agent.id == c.agent_id))
            agent = ar.scalar_one_or_none()
            if agent:
                d["agent_status"] = agent.status
                d["agent_name"] = agent.name
        output.append(d)
    return output


@router.post("/collections")
async def create_collection(
    req: CollectionCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    chroma_name = f"kb_{req.name.lower().replace(' ', '_')}_{uuid.uuid4().hex[:8]}"
    try:
        chroma = get_chroma()
        chroma.get_or_create_collection(chroma_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ChromaDB error: {e}")

    kb = KBCollection(
        name=req.name,
        description=req.description,
        model=req.model,
        embed_model=req.embed_model or settings.EMBED_MODEL,
        chroma_collection=chroma_name,
        source_type="mixed",
        sources=[],
    )
    db.add(kb)
    await db.commit()
    await db.refresh(kb)
    return kb


@router.delete("/collections/{collection_id}")
async def delete_collection(
    collection_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(KBCollection).where(KBCollection.id == collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")
    try:
        chroma = get_chroma()
        chroma.delete_collection(kb.chroma_collection)
    except Exception:
        pass
    await db.delete(kb)
    await db.commit()
    return {"deleted": collection_id}


# ── File ingest ────────────────────────────────────────────────────────────────

@router.post("/ingest/file")
async def ingest_file(
    collection_id: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(KBCollection).where(KBCollection.id == collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    content = await file.read()
    text = ""
    ext = Path(file.filename).suffix.lower()

    if ext == ".pdf":
        from core.pdf_parser import parse_pdf_with_meta
        text, parser_used = await parse_pdf_with_meta(content)
        if not text:
            raise HTTPException(status_code=422, detail="Could not extract text from PDF. File may be scanned/image-only — try enabling OCR in Settings.")
        logger.info(f"PDF '{file.filename}' parsed with {parser_used}: {len(text.split())} words")
    elif ext == ".docx":
        try:
            from docx import Document
            import io
            doc = Document(io.BytesIO(content))
            text = "\n".join(p.text for p in doc.paragraphs)
        except ImportError:
            raise HTTPException(status_code=400, detail="python-docx not installed")
    else:
        text = content.decode("utf-8", errors="ignore")

    chunks = chunk_text(text)
    chroma = get_chroma()
    col = chroma.get_or_create_collection(kb.chroma_collection)
    n = await ingest_chunks(col, chunks, source=file.filename, embed_model=kb.embed_model)

    await db.execute(
        update(KBCollection).where(KBCollection.id == collection_id).values(
            doc_count=KBCollection.doc_count + n,
            last_ingested_at=datetime.utcnow(),
        )
    )
    await db.commit()
    return {"ingested_chunks": n, "file": file.filename, "collection": kb.name}


# ── URL ingest (one-shot) ──────────────────────────────────────────────────────

def _extract_text_from_html(html: str) -> str:
    for tag in ["script", "style", "nav", "footer", "header", "aside", "noscript"]:
        html = re.sub(rf"<{tag}[^>]*>.*?</{tag}>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text).strip()
    return text


@router.post("/ingest/url")
async def ingest_url(
    req: URLIngestRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(KBCollection).where(KBCollection.id == req.collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    total_chunks, errors = 0, []
    chroma = get_chroma()
    col = chroma.get_or_create_collection(kb.chroma_collection)

    for url in req.urls:
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True,
                                          headers={"User-Agent": "KRONOS/1.0 RAG"}) as client:
                r = await client.get(url)
                r.raise_for_status()
                text = _extract_text_from_html(r.text)
            n = await ingest_chunks(col, chunk_text(text), source=url, embed_model=kb.embed_model)
            total_chunks += n
        except Exception as e:
            errors.append({"url": url, "error": str(e)[:120]})

    await db.execute(
        update(KBCollection).where(KBCollection.id == req.collection_id).values(
            doc_count=KBCollection.doc_count + total_chunks,
            last_ingested_at=datetime.utcnow(),
        )
    )
    await db.commit()
    return {"ingested_chunks": total_chunks, "urls_processed": len(req.urls) - len(errors), "errors": errors}


# ── Sources management (stored in collection) ──────────────────────────────────

@router.post("/collections/{collection_id}/sources/folder")
async def add_folder_source(
    collection_id: str,
    req: FolderSourceConfig,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Add or update a folder watch source for this collection."""
    result = await db.execute(select(KBCollection).where(KBCollection.id == collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    sources = kb.sources or []
    # Remove existing folder source if any
    sources = [s for s in sources if s.get("type") != "folder"]
    sources.append({
        "type": "folder",
        "folder_path": req.folder_path,
        "schedule": req.schedule,
        "last_run": None,
        "last_chunks": 0,
        "status": "idle",
    })

    await db.execute(
        update(KBCollection).where(KBCollection.id == collection_id).values(
            sources=sources,
            watch_folder=req.folder_path,
        )
    )
    await db.commit()
    return {"status": "folder_source_added", "path": req.folder_path, "schedule": req.schedule}


@router.post("/collections/{collection_id}/sources/urls")
async def add_url_source(
    collection_id: str,
    req: URLSourceConfig,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Add or update URL crawl sources for this collection."""
    result = await db.execute(select(KBCollection).where(KBCollection.id == collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    sources = kb.sources or []
    sources = [s for s in sources if s.get("type") != "urls"]
    sources.append({
        "type": "urls",
        "urls": req.urls,
        "mode": req.mode,
        "max_depth": req.max_depth,
        "max_pages": req.max_pages,
        "include_pattern": req.include_pattern,
        "exclude_pattern": req.exclude_pattern,
        "schedule": req.schedule,
        "last_run": None,
        "last_chunks": 0,
        "status": "idle",
    })

    await db.execute(
        update(KBCollection).where(KBCollection.id == collection_id).values(sources=sources)
    )
    await db.commit()
    return {"status": "url_source_added", "urls": len(req.urls), "mode": req.mode}


@router.post("/collections/{collection_id}/sources/gdrive")
async def add_gdrive_source(
    collection_id: str,
    req: GDriveSourceConfig,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Add Google Drive source (public share link)."""
    result = await db.execute(select(KBCollection).where(KBCollection.id == collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    # Extract file/folder ID from share URL
    gdrive_id = _extract_gdrive_id(req.share_url)
    if not gdrive_id:
        raise HTTPException(status_code=400, detail="Cannot extract Google Drive ID from URL. Use a public share link.")

    sources = kb.sources or []
    sources = [s for s in sources if s.get("type") != "gdrive"]
    sources.append({
        "type": "gdrive",
        "share_url": req.share_url,
        "gdrive_id": gdrive_id,
        "schedule": req.schedule,
        "last_run": None,
        "last_chunks": 0,
        "status": "idle",
    })

    await db.execute(
        update(KBCollection).where(KBCollection.id == collection_id).values(
            sources=sources,
            gdrive_folder_id=gdrive_id,
        )
    )
    await db.commit()
    return {"status": "gdrive_source_added", "gdrive_id": gdrive_id}


def _extract_gdrive_id(url: str) -> Optional[str]:
    """Extract file/folder ID from Google Drive URL formats."""
    patterns = [
        r"/folders/([a-zA-Z0-9_-]+)",
        r"/file/d/([a-zA-Z0-9_-]+)",
        r"id=([a-zA-Z0-9_-]+)",
        r"/d/([a-zA-Z0-9_-]+)",
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return None


@router.delete("/collections/{collection_id}/sources/{source_type}")
async def remove_source(
    collection_id: str,
    source_type: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(KBCollection).where(KBCollection.id == collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    sources = [s for s in (kb.sources or []) if s.get("type") != source_type]
    await db.execute(
        update(KBCollection).where(KBCollection.id == collection_id).values(sources=sources)
    )
    await db.commit()
    return {"removed": source_type}


# ── Source run (trigger ingestion from a source) ───────────────────────────────

@router.post("/collections/{collection_id}/sources/{source_type}/run")
async def run_source(
    collection_id: str,
    source_type: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Manually trigger ingestion from a specific source."""
    result = await db.execute(select(KBCollection).where(KBCollection.id == collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    source = next((s for s in (kb.sources or []) if s.get("type") == source_type), None)
    if not source:
        raise HTTPException(status_code=404, detail=f"No {source_type} source configured")

    background_tasks.add_task(_run_source_ingest, collection_id, source_type, source, db)
    return {"status": "started", "source_type": source_type}


async def _run_source_ingest(collection_id: str, source_type: str, source: dict, db: AsyncSession):
    """Background: run ingestion for a source and update collection."""
    from sqlalchemy import select as sa_select

    result = await db.execute(sa_select(KBCollection).where(KBCollection.id == collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        return

    chroma = get_chroma()
    col = chroma.get_or_create_collection(kb.chroma_collection)
    chunks_added = 0
    errors = []

    try:
        if source_type == "folder":
            chunks_added = await _ingest_folder(col, source["folder_path"], kb.embed_model, errors)

        elif source_type == "urls":
            chunks_added = await _ingest_urls(col, source, kb.embed_model, errors)

        elif source_type == "gdrive":
            chunks_added = await _ingest_gdrive(col, source, kb.embed_model, errors)

        # Update source status in collection
        sources = kb.sources or []
        for s in sources:
            if s.get("type") == source_type:
                s["last_run"] = datetime.utcnow().isoformat()
                s["last_chunks"] = chunks_added
                s["status"] = "error" if errors else "idle"
                if errors:
                    s["last_error"] = str(errors[0])[:200]

        await db.execute(
            update(KBCollection).where(KBCollection.id == collection_id).values(
                sources=sources,
                doc_count=KBCollection.doc_count + chunks_added,
                last_ingested_at=datetime.utcnow(),
            )
        )
        await db.commit()
        logger.info(f"Source {source_type} on {kb.name}: {chunks_added} chunks")

    except Exception as e:
        logger.error(f"Source ingest failed: {e}")


async def _ingest_folder(col, folder_path: str, embed_model: str, errors: list) -> int:
    folder = Path(folder_path)
    if not folder.exists():
        errors.append(f"Folder not found: {folder_path}")
        return 0

    supported = {".txt", ".md", ".csv"}
    total = 0
    for fp in list(folder.rglob("*"))[:50]:
        if fp.suffix.lower() not in supported or not fp.is_file():
            continue
        try:
            text = fp.read_text(encoding="utf-8", errors="ignore")
            n = await ingest_chunks(col, chunk_text(text), source=str(fp), embed_model=embed_model)
            total += n
        except Exception as e:
            errors.append({"file": fp.name, "error": str(e)})
    return total


async def _ingest_urls(col, source: dict, embed_model: str, errors: list) -> int:
    urls = source.get("urls", [])
    mode = source.get("mode", "single")
    max_pages = min(source.get("max_pages", 20), 100)
    max_depth = source.get("max_depth", 1)
    include_pat = source.get("include_pattern")
    exclude_pat = source.get("exclude_pattern")

    visited = set()
    to_crawl = list(urls)
    depth_map = {u: 0 for u in urls}
    total = 0

    async with httpx.AsyncClient(
        timeout=30, follow_redirects=True,
        headers={"User-Agent": "KRONOS/1.0 RAG Crawler"}
    ) as client:

        # Sitemap mode: discover URLs first
        if mode == "sitemap":
            all_sitemap_urls = []
            for seed in urls:
                parsed = urlparse(seed)
                sitemap_url = f"{parsed.scheme}://{parsed.netloc}/sitemap.xml"
                try:
                    r = await client.get(sitemap_url)
                    if r.status_code == 200:
                        page_urls = re.findall(r"<loc>\s*(.*?)\s*</loc>", r.text)
                        all_sitemap_urls.extend(page_urls)
                except Exception:
                    pass
            to_crawl = list(set(all_sitemap_urls))[:max_pages]
            depth_map = {u: 0 for u in to_crawl}

        while to_crawl and len(visited) < max_pages:
            url = to_crawl.pop(0)
            if url in visited:
                continue
            if include_pat and not re.search(include_pat, url, re.I):
                continue
            if exclude_pat and re.search(exclude_pat, url, re.I):
                continue

            visited.add(url)
            current_depth = depth_map.get(url, 0)

            try:
                r = await client.get(url)
                if r.status_code != 200:
                    continue
                text = _extract_text_from_html(r.text)
                if len(text.strip()) < 50:
                    continue

                # Change detection
                h = hashlib.md5(text.encode()).hexdigest()

                n = await ingest_chunks(
                    col, chunk_text(text),
                    source=url, embed_model=embed_model,
                    extra_meta={"content_hash": h}
                )
                total += n

                # Recursive link following
                if mode == "recursive" and current_depth < max_depth:
                    base_domain = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
                    for href in re.findall(r'href=["\']([^"\'#][^"\']*)["\']', r.text, re.I):
                        absolute = urljoin(url, href)
                        parsed = urlparse(absolute)
                        if f"{parsed.scheme}://{parsed.netloc}" == base_domain:
                            if absolute not in visited and absolute not in to_crawl:
                                to_crawl.append(absolute)
                                depth_map[absolute] = current_depth + 1

                await asyncio.sleep(0.3)

            except Exception as e:
                errors.append({"url": url, "error": str(e)[:100]})

    return total


async def _ingest_gdrive(col, source: dict, embed_model: str, errors: list) -> int:
    """
    Ingest from Google Drive public share link.
    For files: downloads directly via export URL.
    For folders: lists files via Drive API (public) and ingests each.
    """
    gdrive_id = source.get("gdrive_id")
    if not gdrive_id:
        errors.append("No Google Drive ID configured")
        return 0

    total = 0

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        # Try as a single file first (Google Docs → text export)
        try:
            # Google Docs export to plain text
            export_url = f"https://docs.google.com/document/d/{gdrive_id}/export?format=txt"
            r = await client.get(export_url)
            if r.status_code == 200 and len(r.text) > 100:
                n = await ingest_chunks(col, chunk_text(r.text),
                                         source=f"gdrive:{gdrive_id}", embed_model=embed_model)
                return n
        except Exception:
            pass

        # Try as Google Sheet → CSV
        try:
            csv_url = f"https://docs.google.com/spreadsheets/d/{gdrive_id}/export?format=csv"
            r = await client.get(csv_url)
            if r.status_code == 200:
                n = await ingest_chunks(col, chunk_text(r.text),
                                         source=f"gdrive:{gdrive_id}", embed_model=embed_model)
                return n
        except Exception:
            pass

        # Try as public folder via Drive API v3 (no auth needed for public files)
        try:
            list_url = f"https://www.googleapis.com/drive/v3/files"
            params = {
                "q": f"'{gdrive_id}' in parents",
                "fields": "files(id,name,mimeType)",
                "key": "AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY",  # public API key for metadata only
            }
            r = await client.get(list_url, params=params)
            if r.status_code == 200:
                files = r.json().get("files", [])
                for f in files[:20]:
                    file_id = f["id"]
                    mime = f.get("mimeType", "")
                    if "document" in mime:
                        export = f"https://docs.google.com/document/d/{file_id}/export?format=txt"
                    elif "spreadsheet" in mime:
                        export = f"https://docs.google.com/spreadsheets/d/{file_id}/export?format=csv"
                    else:
                        continue
                    try:
                        fr = await client.get(export)
                        if fr.status_code == 200:
                            n = await ingest_chunks(col, chunk_text(fr.text),
                                                     source=f"gdrive:{file_id}:{f['name']}",
                                                     embed_model=embed_model)
                            total += n
                    except Exception as fe:
                        errors.append({"file": f["name"], "error": str(fe)})
        except Exception as e:
            errors.append({"gdrive": str(e)[:120]})

    return total


# ── Query ──────────────────────────────────────────────────────────────────────

@router.post("/query")
async def query_kb(
    req: QueryRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(KBCollection).where(KBCollection.id == req.collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    query_embedding = (await embed_texts([req.query], model=kb.embed_model))[0]
    chroma = get_chroma()
    col = chroma.get_or_create_collection(kb.chroma_collection)
    results = col.query(
        query_embeddings=[query_embedding],
        n_results=min(req.top_k, col.count() or 1),
        include=["documents", "distances", "metadatas"],
    )

    hits = []
    for doc, dist, meta in zip(
        results["documents"][0],
        results["distances"][0],
        results["metadatas"][0],
    ):
        hits.append({
            "text": doc,
            "relevance": round(1 - dist, 3),
            "source": (meta or {}).get("source", ""),
        })
    return {"results": hits, "query": req.query, "collection": kb.name}


# ── Deploy agent from collection ───────────────────────────────────────────────

@router.post("/collections/{collection_id}/deploy-agent")
async def deploy_agent_from_collection(
    collection_id: str,
    req: DeployAgentRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Create + queue approval to deploy an agent directly from a KB collection.
    The agent will use this collection's model (or override) and system prompt.
    """
    result = await db.execute(select(KBCollection).where(KBCollection.id == collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    model = req.model or kb.model
    agent_name = req.agent_name or f"{kb.name}_agent"

    # Check if agent already exists for this collection
    if kb.agent_id:
        existing = await db.execute(select(Agent).where(Agent.id == kb.agent_id))
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail=f"Agent '{agent_name}' already exists for this collection. Delete it first or update it."
            )

    # Create the agent
    system_prompt = (
        f"You are a knowledgeable assistant specializing in the content from the '{kb.name}' knowledge base.\n"
        f"Description: {kb.description or 'Specialized knowledge assistant'}\n\n"
        f"When answering:\n"
        f"1. Use information from your knowledge base — cite the source when possible\n"
        f"2. If the answer isn't in the KB, say so clearly\n"
        f"3. Be concise and accurate"
    )

    agent = Agent(
        name=agent_name,
        description=f"Agent for KB: {kb.name}",
        agent_type="custom",
        model=model,
        kb_collection_id=collection_id,
        system_prompt=system_prompt,
        status="staged",
        config={"auto_created_from_kb": collection_id},
    )
    db.add(agent)
    await db.flush()

    # Link agent to collection
    await db.execute(
        update(KBCollection).where(KBCollection.id == collection_id).values(agent_id=agent.id)
    )

    # Queue deploy approval
    approval = await create_approval_request(
        action_type="agent_deploy",
        payload={
            "agent_id": agent.id,
            "agent_name": agent_name,
            "agent_type": "custom",
            "model": model,
            "kb_info": {"name": kb.name, "chroma_collection": kb.chroma_collection},
            "port": None,
            "env_vars": {},
        },
        db=db,
    )

    await db.commit()
    await db.refresh(agent)

    return {
        "agent_id": agent.id,
        "agent_name": agent_name,
        "approval_request_id": approval.id,
        "message": f"Agent created. Go to Approvals → approve '{agent_name}' deploy → Execute.",
    }


# ── Scheduled source runner (called from main.py lifespan) ────────────────────

async def run_scheduled_sources(db: AsyncSession):
    """Check all collections for overdue scheduled sources and run them."""
    from datetime import timedelta

    result = await db.execute(select(KBCollection))
    collections = result.scalars().all()

    schedule_delta = {
        "hourly": timedelta(hours=1),
        "daily":  timedelta(days=1),
        "weekly": timedelta(weeks=1),
    }

    now = datetime.utcnow()
    for kb in collections:
        for source in (kb.sources or []):
            schedule = source.get("schedule", "manual")
            if schedule == "manual":
                continue
            delta = schedule_delta.get(schedule)
            if not delta:
                continue
            last_run = source.get("last_run")
            last_dt = datetime.fromisoformat(last_run) if last_run else None
            if last_dt is None or (now - last_dt) >= delta:
                if source.get("status") != "running":
                    source["status"] = "running"
                    logger.info(f"Scheduled source {source['type']} on {kb.name}")
                    await _run_source_ingest(kb.id, source["type"], source, db)
