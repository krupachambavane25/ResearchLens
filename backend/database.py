from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from backend.config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine():
    url = get_settings().database_url
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgres://")
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
    options = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=options, future=True, pool_pre_ping=True)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def migrate_owner_columns() -> None:
    owner_tables = ("papers", "analyses", "supporting_documents")
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        for table in owner_tables:
            if table not in existing_tables:
                continue
            columns = {column["name"] for column in inspect(connection).get_columns(table)}
            if "owner_id" not in columns:
                connection.execute(
                    text(
                        f'ALTER TABLE "{table}" ADD COLUMN owner_id '
                        "VARCHAR(255) NOT NULL DEFAULT 'local'"
                    )
                )
            if table == "papers" and "page_texts" not in columns:
                connection.execute(text('ALTER TABLE "papers" ADD COLUMN page_texts JSON'))
                columns.add("page_texts")
            if table == "papers" and "project_id" not in columns:
                connection.execute(text('ALTER TABLE "papers" ADD COLUMN project_id VARCHAR(36)'))
            if table == "analyses" and "project_id" not in columns:
                connection.execute(text('ALTER TABLE "analyses" ADD COLUMN project_id VARCHAR(36)'))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
