"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-08-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # create_type=False on each: without it, SQLAlchemy ALSO auto-creates the type as part of
    # emitting each create_table() DDL below, on top of the explicit .create() calls right
    # after this - i.e. it tries to create every type twice in one migration and the second
    # attempt fails with "already exists". Creating them explicitly (once, with checkfirst) and
    # telling the column type not to repeat that is the standard fix for this exact gotcha.
    user_role = postgresql.ENUM("admin", "staff", name="user_role", create_type=False)
    user_status = postgresql.ENUM("pending", "active", "suspended", name="user_status", create_type=False)
    till_session_status = postgresql.ENUM("open", "closed", name="till_session_status", create_type=False)
    safe_transaction_type = postgresql.ENUM(
        "drop", "withdrawal", "adjustment", name="safe_transaction_type", create_type=False
    )

    bind = op.get_bind()
    user_role.create(bind, checkfirst=True)
    user_status.create(bind, checkfirst=True)
    till_session_status.create(bind, checkfirst=True)
    safe_transaction_type.create(bind, checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("status", user_status, nullable=False),
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "tills",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False, unique=True),
        sa.Column("standard_float", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "till_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("till_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tills.id"), nullable=False),
        sa.Column("status", till_session_status, nullable=False),
        sa.Column("opened_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("opening_breakdown", sa.JSON(), nullable=False),
        sa.Column("opening_counted_total", sa.Numeric(10, 2), nullable=False),
        sa.Column("closed_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closing_breakdown", sa.JSON(), nullable=True),
        sa.Column("closing_counted_total", sa.Numeric(10, 2), nullable=True),
        sa.Column("cash_sales", sa.Numeric(10, 2), nullable=True),
        sa.Column("expected_closing_total", sa.Numeric(10, 2), nullable=True),
        sa.Column("variance", sa.Numeric(10, 2), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
    )

    op.create_table(
        "safe_transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("type", safe_transaction_type, nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("breakdown", sa.JSON(), nullable=True),
        sa.Column("till_session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("till_sessions.id"), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("safe_transactions")
    op.drop_table("till_sessions")
    op.drop_table("tills")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")

    bind = op.get_bind()
    postgresql.ENUM(name="safe_transaction_type").drop(bind, checkfirst=True)
    postgresql.ENUM(name="till_session_status").drop(bind, checkfirst=True)
    postgresql.ENUM(name="user_status").drop(bind, checkfirst=True)
    postgresql.ENUM(name="user_role").drop(bind, checkfirst=True)
