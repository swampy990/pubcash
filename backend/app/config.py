from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, loaded from environment variables / .env file."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql+psycopg2://pubcash:pubcash@db:5432/pubcash"

    # Auth / JWT
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"

    # This is a SLIDING idle timeout, not a fixed session length: every authenticated request
    # (see app.deps.get_current_user) issues a freshly-expiring token, so a user who's actively
    # using the app effectively never gets logged out - but if 10 minutes pass with no requests
    # at all, whatever token they're holding will have actually expired and they're logged out.
    # This matters most on a shared till-side terminal that might get walked away from unlocked.
    session_idle_timeout_minutes: int = 10

    # Initial admin bootstrap (used by seed script)
    initial_admin_username: str = "admin"
    initial_admin_password: str = "ChangeMe123!"

    # Anyone registering a new account must supply this code (share it with staff out-of-band,
    # e.g. verbally or on a notice board - it's not a secret worth emailing around). Rotate it by
    # changing this value and restarting the backend. An empty value means registration is wide
    # open with no code required - not recommended once the site is internet-facing.
    registration_invite_code: str = "change-me-invite-code"

    # Business rules
    variance_alert_threshold: float = 5.00  # GBP amount that triggers a discrepancy alert

    # CORS
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
