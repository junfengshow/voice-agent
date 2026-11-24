"""主逻辑

定义语音识别、对话、合成和搜索的默认配置，校验每条连接提交的模型参数与 API Key。
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class ProviderModels(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, validate_by_name=True)

    asr_model: str = Field("fun-asr-realtime", alias="asrModel", min_length=1, max_length=128)
    llm_model: str = Field("deepseek-flash", alias="llmModel", min_length=1, max_length=128)
    tts_model: str = Field("qwen3-tts-flash-realtime", alias="ttsModel", min_length=1, max_length=128)
    tts_voice: str = Field("Cherry", alias="ttsVoice", min_length=1, max_length=128)
    search_engine: str = Field("search_std", alias="searchEngine", min_length=1, max_length=128)
    dashscope_region: Literal["cn", "intl"] = Field("cn", alias="dashscopeRegion")


class ProviderSettings(ProviderModels):
    dashscope_key: SecretStr = Field(alias="dashscopeApiKey", min_length=1, max_length=512)
    deepseek_key: SecretStr = Field(alias="deepseekApiKey", min_length=1, max_length=512)
    zhipu_key: SecretStr = Field(alias="zhipuApiKey", min_length=1, max_length=512)

    @field_validator("dashscope_key", "deepseek_key", "zhipu_key", mode="before")
    @classmethod
    def strip_api_key(cls, value):
        return value.strip() if isinstance(value, str) else value
