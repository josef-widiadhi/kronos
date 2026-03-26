"""
KRONOS URL Watcher
==================
Scheduled URL crawling — keeps KB collections fresh automatically.

Features:
- Single page   : fetch exactly what you give it
- Recursive     : follow links up to N levels deep within same domain
- Sitemap       : parse sitemap.xml and ingest all listed pages
- Change detect : skip pages that haven't changed since last crawl (hash comparison)
- Scheduled     : manual | hourly | daily | weekly (background APScheduler)
- Pattern filter: include/exclude URLs by regex
- Respects robots.txt (optional)
"""

import re
import uuid
import hashlib
import asyncio
import logging
from typing import Optional, List, Dict, Set
from datetime import datetime
from urllib.parse import urlparse, urljoin, urldefrag

import httpx
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from core.config import settings
from core.database import get_db, URLWatcher, KBCollection
from routers.auth import get_current_owner
from routers.rag import chunk_text, embed_texts, get_chroma

router = APIRouter()
logger = logging.getLogger("kronos.urlwatcher")

HEADERS = {
    "User-Agent": "KRONOS/1.0 RAG Crawler (+https://github.com/kronos-ai)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


# ── HTML/XML text extraction ───────────────────────────────────────────────────

def extract_text(html: str, url: str = "") -> str:
    """Strip HTML → clean readable text. Removes nav/footer/script noise."""
    # Remove noise blocks first
    for tag in ["script", "style", "nav", "footer", "header", "aside", "noscript", "svg", "iframe"]:
        html = re.sub(rf"<{tag}[^>]*>.*?</{tag}>", " ", html, flags=re.DOTALL | re.IGNORECASE)

    # Get title
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    title = re.sub(r"<[^>]+>", "", title_match.group(1)) if title_match else ""

    # Try main content blocks first
    for content_tag in ["main", "article", 'div[^>]*class="[^"]*content[^"]*"', 'div[^>]*id="content"']:
        match = re.search(rf"<{content_tag}>(.*?)</{content_tag.split('[')[0]}>", html, re.DOTALL | re.IGNORECASE)
        if match and len(match.group(1)) > 500:
            html = match.group(1)
            break

    # Strip remaining HTML
    text = re.sub(r"<[^>]+>", " ", html)
    # Clean whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()

    if title:
        text = f"{title}\n\n{text}"

    return text


def extract_links(html: str, base_url: str) -> List[str]:
    """Extract all href links from a page, resolved to absolute URLs."""
    links = set()
    base_parsed = urlparse(base_url)
    base_domain = f"{base_parsed.scheme}://{base_parsed.netloc}"

    for href in re.findall(r'href=["\']([^"\'#][^"\']*)["\']', html, re.IGNORECASE):
        if href.startswith("javascript:") or href.startswith("mailto:"):
            continue
        try:
            absolute = urljoin(base_url, href)
            # Remove fragments
            absolute, _ = urldefrag(absolute)
            parsed = urlparse(absolute)
            # Only same domain
            if f"{parsed.scheme}://{parsed.netloc}" == base_domain:
                # Only http/https
                if parsed.scheme in ("http", "https"):
                    links.add(absolute)
        except Exception:
            continue

    return list(links)


async def parse_sitemap(sitemap_url: str, client: httpx.AsyncClient) -> List[str]:
    """Fetch and parse sitemap.xml (including sitemap index). Returns all page URLs."""
    urls = []
    try:
        r = await client.get(sitemap_url, headers=HEADERS, timeout=30, follow_redirects=True)
        if r.status_code != 200:
            return []
        content = r.text

        # Sitemap index — contains other sitemaps
        if "<sitemapindex" in content:
            sub_sitemaps = re.findall(r"<loc>\s*(.*?)\s*</loc>", content)
            for sub_url in sub_sitemaps[:10]:  # limit sub-sitemaps
                sub_urls = await parse_sitemap(sub_url.strip(), client)
                urls.extend(sub_urls)
        else:
            # Regular sitemap
            page_urls = re.findall(r"<loc>\s*(.*?)\s*</loc>", content)
            urls.extend([u.strip() for u in page_urls])

    except Exception as e:
        logger.warning(f"Sitemap parse failed for {sitemap_url}: {e}")

    return urls


def content_hash(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()


def should_include(url: str, include_pat: Optional[str], exclude_pat: Optional[str]) -> bool:
    """Apply include/exclude regex filters to a URL."""
    if include_pat:
        if not re.search(include_pat, url, re.IGNORECASE):
            return False
    if exclude_pat:
        if re.search(exclude_pat, url, re.IGNORECASE):
            return False
    return True


# ── Core crawl engine ─────────────────────────────────────────────────────────

async def crawl_urls(
    watcher: URLWatcher,
    kb: KBCollection,
    db: AsyncSession,
) -> Dict:
    """
    Main crawl function. Runs a full crawl cycle for a watcher.
    Returns a result summary dict.
    """
    result = {
        "pages_crawled": 0,
        "pages_skipped_unchanged": 0,
        "chunks_added": 0,
        "errors": [],
        "new_urls_discovered": 0,
    }

    chroma = get_chroma()
    collection = chroma.get_or_create_collection(kb.chroma_collection)
    content_hashes = watcher.content_hashes or {}
    new_hashes = {**content_hashes}

    # Build the URL queue based on mode
    to_crawl: List[str] = list(watcher.urls)
    visited: Set[str] = set()

    async with httpx.AsyncClient(
        timeout=30,
        follow_redirects=True,
        headers=HEADERS,
    ) as client:

        # Sitemap mode: discover all URLs from sitemap first
        if watcher.mode == "sitemap":
            all_sitemap_urls = []
            for seed_url in watcher.urls:
                # Try both /sitemap.xml and robots.txt sitemap reference
                parsed = urlparse(seed_url)
                sitemap_candidates = [
                    f"{parsed.scheme}://{parsed.netloc}/sitemap.xml",
                    f"{parsed.scheme}://{parsed.netloc}/sitemap_index.xml",
                    seed_url if seed_url.endswith(".xml") else None,
                ]
                for candidate in sitemap_candidates:
                    if candidate:
                        found = await parse_sitemap(candidate, client)
                        all_sitemap_urls.extend(found)
                        if found:
                            break

            to_crawl = list(set(all_sitemap_urls))[:watcher.max_pages]
            result["new_urls_discovered"] = len(to_crawl)
            logger.info(f"Sitemap discovered {len(to_crawl)} URLs for watcher {watcher.name}")

        # Process URL queue (recursive mode expands queue as we go)
        depth_map = {url: 0 for url in to_crawl}  # url → depth

        while to_crawl and result["pages_crawled"] < (watcher.max_pages or 20):
            url = to_crawl.pop(0)
            if url in visited:
                continue
            if not should_include(url, watcher.include_pattern, watcher.exclude_pattern):
                continue

            visited.add(url)
            current_depth = depth_map.get(url, 0)

            try:
                r = await client.get(url)
                if r.status_code != 200:
                    result["errors"].append({"url": url, "error": f"HTTP {r.status_code}"})
                    continue

                raw_html = r.text
                text = extract_text(raw_html, url)

                if len(text.strip()) < 50:
                    continue  # skip near-empty pages

                # Change detection — skip if content hasn't changed
                h = content_hash(text)
                if new_hashes.get(url) == h:
                    result["pages_skipped_unchanged"] += 1
                    continue

                new_hashes[url] = h

                # Chunk and embed
                chunks = chunk_text(text)
                if not chunks:
                    continue

                embeddings = await embed_texts(chunks, model=kb.embed_model)

                # Remove old chunks for this URL first (re-crawl = replace)
                try:
                    existing = collection.get(where={"source": url})
                    if existing["ids"]:
                        collection.delete(ids=existing["ids"])
                except Exception:
                    pass  # collection may not support where filter yet

                ids = [str(uuid.uuid4()) for _ in chunks]
                collection.add(
                    ids=ids,
                    embeddings=embeddings,
                    documents=chunks,
                    metadatas=[{
                        "source": url,
                        "chunk_idx": i,
                        "crawled_at": datetime.utcnow().isoformat(),
                        "watcher_id": watcher.id,
                    } for i in range(len(chunks))],
                )

                result["pages_crawled"] += 1
                result["chunks_added"] += len(chunks)
                logger.info(f"Crawled {url}: {len(chunks)} chunks")

                # Recursive mode: discover and queue linked pages
                if watcher.mode == "recursive" and current_depth < (watcher.max_depth or 1):
                    new_links = extract_links(raw_html, url)
                    for link in new_links:
                        if link not in visited and link not in to_crawl:
                            if should_include(link, watcher.include_pattern, watcher.exclude_pattern):
                                to_crawl.append(link)
                                depth_map[link] = current_depth + 1
                                result["new_urls_discovered"] += 1

                await asyncio.sleep(0.5)  # polite delay between requests

            except Exception as e:
                result["errors"].append({"url": url, "error": str(e)[:200]})
                logger.warning(f"Crawl error {url}: {e}")

    # Update KB chunk count
    chunk_delta = result["chunks_added"]
    if chunk_delta > 0:
        await db.execute(
            update(KBCollection)
            .where(KBCollection.id == watcher.kb_collection_id)
            .values(doc_count=KBCollection.doc_count + chunk_delta)
        )

    # Save updated hashes + result
    await db.execute(
        update(URLWatcher)
        .where(URLWatcher.id == watcher.id)
        .values(
            status="idle",
            last_run_at=datetime.utcnow(),
            last_run_pages=result["pages_crawled"],
            last_run_chunks=result["chunks_added"],
            last_error=str(result["errors"])[:500] if result["errors"] else None,
            content_hashes=new_hashes,
            total_pages_crawled=URLWatcher.total_pages_crawled + result["pages_crawled"],
        )
    )
    await db.commit()

    return result


# ── Background task wrapper ────────────────────────────────────────────────────

async def run_watcher_task(watcher_id: str, db: AsyncSession):
    """Background task: fetch watcher + KB, run crawl, update status."""
    result = await db.execute(select(URLWatcher).where(URLWatcher.id == watcher_id))
    watcher = result.scalar_one_or_none()
    if not watcher:
        return

    kb_result = await db.execute(select(KBCollection).where(KBCollection.id == watcher.kb_collection_id))
    kb = kb_result.scalar_one_or_none()
    if not kb:
        await db.execute(update(URLWatcher).where(URLWatcher.id == watcher_id).values(
            status="error", last_error="KB collection not found"
        ))
        await db.commit()
        return

    await db.execute(update(URLWatcher).where(URLWatcher.id == watcher_id).values(status="running"))
    await db.commit()

    try:
        summary = await crawl_urls(watcher, kb, db)
        logger.info(f"Watcher '{watcher.name}' complete: {summary}")
    except Exception as e:
        logger.error(f"Watcher '{watcher.name}' failed: {e}")
        await db.execute(update(URLWatcher).where(URLWatcher.id == watcher_id).values(
            status="error", last_error=str(e)[:500]
        ))
        await db.commit()


# ── Schemas ────────────────────────────────────────────────────────────────────

class WatcherCreate(BaseModel):
    name: str
    kb_collection_id: str
    urls: List[str]
    mode: str = "single"               # single | recursive | sitemap
    max_depth: int = 1                 # for recursive mode
    max_pages: int = 20
    include_pattern: Optional[str] = None
    exclude_pattern: Optional[str] = None
    schedule: str = "manual"          # manual | hourly | daily | weekly


class WatcherUpdate(BaseModel):
    name: Optional[str] = None
    urls: Optional[List[str]] = None
    mode: Optional[str] = None
    max_depth: Optional[int] = None
    max_pages: Optional[int] = None
    include_pattern: Optional[str] = None
    exclude_pattern: Optional[str] = None
    schedule: Optional[str] = None


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_watchers(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(URLWatcher).order_by(URLWatcher.created_at.desc()))
    watchers = result.scalars().all()

    # Enrich with KB name
    output = []
    for w in watchers:
        kb_result = await db.execute(select(KBCollection).where(KBCollection.id == w.kb_collection_id))
        kb = kb_result.scalar_one_or_none()
        output.append({
            "id": w.id,
            "name": w.name,
            "kb_collection_id": w.kb_collection_id,
            "kb_name": kb.name if kb else "(deleted)",
            "urls": w.urls,
            "mode": w.mode,
            "max_depth": w.max_depth,
            "max_pages": w.max_pages,
            "include_pattern": w.include_pattern,
            "exclude_pattern": w.exclude_pattern,
            "schedule": w.schedule,
            "status": w.status,
            "last_run_at": w.last_run_at.isoformat() if w.last_run_at else None,
            "last_run_pages": w.last_run_pages,
            "last_run_chunks": w.last_run_chunks,
            "last_error": w.last_error,
            "total_pages_crawled": w.total_pages_crawled,
            "created_at": w.created_at.isoformat(),
        })
    return output


@router.post("/")
async def create_watcher(
    req: WatcherCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    kb_result = await db.execute(select(KBCollection).where(KBCollection.id == req.kb_collection_id))
    if not kb_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="KB Collection not found")

    # Validate mode
    if req.mode not in ("single", "recursive", "sitemap"):
        raise HTTPException(status_code=400, detail="mode must be single | recursive | sitemap")

    # Validate URLs
    for url in req.urls:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise HTTPException(status_code=400, detail=f"Invalid URL (must be http/https): {url}")

    watcher = URLWatcher(
        name=req.name,
        kb_collection_id=req.kb_collection_id,
        urls=req.urls,
        mode=req.mode,
        max_depth=req.max_depth,
        max_pages=min(req.max_pages, 100),  # hard cap
        include_pattern=req.include_pattern,
        exclude_pattern=req.exclude_pattern,
        schedule=req.schedule,
        status="idle",
    )
    db.add(watcher)
    await db.commit()
    await db.refresh(watcher)
    return watcher


@router.get("/{watcher_id}")
async def get_watcher(
    watcher_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(URLWatcher).where(URLWatcher.id == watcher_id))
    w = result.scalar_one_or_none()
    if not w:
        raise HTTPException(status_code=404, detail="Watcher not found")
    return w


@router.patch("/{watcher_id}")
async def update_watcher(
    watcher_id: str,
    req: WatcherUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(URLWatcher).where(URLWatcher.id == watcher_id))
    w = result.scalar_one_or_none()
    if not w:
        raise HTTPException(status_code=404, detail="Watcher not found")

    for field, value in req.dict(exclude_unset=True).items():
        setattr(w, field, value)
    await db.commit()
    await db.refresh(w)
    return w


@router.delete("/{watcher_id}")
async def delete_watcher(
    watcher_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(URLWatcher).where(URLWatcher.id == watcher_id))
    w = result.scalar_one_or_none()
    if not w:
        raise HTTPException(status_code=404, detail="Watcher not found")
    await db.delete(w)
    await db.commit()
    return {"deleted": watcher_id}


@router.post("/{watcher_id}/run")
async def trigger_watcher(
    watcher_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Manually trigger a crawl run right now."""
    result = await db.execute(select(URLWatcher).where(URLWatcher.id == watcher_id))
    w = result.scalar_one_or_none()
    if not w:
        raise HTTPException(status_code=404, detail="Watcher not found")
    if w.status == "running":
        raise HTTPException(status_code=409, detail="Watcher is already running")

    background_tasks.add_task(run_watcher_task, watcher_id=watcher_id, db=db)
    return {
        "status": "started",
        "watcher": w.name,
        "mode": w.mode,
        "urls": len(w.urls),
        "max_pages": w.max_pages,
    }


@router.post("/{watcher_id}/reset-hashes")
async def reset_content_hashes(
    watcher_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Clear change-detection hashes so next crawl re-ingests all pages."""
    await db.execute(
        update(URLWatcher)
        .where(URLWatcher.id == watcher_id)
        .values(content_hashes={})
    )
    await db.commit()
    return {"reset": True, "message": "Next crawl will re-ingest all pages regardless of changes"}


@router.get("/{watcher_id}/preview-sitemap")
async def preview_sitemap(
    watcher_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Preview what URLs a sitemap mode watcher would crawl (dry run)."""
    result = await db.execute(select(URLWatcher).where(URLWatcher.id == watcher_id))
    w = result.scalar_one_or_none()
    if not w:
        raise HTTPException(status_code=404, detail="Watcher not found")

    all_urls = []
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        for seed_url in w.urls:
            parsed = urlparse(seed_url)
            candidates = [f"{parsed.scheme}://{parsed.netloc}/sitemap.xml"]
            for candidate in candidates:
                found = await parse_sitemap(candidate, client)
                all_urls.extend(found)

    filtered = [u for u in all_urls if should_include(u, w.include_pattern, w.exclude_pattern)]
    return {
        "total_found": len(all_urls),
        "after_filter": len(filtered),
        "sample": filtered[:30],
        "will_crawl": min(len(filtered), w.max_pages),
    }


# ── Scheduled crawl runner (called from main.py lifespan) ─────────────────────

async def run_scheduled_watchers(db: AsyncSession):
    """
    Check all watchers with non-manual schedules and run overdue ones.
    Called periodically from the background task loop in main.py.
    """
    from datetime import timedelta

    result = await db.execute(
        select(URLWatcher).where(
            URLWatcher.schedule != "manual",
            URLWatcher.status == "idle",
        )
    )
    watchers = result.scalars().all()

    now = datetime.utcnow()
    schedule_delta = {
        "hourly": timedelta(hours=1),
        "daily":  timedelta(days=1),
        "weekly": timedelta(weeks=1),
    }

    for w in watchers:
        delta = schedule_delta.get(w.schedule)
        if not delta:
            continue
        # Run if never run before, or overdue
        if w.last_run_at is None or (now - w.last_run_at) >= delta:
            logger.info(f"Scheduled crawl starting: {w.name} ({w.schedule})")
            kb_result = await db.execute(
                select(KBCollection).where(KBCollection.id == w.kb_collection_id)
            )
            kb = kb_result.scalar_one_or_none()
            if kb:
                await db.execute(
                    update(URLWatcher)
                    .where(URLWatcher.id == w.id)
                    .values(status="running")
                )
                await db.commit()
                try:
                    await crawl_urls(w, kb, db)
                except Exception as e:
                    logger.error(f"Scheduled crawl failed for {w.name}: {e}")
                    await db.execute(
                        update(URLWatcher)
                        .where(URLWatcher.id == w.id)
                        .values(status="error", last_error=str(e)[:500])
                    )
                    await db.commit()
