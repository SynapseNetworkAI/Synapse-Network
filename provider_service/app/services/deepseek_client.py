import httpx

from app.core.config import get_settings


async def _request_chat_completion(messages: list[dict[str, str]]) -> str:
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
        "messages": messages,
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


async def request_famous_quote(text: str) -> str:
    messages = [
        {
            "role": "system",
            "content": "你是名言助手。请只返回一条名人名言，包含作者。输出中文，不要解释。",
        },
        {
            "role": "user",
            "content": f"请基于这个输入给我一条名人名言：{text}",
        },
    ]
    return await _request_chat_completion(messages)


async def request_famous_quote_top3(text: str) -> list[str]:
    messages = [
        {
            "role": "system",
            "content": "你是名言助手。请返回3条不同的名人名言，每条一行，包含作者，不要解释，不要编号。",
        },
        {
            "role": "user",
            "content": f"请基于这个输入给我3条名人名言：{text}",
        },
    ]
    content = await _request_chat_completion(messages)
    lines = [line.strip(" -•\t") for line in content.splitlines() if line.strip()]
    deduplicated: list[str] = []
    for line in lines:
        if line not in deduplicated:
            deduplicated.append(line)
        if len(deduplicated) >= 3:
            break
    if not deduplicated:
        raise RuntimeError("Empty top3 quotes returned by DeepSeek")
    return deduplicated[:3]
