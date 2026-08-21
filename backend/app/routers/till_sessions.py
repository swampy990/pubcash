from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.constants import compute_breakdown_total
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.models import (
    Till,
    TillSession,
    TillSessionStatus,
    SafeTransaction,
    SafeTransactionType,
    User,
    UserRole,
)
from app.schemas import (
    TillSessionOpenRequest,
    TillSessionCloseRequest,
    TillSessionReopenRequest,
    TillSessionCancelRequest,
    TillSessionOut,
)

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
    db.flush()  # assigns session.id, needed for the safe transaction below

    if total > 0:
        # Opening a till draws its float from the safe, so record that automatically rather than
        # relying on someone to remember to log it by hand. Flagged is_automatic so the safe page
        # can distinguish it from a manual entry, and so cancelling this session can find and
        # reverse this specific transaction later without touching any manual drops.
        db.add(
            SafeTransaction(
                type=SafeTransactionType.withdrawal,
                amount=-total,
                till_session_id=session.id,
                created_by_id=current_user.id,
                note=f"Float issued to till '{till.name}' on session open",
                is_automatic=True,
            )
        )

    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/reopen", response_model=TillSessionOut)
def reopen_till_session(
    session_id: UUID,
    payload: TillSessionReopenRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    session = _get_session_or_404(db, session_id)

    if session.status != TillSessionStatus.closed:
        raise HTTPException(status_code=400, detail="Only a closed session can be reopened")

    other_open = (
        db.query(TillSession)
        .filter(
            TillSession.till_id == session.till_id,
            TillSession.status == TillSessionStatus.open,
            TillSession.id != session.id,
        )
        .first()
    )
    if other_open:
        raise HTTPException(
            status_code=400,
            detail="This till already has a different open session - close that one first",
        )

    # Keep an audit trail of what the close was before it gets edited, since this is undoing a
    # recorded cash count - even though (unlike an earlier version of this endpoint) we no
    # longer clear the count itself, whatever gets submitted on the next close will overwrite it.
    audit_line = (
        f"[Reopened by {admin.username} at {datetime.utcnow().isoformat()}Z] "
        f"Previous close: counted £{session.closing_counted_total}, "
        f"cash sales £{session.cash_sales}, expected £{session.expected_closing_total}, "
        f"variance £{session.variance}."
    )
    if payload.reason:
        audit_line += f" Reason given: {payload.reason}"
    session.note = f"{session.note}\n{audit_line}" if session.note else audit_line

    # Deliberately NOT clearing closing_breakdown / closing_counted_total / cash_sales /
    # expected_closing_total / variance here - the whole point of reopening is to let the
    # previous count be corrected rather than recounted from scratch. The frontend pre-fills
    # the close form from these values, and closing the session again overwrites all of them
    # with whatever's submitted then, so leaving stale numbers here in the meantime is harmless.
    session.status = TillSessionStatus.open
    session.closed_by_id = None
    session.closed_at = None

    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/cancel", response_model=TillSessionOut)
def cancel_till_session(
    session_id: UUID,
    payload: TillSessionCancelRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = _get_session_or_404(db, session_id)
    _authorize_session_access(session, current_user)

    if session.status != TillSessionStatus.open:
        raise HTTPException(status_code=400, detail="Only an open session can be cancelled")

    # Reverse the automatic float withdrawal this session created on open, but leave any manual
    # drops made during the session alone - cash that actually moved into the safe is real and
    # shouldn't vanish just because the till session itself is being abandoned.
    auto_withdrawal = (
        db.query(SafeTransaction)
        .filter(
            SafeTransaction.till_session_id == session.id,
            SafeTransaction.type == SafeTransactionType.withdrawal,
            SafeTransaction.is_automatic == True,  # noqa: E712
        )
        .first()
    )
    if auto_withdrawal:
        db.delete(auto_withdrawal)

    audit_line = f"[Cancelled by {current_user.username} at {datetime.utcnow().isoformat()}Z]"
    if payload.reason:
        audit_line += f" Reason given: {payload.reason}"
    session.note = f"{session.note}\n{audit_line}" if session.note else audit_line
    session.status = TillSessionStatus.cancelled

    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/import-to-safe", response_model=TillSessionOut)
def import_till_session_to_safe(
    session_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    session = _get_session_or_404(db, session_id)

    if session.status != TillSessionStatus.closed:
        raise HTTPException(status_code=400, detail="Only a closed session can be imported to the safe")
    if session.imported_to_safe:
        raise HTTPException(status_code=400, detail="This session's cash has already been imported to the safe")

    till = db.query(Till).filter(Till.id == session.till_id).first()
    till_name = till.name if till else "unknown till"

    if session.closing_counted_total and session.closing_counted_total > 0:
        db.add(
            SafeTransaction(
                type=SafeTransactionType.drop,
                amount=session.closing_counted_total,
                breakdown=session.closing_breakdown,
                till_session_id=session.id,
                created_by_id=admin.id,
                note=f"Closing cash imported from till '{till_name}'",
                is_automatic=True,
            )
        )

    session.imported_to_safe = True
    session.imported_at = datetime.utcnow()
    session.imported_by_id = admin.id

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

    if session.status != TillSessionStatus.open:
        raise HTTPException(
            status_code=400,
            detail=f"Only an open session can be closed (this one is {session.status.value})",
        )

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
