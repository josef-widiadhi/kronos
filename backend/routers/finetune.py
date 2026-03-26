"""
KRONOS Fine-Tune Module
========================
Unsloth Studio-inspired features integrated into KRONOS:

1. Dataset Builder   — convert KB collections / uploaded files into Q&A training datasets
                       using the local LLM (no GPU needed for this step)
2. Fine-tune Runner  — launch Unsloth LoRA/QLoRA training in a Docker container
                       (needs NVIDIA GPU for speed; CPU fallback available but slow)
3. GGUF Export       — convert a trained LoRA adapter → merged GGUF → import into Ollama
4. Training Jobs     — track status, logs, metrics for all fine-tune runs
"""

import os
import uuid
import json
import asyncio
import logging
import tempfile
from typing import Optional, List, Dict, Any
from datetime import datetime
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from core.config import settings
from core.database import get_db, KBCollection, Dataset, FineTuneJob
from routers.auth import get_current_owner, create_approval_request
from routers.rag import embed_texts, chunk_text, get_chroma

router = APIRouter()
logger = logging.getLogger("kronos.finetune")



# ── Q&A Generation ──────────────────────────────────────────────────────────────

DATASET_FORMATS = {
    "alpaca": {
        "description": "Instruction-following format (best for most tasks)",
        "example": {"instruction": "What is X?", "input": "", "output": "X is..."},
    },
    "chatml": {
        "description": "Multi-turn chat format (best for conversation agents)",
        "example": {"messages": [{"role": "user", "content": "What is X?"}, {"role": "assistant", "content": "X is..."}]},
    },
    "sharegpt": {
        "description": "ShareGPT conversation format (compatible with most trainers)",
        "example": {"conversations": [{"from": "human", "value": "What is X?"}, {"from": "gpt", "value": "X is..."}]},
    },
}

GENERATION_PROMPTS = {
    "general": """Given the following text passage, generate {n} high-quality question-answer pairs for training an AI assistant.

The questions should:
- Ask about specific facts, concepts, or procedures in the passage
- Vary in type: factual, "how to", "what is", "explain", "list", "compare"
- Be realistic questions a user would ask

The answers should:
- Be accurate, complete, and grounded in the passage
- Not include phrases like "based on the passage" or "according to the text"
- Sound like a knowledgeable expert answering naturally

Passage:
{text}

Return ONLY valid JSON array, no other text:
[{{"question": "...", "answer": "..."}}, ...]

Generate exactly {n} pairs:""",

    "pentest": """Given the following penetration testing / security text, generate {n} training question-answer pairs.

Focus on:
- Tool usage: specific flags, arguments, parameters
- Attack techniques and when to use them
- Step-by-step procedures
- Troubleshooting common issues
- Real command examples with explanations

Text:
{text}

Return ONLY valid JSON array:
[{{"question": "...", "answer": "..."}}, ...]

Generate exactly {n} pairs:""",

    "technical": """Given the following technical documentation, generate {n} training question-answer pairs.

Include:
- How-to questions with step-by-step answers
- Configuration and parameter questions
- Troubleshooting scenarios
- Best practices and recommendations
- Specific command/code examples

Text:
{text}

Return ONLY valid JSON array:
[{{"question": "...", "answer": "..."}}, ...]

Generate exactly {n} pairs:""",
}


async def generate_qa_from_text(
    text: str,
    model: str,
    n_pairs: int = 5,
    prompt_type: str = "general",
    system_prompt: str = "",
) -> List[Dict]:
    """Use local Ollama to generate Q&A pairs from a text chunk."""
    prompt_template = GENERATION_PROMPTS.get(prompt_type, GENERATION_PROMPTS["general"])
    prompt = prompt_template.format(text=text[:3000], n=n_pairs)

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/chat",
                json={"model": model, "messages": messages, "stream": False,
                      "options": {"temperature": 0.7}},
            )
            r.raise_for_status()
            content = r.json()["message"]["content"]

        # Parse JSON from response
        import re
        # Find JSON array in response
        match = re.search(r'\[.*\]', content, re.DOTALL)
        if not match:
            return []
        pairs = json.loads(match.group())
        return [p for p in pairs if isinstance(p, dict) and "question" in p and "answer" in p]
    except Exception as e:
        logger.warning(f"Q&A generation failed for chunk: {e}")
        return []


def format_pair(pair: Dict, fmt: str, system_prompt: str = "") -> Dict:
    """Convert a Q&A pair to the target training format."""
    q, a = pair.get("question", ""), pair.get("answer", "")
    if fmt == "alpaca":
        return {"instruction": q, "input": "", "output": a,
                "system": system_prompt}
    elif fmt == "chatml":
        msgs = []
        if system_prompt:
            msgs.append({"role": "system", "content": system_prompt})
        msgs.extend([{"role": "user", "content": q}, {"role": "assistant", "content": a}])
        return {"messages": msgs}
    elif fmt == "sharegpt":
        convs = []
        if system_prompt:
            convs.append({"from": "system", "value": system_prompt})
        convs.extend([{"from": "human", "value": q}, {"from": "gpt", "value": a}])
        return {"conversations": convs}
    return {"instruction": q, "output": a}


# ── Background: Generate dataset from KB ───────────────────────────────────────

DATASETS_DIR = "/app/datasets"


async def _generate_dataset_from_kb(
    dataset_id: str,
    kb_collection_id: str,
    model: str,
    pairs_per_chunk: int,
    prompt_type: str,
    fmt: str,
    system_prompt: str,
    db: AsyncSession,
):
    """Background task: pull chunks from KB, generate Q&A, write JSONL."""
    os.makedirs(DATASETS_DIR, exist_ok=True)
    output_path = os.path.join(DATASETS_DIR, f"{dataset_id}.jsonl")

    await db.execute(update(Dataset).where(Dataset.id == dataset_id).values(status="generating"))
    await db.commit()

    try:
        # Get all chunks from ChromaDB
        result = await db.execute(select(KBCollection).where(KBCollection.id == kb_collection_id))
        kb = result.scalar_one_or_none()
        if not kb:
            raise ValueError(f"KB collection {kb_collection_id} not found")

        chroma = get_chroma()
        collection = chroma.get_or_create_collection(kb.chroma_collection)
        total = collection.count()

        if total == 0:
            raise ValueError("KB collection is empty — ingest documents first")

        # Fetch chunks in batches
        all_rows = []
        batch_size = 50
        offset = 0
        total_pairs = 0

        with open(output_path, "w") as f:
            while offset < total:
                batch = collection.get(
                    limit=batch_size,
                    offset=offset,
                    include=["documents"],
                )
                for doc in batch.get("documents", []):
                    if not doc or len(doc.strip()) < 100:
                        continue
                    pairs = await generate_qa_from_text(
                        doc, model, pairs_per_chunk, prompt_type, system_prompt
                    )
                    for pair in pairs:
                        formatted = format_pair(pair, fmt, system_prompt)
                        f.write(json.dumps(formatted) + "\n")
                        total_pairs += 1
                    await asyncio.sleep(0.1)  # gentle on Ollama
                offset += batch_size

        await db.execute(
            update(Dataset).where(Dataset.id == dataset_id).values(
                status="ready",
                row_count=total_pairs,
                file_path=output_path,
                model_used=model,
            )
        )
        await db.commit()
        logger.info(f"Dataset {dataset_id}: {total_pairs} pairs generated from {total} chunks")

    except Exception as e:
        logger.error(f"Dataset generation failed: {e}")
        await db.execute(
            update(Dataset).where(Dataset.id == dataset_id).values(
                status="error",
                config={"error": str(e)},
            )
        )
        await db.commit()


# ── Schemas ────────────────────────────────────────────────────────────────────

class DatasetCreate(BaseModel):
    name: str
    description: Optional[str] = None
    source_type: str = "kb_collection"
    source_id: Optional[str] = None
    format: str = "alpaca"
    model: str
    pairs_per_chunk: int = 3
    prompt_type: str = "general"
    system_prompt: str = ""


class FineTuneJobCreate(BaseModel):
    name: str
    base_model: str
    dataset_id: str
    method: str = "lora"
    config: Optional[Dict] = None


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/formats")
async def list_formats(_: str = Depends(get_current_owner)):
    return {"formats": DATASET_FORMATS}


@router.get("/prompt-types")
async def list_prompt_types(_: str = Depends(get_current_owner)):
    return {"types": list(GENERATION_PROMPTS.keys())}


# ── Dataset routes ─────────────────────────────────────────────────────────────

@router.get("/datasets")
async def list_datasets(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_owner)):
    result = await db.execute(select(Dataset).order_by(Dataset.created_at.desc()))
    return result.scalars().all()


@router.post("/datasets")
async def create_dataset(
    req: DatasetCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Create a dataset and start background Q&A generation from a KB collection."""
    if req.source_type == "kb_collection":
        if not req.source_id:
            raise HTTPException(status_code=400, detail="source_id required for kb_collection source")
        kb_result = await db.execute(select(KBCollection).where(KBCollection.id == req.source_id))
        if not kb_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="KB Collection not found")

    ds = Dataset(
        name=req.name,
        description=req.description,
        source_type=req.source_type,
        source_id=req.source_id,
        format=req.format,
        model_used=req.model,
        status="queued",
        config={
            "pairs_per_chunk": req.pairs_per_chunk,
            "prompt_type": req.prompt_type,
            "system_prompt": req.system_prompt,
        },
    )
    db.add(ds)
    await db.commit()
    await db.refresh(ds)

    if req.source_type == "kb_collection":
        background_tasks.add_task(
            _generate_dataset_from_kb,
            dataset_id=ds.id,
            kb_collection_id=req.source_id,
            model=req.model,
            pairs_per_chunk=req.pairs_per_chunk,
            prompt_type=req.prompt_type,
            fmt=req.format,
            system_prompt=req.system_prompt,
            db=db,
        )

    return ds


@router.get("/datasets/{dataset_id}")
async def get_dataset(dataset_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_owner)):
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return ds


@router.get("/datasets/{dataset_id}/preview")
async def preview_dataset(dataset_id: str, limit: int = 10, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_owner)):
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    ds = result.scalar_one_or_none()
    if not ds or not ds.file_path or not os.path.exists(ds.file_path):
        raise HTTPException(status_code=404, detail="Dataset file not found")
    rows = []
    with open(ds.file_path) as f:
        for i, line in enumerate(f):
            if i >= limit:
                break
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    return {"rows": rows, "total": ds.row_count, "format": ds.format, "showing": len(rows)}


@router.delete("/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_owner)):
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if ds.file_path and os.path.exists(ds.file_path):
        os.remove(ds.file_path)
    await db.delete(ds)
    await db.commit()
    return {"deleted": dataset_id}


# ── Fine-tune job routes ────────────────────────────────────────────────────────

@router.get("/jobs")
async def list_jobs(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_owner)):
    result = await db.execute(select(FineTuneJob).order_by(FineTuneJob.created_at.desc()))
    return result.scalars().all()


@router.post("/jobs")
async def create_job(
    req: FineTuneJobCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Queue a fine-tuning job for approval before it launches."""
    ds_result = await db.execute(select(Dataset).where(Dataset.id == req.dataset_id))
    ds = ds_result.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if ds.status != "ready":
        raise HTTPException(status_code=400, detail=f"Dataset status is '{ds.status}' — must be 'ready'")

    default_config = {
        "max_seq_length": 2048,
        "lora_r": 16,
        "lora_alpha": 16,
        "lora_dropout": 0.05,
        "learning_rate": 2e-4,
        "num_epochs": 3,
        "batch_size": 2,
        "gradient_accumulation_steps": 4,
        "warmup_steps": 5,
        "save_steps": 50,
        "use_4bit": True,
        "use_gradient_checkpointing": True,
    }
    config = {**default_config, **(req.config or {})}

    approval = await create_approval_request(
        action_type="finetune_job",
        payload={
            "name": req.name,
            "base_model": req.base_model,
            "dataset_id": req.dataset_id,
            "dataset_name": ds.name,
            "dataset_rows": ds.row_count,
            "method": req.method,
            "config": config,
        },
        db=db,
    )

    job = FineTuneJob(
        name=req.name,
        base_model=req.base_model,
        dataset_id=req.dataset_id,
        method=req.method,
        status="pending_approval",
        config=config,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    return {
        "job": job,
        "approval_request_id": approval.id,
        "message": "Fine-tune job queued for owner approval",
    }


@router.post("/jobs/{job_id}/launch")
async def launch_job(
    job_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Launch an approved fine-tune job in a Docker container running Unsloth."""
    result = await db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("pending_approval", "queued"):
        raise HTTPException(status_code=400, detail=f"Job status is '{job.status}' — cannot launch")

    background_tasks.add_task(_run_finetune_job, job_id=job_id, db=db)
    await db.execute(update(FineTuneJob).where(FineTuneJob.id == job_id).values(status="launching"))
    await db.commit()
    return {"status": "launching", "job_id": job_id}


@router.get("/jobs/{job_id}/logs")
async def job_logs(job_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_owner)):
    result = await db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    docker_logs = ""
    if job.container_id:
        try:
            import docker as docker_lib
            dclient = docker_lib.from_env()
            c = dclient.containers.get(job.container_id)
            docker_logs = c.logs(tail=200, timestamps=True).decode("utf-8", errors="ignore")
        except Exception:
            docker_logs = job.log_tail or "(container not found)"

    return {
        "job_id": job_id,
        "status": job.status,
        "logs": docker_logs or job.log_tail or "(no logs yet)",
        "metrics": job.metrics,
        "error": job.error_message,
    }


@router.post("/jobs/{job_id}/export-gguf")
async def export_gguf(
    job_id: str,
    quantization: str = "q4_k_m",
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Export a completed fine-tune job's adapter to GGUF format."""
    result = await db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "done":
        raise HTTPException(status_code=400, detail=f"Job must be 'done' to export. Current: '{job.status}'")
    if not job.output_path:
        raise HTTPException(status_code=400, detail="No output path — job may not have saved adapter")

    approval = await create_approval_request(
        action_type="finetune_export_gguf",
        payload={
            "job_id": job_id,
            "job_name": job.name,
            "base_model": job.base_model,
            "output_path": job.output_path,
            "quantization": quantization,
        },
        db=db,
    )
    return {
        "message": "GGUF export queued for approval",
        "approval_request_id": approval.id,
        "quantization": quantization,
    }


@router.post("/jobs/{job_id}/import-to-ollama")
async def import_to_ollama(
    job_id: str,
    model_name: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Import a GGUF export directly into Ollama as a new model."""
    result = await db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job or not job.gguf_path:
        raise HTTPException(status_code=404, detail="Job or GGUF not found")

    # Create a Modelfile and register with Ollama
    try:
        modelfile_content = f"""FROM {job.gguf_path}
PARAMETER temperature 0.7
PARAMETER num_ctx 4096
SYSTEM "You are a specialized AI assistant fine-tuned by KRONOS."
"""
        modelfile_path = job.gguf_path.replace(".gguf", ".Modelfile")
        with open(modelfile_path, "w") as f:
            f.write(modelfile_content)

        async with httpx.AsyncClient(timeout=300) as client:
            r = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/create",
                json={"name": model_name, "modelfile": modelfile_content, "stream": False},
            )
            r.raise_for_status()

        await db.execute(
            update(FineTuneJob).where(FineTuneJob.id == job_id).values(
                ollama_imported=model_name
            )
        )
        await db.commit()
        return {"status": "imported", "ollama_model": model_name, "job": job_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {e}")


# ── Background: run fine-tune Docker job ───────────────────────────────────────

async def _run_finetune_job(job_id: str, db: AsyncSession):
    """Launch Unsloth in Docker, stream logs, save adapter."""
    import docker as docker_lib

    result = await db.execute(select(FineTuneJob).where(FineTuneJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        return

    await db.execute(
        update(FineTuneJob).where(FineTuneJob.id == job_id).values(
            status="running", started_at=datetime.utcnow()
        )
    )
    await db.commit()

    ds_result = await db.execute(select(Dataset).where(Dataset.id == job.dataset_id))
    ds = ds_result.scalar_one_or_none()

    output_dir = f"/app/finetune_outputs/{job_id}"
    os.makedirs(output_dir, exist_ok=True)

    config = job.config or {}

    # Generate training script
    train_script = f"""
import json, os
os.environ["UNSLOTH_RETURN_LOGITS"] = "1"

from unsloth import FastLanguageModel
from datasets import Dataset
from trl import SFTTrainer
from transformers import TrainingArguments

# Load model
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="{job.base_model}",
    max_seq_length={config.get("max_seq_length", 2048)},
    load_in_4bit={str(config.get("use_4bit", True))},
)

model = FastLanguageModel.get_peft_model(
    model,
    r={config.get("lora_r", 16)},
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
    lora_alpha={config.get("lora_alpha", 16)},
    lora_dropout={config.get("lora_dropout", 0.05)},
    use_gradient_checkpointing="unsloth",
)

# Load dataset
rows = []
with open("{ds.file_path}", "r") as f:
    for line in f:
        try: rows.append(json.loads(line))
        except: pass

dataset = Dataset.from_list(rows)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="instruction" if "{ds.format}" == "alpaca" else "messages",
    max_seq_length={config.get("max_seq_length", 2048)},
    args=TrainingArguments(
        per_device_train_batch_size={config.get("batch_size", 2)},
        gradient_accumulation_steps={config.get("gradient_accumulation_steps", 4)},
        warmup_steps={config.get("warmup_steps", 5)},
        num_train_epochs={config.get("num_epochs", 3)},
        learning_rate={config.get("learning_rate", 2e-4)},
        fp16=(os.environ.get("KRONOS_DEVICE","cpu") != "cpu"),
            bf16=(os.environ.get("KRONOS_DEVICE","cpu") == "cpu"),
        logging_steps=1,
        output_dir="/output",
        save_steps={config.get("save_steps", 50)},
    ),
)

trainer_stats = trainer.train()
model.save_pretrained("/output/adapter")
tokenizer.save_pretrained("/output/adapter")
print("TRAINING_COMPLETE")
print(f"LOSS: {{trainer_stats.training_loss}}")
"""

    script_path = f"{output_dir}/train.py"
    with open(script_path, "w") as f:
        f.write(train_script)

    try:
        dclient = docker_lib.from_env()

        # Use Unsloth Docker image
        # GPU: unsloth/unsloth-repo:latest
        # CPU fallback: uses standard transformers
        image = "unsloth/unsloth-repo:latest"

        # Read compute settings
        from routers.settings_router import get_setting as _get
        device      = await _get("compute.device", db) or "cpu"
        unsloth_img = await _get("compute.unsloth_image", db) or image
        batch_sz    = await _get("finetune.default_batch_size", db) or config.get("batch_size", 2)
        grad_accum  = await _get("finetune.default_grad_accum", db) or config.get("gradient_accumulation_steps", 4)

        use_gpu = device in ("cuda", "auto") or (device == "auto" and _has_nvidia_gpu())
        effective_image = unsloth_img

        logger.info(f"Fine-tune device={device} use_gpu={use_gpu} image={effective_image}")

        container = dclient.containers.run(
            effective_image,
            command="python /train/train.py",
            volumes={
                output_dir: {"bind": "/output", "mode": "rw"},
                os.path.dirname(script_path): {"bind": "/train", "mode": "ro"},
                DATASETS_DIR: {"bind": "/datasets", "mode": "ro"},
            },
            environment={
                "OLLAMA_BASE_URL": settings.OLLAMA_BASE_URL,
                "KRONOS_DEVICE": device,
                "PYTHONUNBUFFERED": "1",
            },
            detach=True,
            device_requests=[
                docker_lib.types.DeviceRequest(count=-1, capabilities=[["gpu"]])
            ] if use_gpu else [],
            name=f"kronos_finetune_{job_id[:8]}",
        )

        await db.execute(
            update(FineTuneJob).where(FineTuneJob.id == job_id).values(
                container_id=container.id
            )
        )
        await db.commit()

        # Wait and stream logs
        exit_code = container.wait()["StatusCode"]
        logs = container.logs(tail=500).decode("utf-8", errors="ignore")

        # Parse metrics from logs
        metrics = {}
        for line in logs.splitlines():
            if "LOSS:" in line:
                try:
                    metrics["final_loss"] = float(line.split("LOSS:")[-1].strip())
                except Exception:
                    pass

        if exit_code == 0 and "TRAINING_COMPLETE" in logs:
            await db.execute(
                update(FineTuneJob).where(FineTuneJob.id == job_id).values(
                    status="done",
                    output_path=f"{output_dir}/adapter",
                    log_tail=logs[-3000:],
                    metrics=metrics,
                    finished_at=datetime.utcnow(),
                )
            )
        else:
            await db.execute(
                update(FineTuneJob).where(FineTuneJob.id == job_id).values(
                    status="error",
                    log_tail=logs[-3000:],
                    error_message=f"Container exited with code {exit_code}",
                    finished_at=datetime.utcnow(),
                )
            )
        await db.commit()

    except Exception as e:
        logger.error(f"Fine-tune job {job_id} failed: {e}")
        await db.execute(
            update(FineTuneJob).where(FineTuneJob.id == job_id).values(
                status="error",
                error_message=str(e)[:500],
                finished_at=datetime.utcnow(),
            )
        )
        await db.commit()


def _has_nvidia_gpu() -> bool:
    """Check if NVIDIA GPU is available on host."""
    try:
        import subprocess
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, timeout=5
        )
        return result.returncode == 0 and result.stdout.strip()
    except Exception:
        return False
