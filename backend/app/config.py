from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Infrastructure (set via env vars / docker-compose)
    database_url: str = "sqlite+aiosqlite:////data/tunehound.db"
    music_library_path: str = "/music"
    data_dir: str = "/data"

    # Download defaults (also editable via the UI, stored in DB)
    default_download_format: str = "mp3"
    default_download_delay_min: float = 5.0
    default_download_delay_max: float = 15.0

    # MusicBrainz contact (required by their API ToS)
    musicbrainz_app_name: str = "TuneHound"
    musicbrainz_app_version: str = "0.1.0"
    musicbrainz_contact: str = "tunehound@localhost"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
