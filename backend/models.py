from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from backend.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Paper(Base):
    __tablename__ = "papers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[str] = mapped_column(String(255), nullable=False, default="local", index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(500), default="")
    authors: Mapped[str] = mapped_column(Text, default="")
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    extracted_text: Mapped[str] = mapped_column(Text, nullable=False)
    page_texts: Mapped[list[str] | None] = mapped_column(JSON, default=list)
    sections: Mapped[dict] = mapped_column(JSON, default=dict)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    analysis_links: Mapped[list["AnalysisPaper"]] = relationship(
        back_populates="paper", cascade="all, delete-orphan"
    )


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[str] = mapped_column(String(255), nullable=False, default="local", index=True)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[str] = mapped_column(String(40), default="comprehensive")
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    criteria: Mapped[list] = mapped_column(JSON, default=list)
    questions: Mapped[list] = mapped_column(JSON, default=list)
    result: Mapped[dict] = mapped_column(JSON, nullable=False)
    provider: Mapped[str] = mapped_column(String(40), default="local")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    paper_links: Mapped[list["AnalysisPaper"]] = relationship(
        back_populates="analysis", cascade="all, delete-orphan"
    )
    document_links: Mapped[list["AnalysisDocument"]] = relationship(
        back_populates="analysis", cascade="all, delete-orphan"
    )


class AnalysisPaper(Base):
    __tablename__ = "analysis_papers"

    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id"), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"), primary_key=True)
    analysis: Mapped[Analysis] = relationship(back_populates="paper_links")
    paper: Mapped[Paper] = relationship(back_populates="analysis_links")


class SupportingDocument(Base):
    __tablename__ = "supporting_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[str] = mapped_column(String(255), nullable=False, default="local", index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    analysis_links: Mapped[list["AnalysisDocument"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class AnalysisDocument(Base):
    __tablename__ = "analysis_documents"

    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id"), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("supporting_documents.id"), primary_key=True)
    analysis: Mapped[Analysis] = relationship(back_populates="document_links")
    document: Mapped[SupportingDocument] = relationship(back_populates="analysis_links")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AssistantConversation(Base):
    __tablename__ = "assistant_conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    paper_ids: Mapped[list] = mapped_column(JSON, nullable=False)
    messages: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
