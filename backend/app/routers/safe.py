from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import (
    SafeTransaction,
    SafeTransactionType,
    TillSession,
    User,
    UserRole,
)
from app.schemas import SafeTransactionCreate, SafeTransactionOut, SafeBalanceOut

router = APIRouter(prefix="/safe", tags=["safe"])


def _current_balance(db: Session):
    total = db.query(func.coalesce(func.sum(SafeTransaction.amount), 0)).scalar()
    return total or 0


@router.get("/balance", response_model=SafeBalanceOut)
def get_balance(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Balance is a facility-wide aggregate figure (not tied to any one user's records), so it's
    # visible to any authenticated, active user - staff need it to sanity-check drops.
    return SafeBalanceOut(balance=_current_balance(db), as_of=datetime.utcnow())


@router.get("/transactions", response_model=list[SafeTransactionOut])
def list_transactions(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    query = db.query(SafeTransaction)
    if current_user.role != UserRole.admin:
        query = query.filter(SafeTransaction.created_by_id == current_user.id)
    return query.order_by(SafeTransaction.created_at.desc()).all()


@router.post("/transactions", response_model=SafeTransactionOut, status_code=201)
def create_transaction(
    payload: SafeTransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.till_session_id:
        session = db.query(TillSession).filter(TillSession.id == payload.till_session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="Till session not found")
        if current_user.role != UserRole.admin and session.opened_by_id != current_user.id:
            raise HTTPException(status_code=403, detail="You can only log drops against your own till session")

    if payload.type == SafeTransactionType.drop:
        signed_amount = abs(payload.amount)
    elif payload.type == SafeTransactionType.withdrawal:
        signed_amount = -abs(payload.amount)
    else:  # adjustment - already signed by the caller
        signed_amount = payload.amount

    # Only admins can withdraw from the safe (e.g. banking cash) or make manual adjustments;
    # staff can log drops from their till into the safe.
    if payload.type in (SafeTransactionType.withdrawal, SafeTransactionType.adjustment):
        if current_user.role != UserRole.admin:
            raise HTTPException(status_code=403, detail="Only an admin can withdraw from or adjust the safe")

    txn = SafeTransaction(
        type=payload.type,
        amount=signed_amount,
        breakdown=payload.breakdown,
        till_session_id=payload.till_session_id,
        created_by_id=current_user.id,
        note=payload.note,
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return txn
