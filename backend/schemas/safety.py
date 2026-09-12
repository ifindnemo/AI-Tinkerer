from pydantic import BaseModel, Field

from schemas.api import Severity


class SafetyGuardrailResult(BaseModel):
    triggered: bool
    minimum_severity: Severity
    reasons: list[str] = Field(default_factory=list)
