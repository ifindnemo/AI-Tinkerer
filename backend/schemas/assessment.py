from pydantic import BaseModel, Field

from schemas.api import Severity


class VehicleAssessment(BaseModel):
    severity: Severity
    diagnosis: str = Field(min_length=1, max_length=1500)
    suspected_faults: list[str] = Field(default_factory=list, max_length=5)
    evidence: list[str] = Field(default_factory=list, max_length=8)
    confidence: float = Field(ge=0, le=1)
    missing_data: list[str] = Field(default_factory=list, max_length=8)
    recommendations: list[str] = Field(min_length=1, max_length=5)

