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
            "cpu_percent": None,
            "memory_mb": None,
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
                entry["memory_mb"] = round(stats["memory_stats"].get("usage", 0) / 1e6, 1)
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
