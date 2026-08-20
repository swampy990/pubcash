from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_admin
from app.models import Till, User
from app.schemas import TillCreate, TillOut

router = APIRouter(prefix="/tills", tags=["tills"])


@router.get("", response_model=list[TillOut])
def list_tills(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Till).order_by(Till.name).all()


@router.post("", response_model=TillOut, status_code=201)
def create_till(payload: TillCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    existing = db.query(Till).filter(Till.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="A till with this name already exists")
    till = Till(name=payload.name, standard_float=payload.standard_float)
    db.add(till)
    db.commit()
    db.refresh(till)
    return till


@router.delete("/{till_id}", status_code=204)
def delete_till(till_id: UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    till = db.query(Till).filter(Till.id == till_id).first()
    if not till:
        raise HTTPException(status_code=404, detail="Till not found")
    db.delete(till)
    db.commit()
    return None
