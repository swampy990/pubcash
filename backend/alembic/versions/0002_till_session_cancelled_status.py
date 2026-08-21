"""add 'cancelled' value to till_session_status enum

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-21

This is deliberately its OWN migration, doing nothing else. Postgres requires
ALTER TYPE ... ADD VALUE to run outside any transaction that also uses the new value (and
Alembic normally wraps each migration in a transaction), so it has to run in an
"autocommit block" - and past experience in this project with enum/type DDL landing in the
same migration as other schema changes has been painful enough that it's not worth the risk
of mixing it with anything else again.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE till_session_status ADD VALUE IF NOT EXISTS 'cancelled'")


def downgrade() -> None:
    # Postgres has no ALTER TYPE ... DROP VALUE - removing an enum value requires rebuilding the
    # type (create a new type, migrate every column over, drop the old type). Since a demoted
    # 'cancelled' session would need somewhere to go anyway, downgrading this one isn't supported;
    # if it's ever needed, do it by hand against the specific data at the time.
    raise NotImplementedError(
        "Cannot automatically downgrade: Postgres cannot drop a single enum value. "
        "Migrate any 'cancelled' till_sessions rows to another status by hand first if needed."
    )
