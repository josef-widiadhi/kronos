"""
Monitor router — real-time stats for deployed agents.
"""
import docker
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db, Agent
from routers.auth import get_current_owner

router = APIRouter()


@router.get("/overview")
async def monitor_overview(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Return status overview of all agents + container stats."""
    result = await db.execute(select(Agent).order_by(Agent.created_at.desc()))
    agents = result.scalars().all()

    dclient = None
    try:
        dclient = docker.from_env()
    except Exception:
        pass

    data = []
    for agent in agents:
        entry = {
            "id": agent.id,
            "name": agent.name,
            "type": agent.agent_type,
            "model": agent.model,
            "status": agent.status,
            "container_name": agent.container_name,
            "mem_limit_mb": agent.mem_limit_mb,
            "cpu_shares": agent.cpu_shares,
            "cpu_percent": None,
            "memory_mb": None,
            "memory_pct": None,
            "activity": None,
        }

        if dclient and agent.container_id:
            try:
                container = dclient.containers.get(agent.container_id)
                stats = container.stats(stream=False)
                cpu_delta = (
                    stats["cpu_stats"]["cpu_usage"]["total_usage"]
                    - stats["precpu_stats"]["cpu_usage"]["total_usage"]
                )
                sys_delta = (
                    stats["cpu_stats"]["system_cpu_usage"]
                    - stats["precpu_stats"]["system_cpu_usage"]
                )
                ncpu = stats["cpu_stats"].get("online_cpus", 1)
                entry["cpu_percent"] = round((cpu_delta / sys_delta) * ncpu * 100, 2) if sys_delta > 0 else 0
                mem_usage_mb = round(stats["memory_stats"].get("usage", 0) / 1e6, 1)
                entry["memory_mb"] = mem_usage_mb
                # memory_pct: actual vs limit (None if no limit set)
                if agent.mem_limit_mb and agent.mem_limit_mb > 0:
                    entry["memory_pct"] = round((mem_usage_mb / agent.mem_limit_mb) * 100, 1)
            except Exception:
                pass

            # Try fetching live activity from worker
            try:
                import httpx, asyncio
                async with httpx.AsyncClient(timeout=2) as client:
                    r = await client.get(f"http://{agent.container_name}:8080/activity")
                    if r.status_code == 200:
                        entry["activity"] = r.json()
            except Exception:
                pass

        data.append(entry)

    return {"agents": data, "total": len(data)}


@router.get("/system")
async def system_health(_: str = Depends(get_current_owner)):
    """System-wide health check — API, Ollama, ChromaDB, Redis, Docker."""
    import httpx, redis.asyncio as aioredis
    from core.config import settings

    results = {}

    # Ollama
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"{settings.OLLAMA_BASE_URL}/api/version")
            results["ollama"] = {"ok": True, "version": r.json().get("version"), "url": settings.OLLAMA_BASE_URL}
    except Exception as e:
        results["ollama"] = {"ok": False, "error": str(e)[:80]}

    # ChromaDB
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"http://{settings.CHROMA_HOST}:{settings.CHROMA_PORT}/api/v2/heartbeat")
            if r.status_code != 200:
                r = await c.get(f"http://{settings.CHROMA_HOST}:{settings.CHROMA_PORT}/api/v1/heartbeat")
            results["chromadb"] = {"ok": r.status_code == 200, "url": f"{settings.CHROMA_HOST}:{settings.CHROMA_PORT}"}
    except Exception as e:
        results["chromadb"] = {"ok": False, "error": str(e)[:80]}

    # Redis
    try:
        r = aioredis.from_url(settings.REDIS_URL)
        await r.ping()
        await r.aclose()
        results["redis"] = {"ok": True, "url": settings.REDIS_URL}
    except Exception as e:
        results["redis"] = {"ok": False, "error": str(e)[:80]}

    # Docker
    try:
        import docker as docker_lib
        dclient = docker_lib.from_env()
        info = dclient.info()
        results["docker"] = {"ok": True, "containers": info.get("Containers", 0), "running": info.get("ContainersRunning", 0)}
    except Exception as e:
        results["docker"] = {"ok": False, "error": str(e)[:80]}

    # LiteParse availability (optional — not counted in overall health)
    from core.pdf_parser import liteparse_available
    lit_ok = liteparse_available()
    results["liteparse"] = {
        "ok": lit_ok,
        "note": "lit CLI found — layout-aware PDF parsing active" if lit_ok else "not installed — using pypdf fallback",
        "install": "npm install -g @llamaindex/liteparse",
    }

    # Overall health excludes liteparse (it's optional)
    core_services = {k: v for k, v in results.items() if k != "liteparse"}
    all_ok = all(v.get("ok") for v in core_services.values())
    return {"healthy": all_ok, "services": results}
