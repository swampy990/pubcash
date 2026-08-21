from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.constants import compute_breakdown_total
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.models import (
    SafeDayClose,
    SafeTransaction,
    SafeTransactionType,
    TillSession,
    TillSessionStatus,
    User,
    UserRole,
)
from app.schemas import (
    SafeTransactionCreate,
    SafeTransactionOut,
    SafeBalanceOut,
    SafeDayCloseRequest,
    SafeDayCloseOut,
)

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


@router.post("/close-business-day", response_model=SafeDayCloseOut, status_code=201)
def close_business_day(
    payload: SafeDayCloseRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    # Every till must be closed AND its cash imported into the safe before the day can be closed -
    # otherwise the safe count below would be reconciled against a ledger that doesn't yet reflect
    # cash that's sitting in a till drawer or on someone's counting tray.
    open_sessions = db.query(TillSession).filter(TillSession.status == TillSessionStatus.open).count()
    if open_sessions:
        raise HTTPException(
            status_code=400,
            detail=f"{open_sessions} till session(s) are still open - close them before closing the business day",
        )

    unimported = (
        db.query(TillSession)
        .filter(TillSession.status == TillSessionStatus.closed, TillSession.imported_to_safe == False)  # noqa: E712
        .count()
    )
    if unimported:
        raise HTTPException(
            status_code=400,
            detail=f"{unimported} closed till session(s) haven't been imported to the safe yet",
        )

    expected_balance = _current_balance(db)
    counted_total = compute_breakdown_total(payload.counted_breakdown)
    variance = counted_total - expected_balance

    day_close = SafeDayClose(
        expected_balance=expected_balance,
        counted_breakdown=payload.counted_breakdown,
        counted_total=counted_total,
        variance=variance,
        closed_by_id=admin.id,
        note=payload.note,
    )
    db.add(day_close)
    db.commit()
    db.refresh(day_close)
    return day_close


@router.get("/day-closes", response_model=list[SafeDayCloseOut])
def list_day_closes(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    return db.query(SafeDayClose).order_by(SafeDayClose.closed_at.desc()).limit(60).all()


