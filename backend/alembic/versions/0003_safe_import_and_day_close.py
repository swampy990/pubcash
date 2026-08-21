"""till_sessions import-to-safe tracking, safe_transactions.is_automatic, safe_day_closes table

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "till_sessions",
        sa.Column("imported_to_safe", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("till_sessions", sa.Column("imported_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "till_sessions",
        sa.Column("imported_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )

    op.add_column(
        "safe_transactions",
        sa.Column("is_automatic", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "safe_day_closes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("expected_balance", sa.Numeric(10, 2), nullable=False),
        sa.Column("counted_breakdown", sa.JSON(), nullable=False),
        sa.Column("counted_total", sa.Numeric(10, 2), nullable=False),
        sa.Column("variance", sa.Numeric(10, 2), nullable=False),
        sa.Column("closed_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("safe_day_closes")
    op.drop_column("safe_transactions", "is_automatic")
    op.drop_column("till_sessions", "imported_by_id")
    op.drop_column("till_sessions", "imported_at")
    op.drop_column("till_sessions", "imported_to_safe")
