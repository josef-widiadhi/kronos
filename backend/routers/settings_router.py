"""
KRONOS System Settings
======================
Persistent settings stored in PostgreSQL — survive container restarts.
Settings are typed (string/int/bool/json), grouped by category, and
accessible via API. The UI settings page reads/writes them.

Categories:
  compute   — GPU/CPU mode, VRAM limits, batch sizes
  finetune  — Default training hyperparameters
  rag       — Chunk size, overlap, embed model defaults
  ollama    — Default model, timeouts
  general   — App name, timezone, log level
"""
import json
import logging
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db, SystemSettings
from routers.auth import get_current_owner

router = APIRouter()
logger = logging.getLogger("kronos.settings")


# ── Default settings catalogue ────────────────────────────────────────────────
# These are written on first startup if keys don't exist yet.

DEFAULTS: List[Dict] = [
    # ── Compute ───────────────────────────────────────────────────────────────
    {
        "key": "compute.device",
        "value": "cpu",
        "value_type": "string",
        "category": "compute",
        "label": "Training Device",
        "description": (
            "Hardware used for fine-tuning jobs.\n"
            "cpu   — works on any machine, very slow (hours per epoch for 7B models)\n"
            "cuda  — NVIDIA GPU, fast (minutes per epoch), recommended\n"
            "mps   — Apple Silicon GPU (M1/M2/M3), medium speed\n"
            "auto  — auto-detect: use CUDA if available, else MPS, else CPU"
        ),
    },
    {
        "key": "compute.gpu_memory_gb",
        "value": "0",
        "value_type": "int",
        "category": "compute",
        "label": "GPU VRAM (GB)",
        "description": "How many GB of VRAM your GPU has. 0 = auto-detect. Used to pick safe batch sizes.\nExamples: RTX 3060=12, RTX 4070=12, RTX 4090=24, RTX 3090=24, GTX 1080Ti=11",
    },
    {
        "key": "compute.unsloth_image",
        "value": "unsloth/unsloth-repo:latest",
        "value_type": "string",
        "category": "compute",
        "label": "Unsloth Docker Image",
        "description": (
            "Docker image used for fine-tuning. Must be pulled before use.\n"
            "unsloth/unsloth-repo:latest  — full Unsloth (GPU, recommended)\n"
            "unsloth/unsloth-repo:cpu     — CPU-only build (slower, no GPU needed)\n"
            "Pull it: docker pull unsloth/unsloth-repo:latest"
        ),
    },
    {
        "key": "compute.max_parallel_jobs",
        "value": "1",
        "value_type": "int",
        "category": "compute",
        "label": "Max Parallel Fine-tune Jobs",
        "description": "How many fine-tune jobs can run simultaneously. Keep at 1 unless you have multiple GPUs.",
    },
    {
        "key": "agents.default_mem_limit_mb",
        "value": "512",
        "value_type": "int",
        "category": "compute",
        "label": "Agent Memory Limit (MB)",
        "description": (
            "Maximum RAM each deployed agent container may use, in megabytes.\n"
            "0 = no limit (agent can use all available host memory — not recommended).\n"
            "Recommended values:\n"
            "  256  — tiny models (tinyllama), minimal KB\n"
            "  512  — small models (qwen2.5:0.5b), moderate KB (default)\n"
            " 1024  — medium models (qwen2.5:7b), large KB\n"
            " 2048  — large models (llama3.1:8b) with heavy workloads\n"
            "If an agent is killed (OOMKilled), increase this value."
        ),
    },
    {
        "key": "agents.default_cpu_shares",
        "value": "512",
        "value_type": "int",
        "category": "compute",
        "label": "Agent CPU Shares",
        "description": (
            "Relative CPU weight for each agent container. Not a hard cap — it's a scheduling priority.\n"
            "1024 = 1 full CPU core equivalent weight.\n"
            "512  = half weight (default — agents yield to the API/DB under load).\n"
            "256  = background priority (low-priority agents).\n"
            "This only affects behavior when the host CPU is under contention."
        ),
    },
    {
        "key": "agents.max_agents",
        "value": "5",
        "value_type": "int",
        "category": "compute",
        "label": "Max Deployed Agents",
        "description": (
            "Maximum number of agent containers that can run simultaneously.\n"
            "Each agent holds its model context in memory via Ollama.\n"
            "Recommended: 1–2 on a CPU-only machine, 4–8 on a machine with 16GB+ RAM."
        ),
    },

    # ── Fine-tune defaults ─────────────────────────────────────────────────────
    {
        "key": "finetune.default_method",
        "value": "lora",
        "value_type": "string",
        "category": "finetune",
        "label": "Default Training Method",
        "description": (
            "lora   — LoRA adapters, 16-bit, ~6GB VRAM for 7B models. Recommended.\n"
            "qlora  — QLoRA (4-bit quantized), ~4GB VRAM. Slightly less accurate.\n"
            "full   — Full parameter fine-tuning. Needs 40GB+ VRAM. Not recommended unless you have H100."
        ),
    },
    {
        "key": "finetune.default_epochs",
        "value": "3",
        "value_type": "int",
        "category": "finetune",
        "label": "Default Training Epochs",
        "description": "How many times to iterate over the entire dataset. 1-3 for most tasks. More = risk of overfitting.",
    },
    {
        "key": "finetune.default_lora_r",
        "value": "16",
        "value_type": "int",
        "category": "finetune",
        "label": "LoRA Rank (r)",
        "description": "LoRA rank. Higher = more parameters, better quality, more VRAM.\n8 = minimal, 16 = balanced (default), 32 = higher quality, 64 = near full fine-tune quality.",
    },
    {
        "key": "finetune.default_learning_rate",
        "value": "0.0002",
        "value_type": "string",
        "category": "finetune",
        "label": "Learning Rate",
        "description": "Training learning rate. 2e-4 (0.0002) is standard for LoRA. Lower = slower but more stable.",
    },
    {
        "key": "finetune.default_batch_size",
        "value": "2",
        "value_type": "int",
        "category": "finetune",
        "label": "Batch Size (per device)",
        "description": "Samples per GPU per step. Higher = faster training but more VRAM.\nCPU: use 1. GPU 8GB: use 2. GPU 24GB: use 4-8.",
    },
    {
        "key": "finetune.default_grad_accum",
        "value": "4",
        "value_type": "int",
        "category": "finetune",
        "label": "Gradient Accumulation Steps",
        "description": "Effective batch size = batch_size × grad_accum. Increase this if you need larger effective batch without more VRAM.",
    },
    {
        "key": "finetune.default_max_seq_len",
        "value": "2048",
        "value_type": "int",
        "category": "finetune",
        "label": "Max Sequence Length",
        "description": "Maximum token length for training samples. Longer = more VRAM. 2048 works for most tasks.",
    },
    {
        "key": "finetune.gguf_quantization",
        "value": "q4_k_m",
        "value_type": "string",
        "category": "finetune",
        "label": "Default GGUF Quantization",
        "description": (
            "Quantization level for GGUF export. Lower bits = smaller file, lower quality.\n"
            "q2_k    — smallest (~2GB for 7B), lowest quality\n"
            "q4_k_m  — balanced (default, ~4GB for 7B), recommended\n"
            "q5_k_m  — better quality (~5GB for 7B)\n"
            "q8_0    — near full quality (~8GB for 7B)\n"
            "f16     — full precision (~14GB for 7B)"
        ),
    },
    {
        "key": "finetune.output_dir",
        "value": "/app/finetune_outputs",
        "value_type": "string",
        "category": "finetune",
        "label": "Training Output Directory",
        "description": "Where fine-tune adapters and GGUF exports are saved inside the container. Mount this as a volume to keep results after restart.",
    },

    # ── RAG defaults ───────────────────────────────────────────────────────────
    {
        "key": "rag.default_embed_model",
        "value": "nomic-embed-text",
        "value_type": "string",
        "category": "rag",
        "label": "Default Embed Model",
        "description": "Default embedding model for new KB collections. Must be pulled in Ollama.\nnomic-embed-text — recommended, fast, good quality\nmxbai-embed-large — higher quality, larger (1.5GB)\nall-minilm — tiny, fast, lower quality",
    },
    {
        "key": "rag.chunk_size",
        "value": "512",
        "value_type": "int",
        "category": "rag",
        "label": "Chunk Size (words)",
        "description": "How many words per document chunk. Smaller = more precise retrieval, more chunks. Larger = more context per chunk, fewer results.",
    },
    {
        "key": "rag.chunk_overlap",
        "value": "64",
        "value_type": "int",
        "category": "rag",
        "label": "Chunk Overlap (words)",
        "description": "Words shared between adjacent chunks to preserve context across boundaries. 10-15% of chunk_size is typical.",
    },
    {
        "key": "rag.top_k_results",
        "value": "5",
        "value_type": "int",
        "category": "rag",
        "label": "Top-K Retrieval Results",
        "description": "How many chunks to retrieve per query. More = more context for the LLM but slower and uses more tokens.",
    },
    {
        "key": "rag.dataset_pairs_per_chunk",
        "value": "3",
        "value_type": "int",
        "category": "rag",
        "label": "Default Q&A Pairs per Chunk",
        "description": "Default number of Q&A pairs to generate per KB chunk during dataset creation. 2-5 recommended.",
    },

    # ── Ollama ─────────────────────────────────────────────────────────────────
    {
        "key": "ollama.default_chat_model",
        "value": "",
        "value_type": "string",
        "category": "ollama",
        "label": "Default Chat Model",
        "description": "Pre-selected model in chat interfaces. Leave empty to always prompt. Example: llama3.1:8b",
    },
    {
        "key": "ollama.request_timeout_seconds",
        "value": "120",
        "value_type": "int",
        "category": "ollama",
        "label": "Ollama Request Timeout (s)",
        "description": "Seconds to wait for Ollama responses before timing out. Increase for large models or slow hardware.",
    },
    {
        "key": "ollama.embed_timeout_seconds",
        "value": "60",
        "value_type": "int",
        "category": "ollama",
        "label": "Embed Request Timeout (s)",
        "description": "Seconds to wait for embedding requests. Usually faster than chat — 60s is generous.",
    },

    # ── General ────────────────────────────────────────────────────────────────
    {
        "key": "general.instance_name",
        "value": "KRONOS",
        "value_type": "string",
        "category": "general",
        "label": "Instance Name",
        "description": "Display name for this KRONOS instance. Shown in the sidebar.",
    },
    {
        "key": "general.log_level",
        "value": "INFO",
        "value_type": "string",
        "category": "general",
        "label": "Log Level",
        "description": "Logging verbosity. DEBUG = verbose (slow), INFO = normal, WARNING = quiet, ERROR = errors only.",
    },
    {
        "key": "general.require_approval_for_pull",
        "value": "true",
        "value_type": "bool",
        "category": "general",
        "label": "Require Approval: Model Pull",
        "description": "Require owner approval before pulling new Ollama models. Recommended: true",
    },
    {
        "key": "general.require_approval_for_deploy",
        "value": "true",
        "value_type": "bool",
        "category": "general",
        "label": "Require Approval: Agent Deploy",
        "description": "Require owner approval before deploying agents. Recommended: true",
    },
    {
        "key": "general.require_approval_for_finetune",
        "value": "true",
        "value_type": "bool",
        "category": "general",
        "label": "Require Approval: Fine-tune Launch",
        "description": "Require owner approval before launching fine-tune training jobs. Recommended: true",
    },
]


# ── DB helpers ────────────────────────────────────────────────────────────────

def _coerce(value: str, value_type: str) -> Any:
    """Convert stored string value to the correct Python type."""
    if value is None:
        return None
    if value_type == "int":
        return int(value)
    if value_type == "bool":
        return value.lower() in ("true", "1", "yes")
    if value_type == "json":
        return json.loads(value)
    return value


async def get_setting(key: str, db: AsyncSession) -> Any:
    """Get a setting value, with type coercion. Returns default if not found."""
    result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
    row = result.scalar_one_or_none()
    if row:
        return _coerce(row.value, row.value_type)
    # Fall back to default
    default = next((d for d in DEFAULTS if d["key"] == key), None)
    if default:
        return _coerce(default["value"], default["value_type"])
    return None


async def seed_defaults(db: AsyncSession):
    """Insert default settings that don't exist yet. Called from init_db."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    for d in DEFAULTS:
        existing = await db.execute(select(SystemSettings).where(SystemSettings.key == d["key"]))
        if not existing.scalar_one_or_none():
            row = SystemSettings(**d)
            db.add(row)
    await db.commit()


# ── Schemas ───────────────────────────────────────────────────────────────────

class SettingUpdate(BaseModel):
    value: str


class BulkUpdate(BaseModel):
    settings: Dict[str, str]   # key → value (all strings, coerced on read)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/")
async def get_all_settings(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_owner)):
    """Return all settings grouped by category."""
    result = await db.execute(select(SystemSettings))
    rows = {r.key: r for r in result.scalars().all()}

    # Merge with defaults so UI always sees every setting even if DB row is missing
    output = {}
    for d in DEFAULTS:
        row = rows.get(d["key"])
        entry = {
            "key": d["key"],
            "value": row.value if row else d["value"],
            "value_type": d["value_type"],
            "category": d["category"],
            "label": d["label"],
            "description": d["description"],
        }
        cat = d["category"]
        if cat not in output:
            output[cat] = []
        output[cat].append(entry)

    return {"categories": output}


@router.get("/{key:path}")
async def get_setting_by_key(
    key: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
    row = result.scalar_one_or_none()
    if not row:
        default = next((d for d in DEFAULTS if d["key"] == key), None)
        if not default:
            raise HTTPException(status_code=404, detail=f"Setting '{key}' not found")
        return default
    return {
        "key": row.key, "value": row.value, "value_type": row.value_type,
        "category": row.category, "label": row.label, "description": row.description,
    }


@router.put("/{key:path}")
async def update_setting(
    key: str,
    req: SettingUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Update a single setting value."""
    result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
    row = result.scalar_one_or_none()

    if row:
        row.value = req.value
    else:
        # Create from default definition
        default = next((d for d in DEFAULTS if d["key"] == key), None)
        if not default:
            raise HTTPException(status_code=404, detail=f"Unknown setting key: {key}")
        row = SystemSettings(**{**default, "value": req.value})
        db.add(row)

    await db.commit()
    return {"key": key, "value": req.value, "updated": True}


@router.post("/bulk")
async def bulk_update_settings(
    req: BulkUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Update multiple settings at once."""
    updated = []
    for key, value in req.settings.items():
        result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
        row = result.scalar_one_or_none()
        if row:
            row.value = value
            updated.append(key)
        else:
            default = next((d for d in DEFAULTS if d["key"] == key), None)
            if default:
                db.add(SystemSettings(**{**default, "value": value}))
                updated.append(key)
    await db.commit()
    return {"updated": updated, "count": len(updated)}


@router.post("/reset")
async def reset_to_defaults(
    category: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Reset settings to defaults. Optionally scope to a category."""
    from sqlalchemy import delete
    defaults_to_reset = [d for d in DEFAULTS if not category or d["category"] == category]

    for d in defaults_to_reset:
        result = await db.execute(select(SystemSettings).where(SystemSettings.key == d["key"]))
        row = result.scalar_one_or_none()
        if row:
            row.value = d["value"]

    await db.commit()
    return {"reset": len(defaults_to_reset), "category": category or "all"}
