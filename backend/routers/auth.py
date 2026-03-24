"""
Guardrail: single-owner JWT auth.
Every sensitive action must pass through this.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
import bcrypt as _bcrypt
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from core.config import settings
from core.database import get_db, ApprovalRequest

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")


# ── Schemas ───────────────────────────────────────────────────────────────────

class Token(BaseModel):
    access_token: str
    token_type: str


class ApprovalAction(BaseModel):
    request_id: str
    approved: bool
    note: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def verify_password(plain: str, hashed: str) -> bool:
    import logging, os
    log = logging.getLogger("kronos.auth")
    # Read directly from os.environ to get the raw value after Docker's $$ -> $ unescape
    # Do NOT rely on pydantic-settings which may re-interpolate $ sequences
    raw_hash = os.environ.get("OWNER_PASSWORD_HASH", hashed)
    if not raw_hash:
        log.error("OWNER_PASSWORD_HASH is empty - check secrets.env")
        return False
    try:
        result = _bcrypt.checkpw(plain.encode(), raw_hash.encode())
        log.info(f"verify_password: result={result}")
        return result
    except Exception as e:
        log.error(f"verify_password error: {e}")
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


async def get_current_owner(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str = payload.get("sub")
        if username != settings.OWNER_USERNAME:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    return username


async def create_approval_request(
    action_type: str,
    payload: dict,
    db: AsyncSession,
) -> ApprovalRequest:
    """
    Create a pending approval request.
    The owner must approve via /api/auth/approve before the action executes.
    """
    req = ApprovalRequest(
        action_type=action_type,
        payload=payload,
        requested_by="system",
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/token", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    if form_data.username != settings.OWNER_USERNAME:
        raise HTTPException(status_code=400, detail="Incorrect credentials")
    if not verify_password(form_data.password, settings.OWNER_PASSWORD_HASH):
        raise HTTPException(status_code=400, detail="Incorrect credentials")
    token = create_access_token({"sub": form_data.username})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/approvals")
async def list_pending_approvals(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(
        select(ApprovalRequest).where(ApprovalRequest.status == "pending")
        .order_by(ApprovalRequest.created_at.desc())
    )
    return result.scalars().all()


@router.post("/approve")
async def resolve_approval(
    action: ApprovalAction,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(
        select(ApprovalRequest).where(ApprovalRequest.id == action.request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Approval request not found")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {req.status}")

    await db.execute(
        update(ApprovalRequest)
        .where(ApprovalRequest.id == action.request_id)
        .values(
            status="approved" if action.approved else "rejected",
            owner_note=action.note,
            resolved_at=datetime.utcnow(),
        )
    )
    await db.commit()
    return {"status": "approved" if action.approved else "rejected", "id": action.request_id}
