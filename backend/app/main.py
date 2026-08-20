from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import auth, admin, tills, till_sessions, safe, reports

app = FastAPI(title="Pub Cash Management API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(tills.router)
app.include_router(till_sessions.router)
app.include_router(safe.router)
app.include_router(reports.router)


@app.get("/health")
def health():
    return {"status": "ok"}
