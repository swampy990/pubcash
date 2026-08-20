"""Bootstrap script: creates the first admin account if none exists yet.

Run with: python -m app.seed
Safe to run multiple times - it's a no-op if an admin user already exists.
"""
from datetime import datetime

from app.config import settings
from app.database import SessionLocal
from app.models import User, UserRole, UserStatus
from app.security import hash_password


def run():
    db = SessionLocal()
    try:
        existing_admin = db.query(User).filter(User.role == UserRole.admin).first()
        if existing_admin:
            print(f"Admin user already exists ({existing_admin.username}); skipping seed.")
            return

        admin = User(
            username=settings.initial_admin_username,
            password_hash=hash_password(settings.initial_admin_password),
            role=UserRole.admin,
            status=UserStatus.active,
            approved_at=datetime.utcnow(),
        )
        db.add(admin)
        db.commit()
        print(
            f"Created initial admin user '{admin.username}'. "
            f"Log in and change the password immediately."
        )
    finally:
        db.close()


if __name__ == "__main__":
    run()
