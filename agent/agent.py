"""FloodLens Strands agent module for Delhi-NCR urban drainage control room.

Supports Gemini, Anthropic, and Ollama model providers, connects to
spatial and hydrological tools, and provides execution tracing.
"""

import asyncio
import os
import sys
from typing import Any
from dotenv import load_dotenv

from agent.tools import (
    check_place,
    get_and_clear_traces,
    get_forecast,
    get_hotspots,
    pump_plan,
    route_risk,
)

# Load environment variables
load_dotenv()

SYSTEM_PROMPT = """You are FloodLens,
an assistant for urban drainage control in Delhi-NCR.
Your role is to help control room operators assess flood susceptibility,
monitor vulnerable corridors, and deploy drainage resources.

CRITICAL OPERATING PRINCIPLES:
1. Ground every claim strictly in tool output. NEVER invent flooding water
   depths, rainfall numbers, or facts not present in data returned by tools.
2. Always describe results as a RELATIVE, UNCALIBRATED risk index for
   corridor-level (~1 km) planning. Never claim calibrated hydraulic levels.
3. If data is missing, a tool returns an error, or a place cannot be geocoded,
   say so explicitly.
4. If the user does not specify a rainfall intensity (in mm/hr), call
   `get_forecast` first to check upcoming weather and suggest a scenario.
5. Keep answers short, direct, and actionable for control room operators:
   - Provide an operational summary first (1-3 sentences).
   - Follow with a concise numbered action list or prioritized table/bullet list.
"""


def get_model() -> Any:
    """Instantiate and return the configured model provider."""
    provider = os.getenv("MODEL_PROVIDER", "gemini").lower()

    if provider == "gemini":
        from strands.models.gemini import GeminiModel

        model_id = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        client_args = {"api_key": api_key} if api_key else None
        return GeminiModel(model_id=model_id, client_args=client_args)

    elif provider == "anthropic":
        from strands.models.anthropic import AnthropicModel

        model_id = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
        api_key = os.getenv("ANTHROPIC_API_KEY")
        return AnthropicModel(model_id=model_id, api_key=api_key)

    elif provider == "ollama":
        from strands.models.ollama import OllamaModel

        model_id = os.getenv("OLLAMA_MODEL", "llama3.1")
        host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
        return OllamaModel(host=host, model_id=model_id)

    else:
        raise ValueError(
            f"Unsupported MODEL_PROVIDER '{provider}'. "
            "Supported providers: gemini, anthropic, ollama."
        )


def _format_history_messages(
    history: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Convert raw input conversation history into Strands message format."""
    if not history:
        return []

    formatted: list[dict[str, Any]] = []
    for item in history:
        role = item.get("role", "user")
        content = item.get("content", "")
        if isinstance(content, str):
            content_block = [{"text": content}]
        elif isinstance(content, list):
            content_block = content
        else:
            content_block = [{"text": str(content)}]
        formatted.append({"role": role, "content": content_block})
    return formatted


def create_agent(history: list[dict[str, Any]] | None = None) -> Any:
    """Create and return a configured Strands Agent instance."""
    from strands import Agent

    model = get_model()
    messages = _format_history_messages(history)
    tools = [get_forecast, get_hotspots, check_place, pump_plan, route_risk]

    return Agent(
        model=model,
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
        messages=messages if messages else None,
    )


def chat_with_agent(
    message: str,
    history: list[dict[str, Any]] | None = None,
    max_retries: int = 4,
) -> tuple[str, list[dict[str, Any]]]:
    """Execute a chat turn with the agent and return the response and tool trace.

    Args:
        message: User query or prompt.
        history: Prior conversation turns as a list of message dicts.
        max_retries: Maximum attempts if API rate limits (429) are encountered.

    Returns:
        Tuple of (reply_text, tool_trace).
    """
    import time

    for attempt in range(1, max_retries + 1):
        try:
            # Clear trace buffer before execution
            get_and_clear_traces()

            agent = create_agent(history=history)
            agent_response = agent(message)
            reply_text = str(agent_response)

            # Collect recorded traces from executed tools
            traces = get_and_clear_traces()
            return reply_text, traces
        except Exception as exc:
            err_str = str(exc)
            is_transient = (
                "429" in err_str
                or "503" in err_str
                or "UNAVAILABLE" in err_str
                or "RESOURCE_EXHAUSTED" in err_str
                or "quota" in err_str.lower()
                or "demand" in err_str.lower()
            )
            if is_transient and attempt < max_retries:
                wait_sec = 10.0 * attempt
                print(
                    f"\n[TRANSIENT ERROR / SPIKE] Waiting {wait_sec:.0f}s before retry "
                    f"(attempt {attempt}/{max_retries})..."
                )
                time.sleep(wait_sec)
                continue
            raise
    return "Error: Exceeded maximum retry attempts.", []


async def chat_with_agent_async(
    message: str,
    history: list[dict[str, Any]] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Asynchronously execute a chat turn with the agent."""
    return await asyncio.to_thread(chat_with_agent, message, history)


def run_agent(prompt: str) -> str:
    """Run the agent with a prompt and return the text response."""
    reply, _ = chat_with_agent(prompt)
    return reply


if __name__ == "__main__":
    user_prompt = sys.argv[1] if len(sys.argv) > 1 else "hello"
    active_provider = os.getenv("MODEL_PROVIDER", "gemini").lower()
    print(f"Running FloodLens agent with provider: {active_provider}")
    print(f"Prompt: {user_prompt}\n")
    output, captured_traces = chat_with_agent(user_prompt)
    print("Response:")
    print(output)
    print("\nTool Traces:")
    print(captured_traces)
