from fastapi import FastAPI, Request
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


@app.middleware("http")
async def no_store_cache_headers(request: Request, call_next):
    # Every response here is either authenticated or login/registration - none of it should
    # ever be cached by the browser or an intermediate proxy (user lists, till/safe figures,
    # tokens, etc). Static assets are served by nginx/Caddy, not this app, so this has no effect
    # on the caching we DO want for those.
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(tills.router)
app.include_router(till_sessions.router)
app.include_router(safe.router)
app.include_router(reports.router)


@app.get("/health")
def health():
    return {"status": "ok"}
