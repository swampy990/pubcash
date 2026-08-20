from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from datetime import datetime

from app.database import get_db
from app.deps import require_admin
from app.models import User, UserStatus
from app.schemas import UserOut, AdminResetPasswordResponse
from app.security import hash_password, generate_temp_password

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut])
def list_users(
    status_filter: UserStatus | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    query = db.query(User)
    if status_filter:
        query = query.filter(User.status == status_filter)
    return query.order_by(User.created_at.desc()).all()


def _get_user_or_404(db: Session, user_id: UUID) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/users/{user_id}/approve", response_model=UserOut)
def approve_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = _get_user_or_404(db, user_id)
    if user.status != UserStatus.pending:
        raise HTTPException(status_code=400, detail="Only pending accounts can be approved")
    user.status = UserStatus.active
    user.approved_at = datetime.utcnow()
    user.approved_by_id = admin.id
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/suspend", response_model=UserOut)
def suspend_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = _get_user_or_404(db, user_id)
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot suspend your own account")
    user.status = UserStatus.suspended
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/reactivate", response_model=UserOut)
def reactivate_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = _get_user_or_404(db, user_id)
    if user.status != UserStatus.suspended:
        raise HTTPException(status_code=400, detail="Only suspended accounts can be reactivated")
    user.status = UserStatus.active
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = _get_user_or_404(db, user_id)
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    try:
        db.delete(user)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=(
                "This user has till session or safe transaction history and cannot be "
                "deleted for audit reasons. Suspend the account instead."
            ),
        )
    return None


@router.post("/users/{user_id}/reset-password", response_model=AdminResetPasswordResponse)
def reset_password(
    user_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = _get_user_or_404(db, user_id)
    temp_password = generate_temp_password()
    user.password_hash = hash_password(temp_password)
    user.must_change_password = True
    db.commit()
    return AdminResetPasswordResponse(username=user.username, temporary_password=temp_password)
