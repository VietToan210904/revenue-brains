from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI


def extract_payload_with_langchain(
    *,
    api_key: str,
    model: str,
    schema: dict[str, Any],
    system_prompt: str,
    user_prompt: str,
) -> dict[str, Any]:
    chat_model = ChatOpenAI(
        api_key=api_key,
        model=model,
        temperature=0,
    )
    structured_model = chat_model.with_structured_output(
        schema,
        method="json_schema",
        strict=True,
    )
    result = structured_model.invoke(
        [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]
    )

    if isinstance(result, dict):
        return result

    if hasattr(result, "model_dump"):
        return result.model_dump(by_alias=True)

    raise TypeError("LangChain structured output did not return a mapping.")
