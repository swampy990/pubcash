from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import require_admin
from app.models import (
    SafeTransaction,
    SafeTransactionType,
    TillSession,
    TillSessionStatus,
    User,
)
from app.schemas import PeriodSummaryOut, VarianceAlertOut

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/summary", response_model=PeriodSummaryOut)
def period_summary(
    start_date: datetime = Query(default=None, description="Defaults to 7 days ago"),
    end_date: datetime = Query(default=None, description="Defaults to now"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    end_date = end_date or datetime.utcnow()
    start_date = start_date or (end_date - timedelta(days=7))

    sessions = (
        db.query(TillSession)
        .filter(
            TillSession.status == TillSessionStatus.closed,
            TillSession.closed_at >= start_date,
            TillSession.closed_at <= end_date,
        )
        .all()
    )

    total_opening = sum((s.opening_counted_total for s in sessions), start=Decimal("0"))
    total_closing = sum((s.closing_counted_total or 0 for s in sessions), start=Decimal("0"))
    total_cash_sales = sum((s.cash_sales or 0 for s in sessions), start=Decimal("0"))
    total_variance = sum((s.variance or 0 for s in sessions), start=Decimal("0"))

    drops = (
        db.query(func.coalesce(func.sum(SafeTransaction.amount), 0))
        .filter(
            SafeTransaction.type == SafeTransactionType.drop,
            SafeTransaction.created_at >= start_date,
            SafeTransaction.created_at <= end_date,
        )
        .scalar()
        or 0
    )
    withdrawals = (
        db.query(func.coalesce(func.sum(SafeTransaction.amount), 0))
        .filter(
            SafeTransaction.type == SafeTransactionType.withdrawal,
            SafeTransaction.created_at >= start_date,
            SafeTransaction.created_at <= end_date,
        )
        .scalar()
        or 0
    )
    safe_balance = db.query(func.coalesce(func.sum(SafeTransaction.amount), 0)).scalar() or 0

    return PeriodSummaryOut(
        start_date=start_date,
        end_date=end_date,
        sessions_closed=len(sessions),
        total_opening_floats=total_opening,
        total_closing_counted=total_closing,
        total_cash_sales=total_cash_sales,
        total_variance=total_variance,
        total_safe_drops=drops,
        total_safe_withdrawals=abs(withdrawals),
        safe_balance=safe_balance,
    )


@router.get("/variance-alerts", response_model=list[VarianceAlertOut])
def variance_alerts(
    threshold: float | None = Query(default=None, description="Defaults to configured threshold"),
    start_date: datetime = Query(default=None),
    end_date: datetime = Query(default=None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    effective_threshold = Decimal(str(threshold)) if threshold is not None else Decimal(str(settings.variance_alert_threshold))
    end_date = end_date or datetime.utcnow()
    start_date = start_date or (end_date - timedelta(days=30))

    sessions = (
        db.query(TillSession)
        .filter(
            TillSession.status == TillSessionStatus.closed,
            TillSession.closed_at >= start_date,
            TillSession.closed_at <= end_date,
            TillSession.variance.isnot(None),
        )
        .all()
    )

    alerts = []
    for s in sessions:
        if s.variance is not None and abs(s.variance) >= effective_threshold:
            alerts.append(
                VarianceAlertOut(
                    till_session_id=s.id,
                    till_name=s.till.name,
                    opened_by=s.opened_by.username,
                    closed_by=s.closed_by.username if s.closed_by else None,
                    closed_at=s.closed_at,
                    variance=s.variance,
                    threshold=effective_threshold,
                )
            )
    alerts.sort(key=lambda a: abs(a.variance), reverse=True)
    return alerts
