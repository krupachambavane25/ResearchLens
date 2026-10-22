from typing import Annotated, Literal

from pydantic import BaseModel, Field


class AnalysisRequest(BaseModel):
    prompt: str = Field(min_length=5, max_length=4000)
    paper_ids: list[str] = Field(min_length=1, max_length=10)
    project_id: str | None = None
    document_ids: list[str] = Field(default_factory=list, max_length=10)
    mode: Literal["comprehensive", "similarity", "gaps", "individual"] = "comprehensive"
    criteria: list[Annotated[str, Field(min_length=1, max_length=500)]] = Field(
        default_factory=list, max_length=20
    )
    questions: list[Annotated[str, Field(min_length=1, max_length=500)]] = Field(
        default_factory=list, max_length=20
    )
    report_format: Literal["detailed", "concise", "table"] = "detailed"


class ProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)


class ProjectPapersRequest(BaseModel):
    paper_ids: list[str] = Field(max_length=500)


class AssistantRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    paper_ids: list[str] = Field(min_length=1, max_length=10)
    conversation_id: str | None = None


class PaperResponse(BaseModel):
    id: str
    filename: str
    title: str
    authors: str
    page_count: int
    word_count: int
    sections: dict
    created_at: str


class AnalysisResponse(BaseModel):
    id: str
    prompt: str
    mode: str
    provider: str
    result: dict
    created_at: str


class HealthResponse(BaseModel):
    status: str
    live_ai_enabled: bool
    provider: str
