from datetime import datetime
from enum import Enum
from typing import Generic, TypeVar

from pydantic import BaseModel, model_validator


class ToolErrorCode(str, Enum):
    INVALID_ARGUMENT = "INVALID_ARGUMENT"
    SOURCE_UNAVAILABLE = "SOURCE_UNAVAILABLE"


class ToolError(BaseModel):
    code: ToolErrorCode
    message: str


DataT = TypeVar("DataT")


class ToolResponse(BaseModel, Generic[DataT]):
    success: bool
    data: DataT | None
    error: ToolError | None
    generated_at: datetime
    source: str

    @model_validator(mode="after")
    def validate_result(self):
        if self.success and (self.data is None or self.error is not None):
            raise ValueError("A successful tool response requires data and no error")
        if not self.success and (self.data is not None or self.error is None):
            raise ValueError("A failed tool response requires an error and no data")
        return self
