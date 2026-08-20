#!/usr/bin/env bash
set -e

echo "Waiting for database..."
python - <<'EOF'
import time
import sys
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from app.config import settings

engine = create_engine(settings.database_url)
for attempt in range(30):
    try:
        with engine.connect():
            print("Database is ready.")
            sys.exit(0)
    except OperationalError:
        print(f"Database not ready yet (attempt {attempt + 1}/30), retrying...")
        time.sleep(2)
print("Database did not become ready in time.", file=sys.stderr)
sys.exit(1)
EOF

echo "Running migrations..."
alembic upgrade head

echo "Seeding initial admin user..."
python -m app.seed

echo "Starting server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
