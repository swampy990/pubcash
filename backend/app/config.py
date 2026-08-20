from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, loaded from environment variables / .env file."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql+psycopg2://pubcash:pubcash@db:5432/pubcash"

    # Auth / JWT
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12  # 12 hours

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
