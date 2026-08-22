from uuid import UUID

from fastapi import Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, UserRole, UserStatus
from app.security import create_access_token, decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

# Header carrying a freshly-expiring token on every successful authenticated request - see the
# sliding idle-timeout note on Settings.session_idle_timeout_minutes. The frontend picks this up
# and swaps its stored token for it automatically (see api/client.js), which is what makes "any
# API call resets the clock" actually work with an otherwise-stateless JWT.
REFRESHED_TOKEN_HEADER = "X-Refreshed-Token"


def get_current_user(
    response: Response, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception
    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_exception
    try:
        user = db.query(User).filter(User.id == UUID(user_id)).first()
    except ValueError:
        raise credentials_exception
    if user is None:
        raise credentials_exception
    if user.status != UserStatus.active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is {user.status.value}, access denied",
        )

    # This request proves activity, so slide the idle-timeout window back out rather than
    # letting it keep counting down toward whenever the original token happened to be issued.
    response.headers[REFRESHED_TOKEN_HEADER] = create_access_token(
        subject=str(user.id), extra_claims={"role": user.role.value}
    )
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user
