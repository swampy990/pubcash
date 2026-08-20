from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.constants import compute_breakdown_total
from app.database import get_db
from app.deps import get_current_user
from app.models import (
    Till,
    TillSession,
    TillSessionStatus,
    SafeTransaction,
    SafeTransactionType,
    User,
    UserRole,
)
from app.schemas import TillSessionOpenRequest, TillSessionCloseRequest, TillSessionOut

router = APIRouter(prefix="/till-sessions", tags=["till-sessions"])


@router.get("", response_model=list[TillSessionOut])
def list_till_sessions(
    till_id: UUID | None = None,
    status_filter: TillSessionStatus | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(TillSession)
    # Staff can only see sessions they personally opened; admins see everything.
    if current_user.role != UserRole.admin:
        query = query.filter(TillSession.opened_by_id == current_user.id)
    if till_id:
        query = query.filter(TillSession.till_id == till_id)
    if status_filter:
        query = query.filter(TillSession.status == status_filter)
    return query.order_by(TillSession.opened_at.desc()).all()


def _get_session_or_404(db: Session, session_id: UUID) -> TillSession:
    session = db.query(TillSession).filter(TillSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Till session not found")
    return session


def _authorize_session_access(session: TillSession, user: User):
    if user.role != UserRole.admin and session.opened_by_id != user.id:
        raise HTTPException(status_code=403, detail="You can only access your own till sessions")


@router.get("/{session_id}", response_model=TillSessionOut)
def get_till_session(
    session_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    session = _get_session_or_404(db, session_id)
    _authorize_session_access(session, current_user)
    return session


@router.post("/open", response_model=TillSessionOut, status_code=201)
def open_till_session(
    payload: TillSessionOpenRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    till = db.query(Till).filter(Till.id == payload.till_id).first()
    if not till:
        raise HTTPException(status_code=404, detail="Till not found")

    existing_open = (
        db.query(TillSession)
        .filter(TillSession.till_id == till.id, TillSession.status == TillSessionStatus.open)
        .first()
    )
    if existing_open:
        raise HTTPException(status_code=400, detail="This till already has an open session")

    total = compute_breakdown_total(payload.opening_breakdown)
    session = TillSession(
        till_id=till.id,
        opened_by_id=current_user.id,
        opening_breakdown=payload.opening_breakdown,
        opening_counted_total=total,
        note=payload.note,
        status=TillSessionStatus.open,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/close", response_model=TillSessionOut)
def close_till_session(
    session_id: UUID,
    payload: TillSessionCloseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = _get_session_or_404(db, session_id)
    _authorize_session_access(session, current_user)

    if session.status == TillSessionStatus.closed:
        raise HTTPException(status_code=400, detail="This session is already closed")

    closing_total = compute_breakdown_total(payload.closing_breakdown)

    drops_total = (
        db.query(SafeTransaction)
        .filter(
            SafeTransaction.till_session_id == session.id,
            SafeTransaction.type == SafeTransactionType.drop,
        )
        .all()
    )
    total_dropped = sum((t.amount for t in drops_total), start=0)

    cash_sales = payload.cash_sales or 0
    expected_closing_total = session.opening_counted_total + cash_sales - total_dropped
    variance = closing_total - expected_closing_total

    session.closing_breakdown = payload.closing_breakdown
    session.closing_counted_total = closing_total
    session.cash_sales = payload.cash_sales
    session.expected_closing_total = expected_closing_total
    session.variance = variance
    session.status = TillSessionStatus.closed
    session.closed_by_id = current_user.id
    session.closed_at = datetime.utcnow()
    if payload.note:
        session.note = f"{session.note}\n{payload.note}" if session.note else payload.note

    db.commit()
    db.refresh(session)
    return session
