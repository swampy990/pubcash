from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models import UserRole, UserStatus, TillSessionStatus, SafeTransactionType

DenominationBreakdown = dict[str, int]


# ---------- Auth / Users ----------

class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    invite_code: str = Field(min_length=1, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool = False


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: UUID
    username: str
    role: UserRole
    status: UserStatus
    must_change_password: bool
    created_at: datetime
    approved_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AdminResetPasswordResponse(BaseModel):
    username: str
    temporary_password: str


class UserRoleUpdateRequest(BaseModel):
    role: UserRole


# ---------- Tills ----------

class TillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    standard_float: Decimal = Field(default=Decimal("0.00"), ge=0)


class TillOut(BaseModel):
    id: UUID
    name: str
    standard_float: Decimal
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- Till Sessions ----------


def _validate_breakdown(value: DenominationBreakdown) -> DenominationBreakdown:
    for denom, count in value.items():
        if count < 0:
            raise ValueError(f"Count for denomination {denom} cannot be negative")
    return value


class TillSessionOpenRequest(BaseModel):
    till_id: UUID
    opening_breakdown: DenominationBreakdown
    note: Optional[str] = None

    @field_validator("opening_breakdown")
    @classmethod
    def check_breakdown(cls, v):
        return _validate_breakdown(v)


class TillSessionCloseRequest(BaseModel):
    closing_breakdown: DenominationBreakdown
    cash_sales: Optional[Decimal] = Field(default=None, ge=0)
    note: Optional[str] = None

    @field_validator("closing_breakdown")
    @classmethod
    def check_breakdown(cls, v):
        return _validate_breakdown(v)


class TillSessionReopenRequest(BaseModel):
    reason: Optional[str] = None


class TillSessionCancelRequest(BaseModel):
    reason: Optional[str] = None


class TillSessionOut(BaseModel):
    id: UUID
    till_id: UUID
    status: TillSessionStatus
    opened_by_id: UUID
    opened_by_username: Optional[str] = None
    opened_at: datetime
    opening_breakdown: DenominationBreakdown
    opening_counted_total: Decimal
    closed_by_id: Optional[UUID] = None
    closed_by_username: Optional[str] = None
    closed_at: Optional[datetime] = None
    closing_breakdown: Optional[DenominationBreakdown] = None
    closing_counted_total: Optional[Decimal] = None
    cash_sales: Optional[Decimal] = None
    expected_closing_total: Optional[Decimal] = None
    variance: Optional[Decimal] = None
    note: Optional[str] = None
    imported_to_safe: bool = False
    imported_at: Optional[datetime] = None
    imported_by_username: Optional[str] = None

    class Config:
        from_attributes = True


# ---------- Safe Transactions ----------

class SafeTransactionCreate(BaseModel):
    type: SafeTransactionType
    # For 'drop' and 'withdrawal', supply a positive magnitude - the sign is derived from the type.
    # For 'adjustment', supply a signed value (positive to add, negative to remove cash from the safe).
    amount: Decimal
    breakdown: Optional[DenominationBreakdown] = None
    till_session_id: Optional[UUID] = None
    note: Optional[str] = None

    @field_validator("amount")
    @classmethod
    def check_amount_nonzero(cls, v):
        if v == 0:
            raise ValueError("Amount cannot be zero")
        return v

    @field_validator("breakdown")
    @classmethod
    def check_breakdown(cls, v):
        if v is None:
            return v
        return _validate_breakdown(v)


class SafeTransactionOut(BaseModel):
    id: UUID
    type: SafeTransactionType
    amount: Decimal
    breakdown: Optional[DenominationBreakdown] = None
    till_session_id: Optional[UUID] = None
    created_by_id: UUID
    created_at: datetime
    note: Optional[str] = None
    is_automatic: bool = False

    class Config:
        from_attributes = True


class SafeBalanceOut(BaseModel):
    balance: Decimal
    as_of: datetime


# ---------- Safe Day Close ----------

class SafeDayCloseRequest(BaseModel):
    counted_breakdown: DenominationBreakdown
    note: Optional[str] = None

    @field_validator("counted_breakdown")
    @classmethod
    def check_breakdown(cls, v):
        return _validate_breakdown(v)


class SafeDayCloseOut(BaseModel):
    id: UUID
    expected_balance: Decimal
    counted_breakdown: DenominationBreakdown
    counted_total: Decimal
    variance: Decimal
    closed_by_id: UUID
    closed_at: datetime
    note: Optional[str] = None

    class Config:
        from_attributes = True


# ---------- Reports ----------

class PeriodSummaryOut(BaseModel):
    start_date: datetime
    end_date: datetime
    sessions_closed: int
    total_opening_floats: Decimal
    total_closing_counted: Decimal
    total_cash_sales: Decimal
    total_variance: Decimal
    total_safe_drops: Decimal
    total_safe_withdrawals: Decimal
    safe_balance: Decimal


class VarianceAlertOut(BaseModel):
    till_session_id: UUID
    till_name: str
    opened_by: str
    closed_by: Optional[str] = None
    closed_at: Optional[datetime] = None
    variance: Decimal
    threshold: Decimal
