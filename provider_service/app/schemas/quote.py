from pydantic import BaseModel, Field


class QuoteRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=200, description="Input string for quote topic or style")


class QuoteResponse(BaseModel):
    input_text: str
    quote: str
    model: str
    source: str = "local_json"


class QuoteTop3Response(BaseModel):
    input_text: str
    quotes: list[str]
    model: str
    source: str = "local_json"
