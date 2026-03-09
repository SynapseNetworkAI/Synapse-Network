import httpx

from app.core.config import get_settings


async def request_famous_quote(text: str) -> str:
    settings = get_settings()

    if not settings.deepseek_api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is not configured")

    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.deepseek_model,
        "messages": [
            {
                "role": "system",
                "content": "你是名言助手。请只返回一条名人名言，包含作者。输出中文，不要解释。",
            },
            {
                "role": "user",
                "content": f"请基于这个输入给我一条名人名言：{text}",
            },
        ],
        "temperature": 0.7,
    }

    timeout = httpx.Timeout(settings.deepseek_timeout_s)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError("Invalid DeepSeek response format") from error

    result = str(content).strip()
    if not result:
        raise RuntimeError("Empty quote returned by DeepSeek")
    return result
