"""FloodLens Strands agent module supporting Gemini, Anthropic, and Ollama."""

import os
import sys
from typing import Any
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()


def get_model() -> Any:
    """Instantiate and return the configured model provider."""
    provider = os.getenv("MODEL_PROVIDER", "gemini").lower()

    if provider == "gemini":
        from strands.models.gemini import GeminiModel

        model_id = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
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


def create_agent() -> Any:
    """Create and return a configured Strands agent instance."""
    from strands import Agent
    from agent.tools import get_hotspots

    model = get_model()
    return Agent(
        model=model,
        tools=[get_hotspots],
        system_prompt=(
            "You are the FloodLens municipal flood control room assistant. "
            "You help operators assess urban waterlogging risk and coordinate "
            "drainage pump deployments in the Delhi-Gurgaon region."
        ),
    )


def run_agent(prompt: str) -> str:
    """Run the Strands agent with a prompt and return the text response."""
    agent = create_agent()
    response = agent(prompt)
    return str(response)


if __name__ == "__main__":
    user_prompt = sys.argv[1] if len(sys.argv) > 1 else "hello"
    active_provider = os.getenv("MODEL_PROVIDER", "gemini").lower()
    print(f"Running FloodLens agent with provider: {active_provider}")
    print(f"Prompt: {user_prompt}")
    output = run_agent(user_prompt)
    print("Response:")
    print(output)
