import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Column,
    String,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    Text,
    JSON,
    Boolean,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


def gen_uuid():
    return uuid.uuid4()


class UserRole(str, enum.Enum):
    admin = "admin"
    staff = "staff"


class UserStatus(str, enum.Enum):
    pending = "pending"   # registered, awaiting admin approval
    active = "active"     # approved, can log in
    suspended = "suspended"  # temporarily blocked by admin


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(Enum(UserRole, name="user_role"), nullable=False, default=UserRole.staff)
    status = Column(Enum(UserStatus, name="user_status"), nullable=False, default=UserStatus.pending)

    # Forces the user to set a new password on next login (used after an admin-triggered reset)
    must_change_password = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    approved_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    approved_by = relationship("User", remote_side=[id])

    def __repr__(self):
        return f"<User {self.username} role={self.role} status={self.status}>"


class Till(Base):
    __tablename__ = "tills"

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    name = Column(String(64), unique=True, nullable=False)
    standard_float = Column(Numeric(10, 2), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    sessions = relationship("TillSession", back_populates="till")


class TillSessionStatus(str, enum.Enum):
    open = "open"
    closed = "closed"


class TillSession(Base):
    __tablename__ = "till_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    till_id = Column(UUID(as_uuid=True), ForeignKey("tills.id"), nullable=False)

    status = Column(Enum(TillSessionStatus, name="till_session_status"), nullable=False, default=TillSessionStatus.open)

    opened_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    opened_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    opening_breakdown = Column(JSON, nullable=False, default=dict)
    opening_counted_total = Column(Numeric(10, 2), nullable=False, default=0)

    closed_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    closing_breakdown = Column(JSON, nullable=True)
    closing_counted_total = Column(Numeric(10, 2), nullable=True)

    # Manual entry of cash sales recorded by the EPOS/till roll for this session (optional)
    cash_sales = Column(Numeric(10, 2), nullable=True)

    # Computed at close time: opening_counted_total + cash_sales - sum(drops during session)
    expected_closing_total = Column(Numeric(10, 2), nullable=True)
    # closing_counted_total - expected_closing_total (negative = cash missing, positive = cash over)
    variance = Column(Numeric(10, 2), nullable=True)

    note = Column(Text, nullable=True)

    till = relationship("Till", back_populates="sessions")
    opened_by = relationship("User", foreign_keys=[opened_by_id])
    closed_by = relationship("User", foreign_keys=[closed_by_id])
    safe_transactions = relationship("SafeTransaction", back_populates="till_session")


class SafeTransactionType(str, enum.Enum):
    drop = "drop"               # cash moved from a till into the safe
    withdrawal = "withdrawal"   # cash taken out of the safe (e.g. banked, paid out)
    adjustment = "adjustment"   # manual correction, can be positive or negative


class SafeTransaction(Base):
    __tablename__ = "safe_transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    type = Column(Enum(SafeTransactionType, name="safe_transaction_type"), nullable=False)

    # Signed amount: drops/positive adjustments are positive, withdrawals/negative adjustments are negative.
    amount = Column(Numeric(10, 2), nullable=False)
    breakdown = Column(JSON, nullable=True)

    till_session_id = Column(UUID(as_uuid=True), ForeignKey("till_sessions.id"), nullable=True)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    note = Column(Text, nullable=True)

    till_session = relationship("TillSession", back_populates="safe_transactions")
    created_by = relationship("User", foreign_keys=[created_by_id])
