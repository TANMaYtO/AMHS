"""FloodLens Strands agent module."""

import os
import sys
from typing import Any
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()


def get_model() -> Any:
    """Instantiate and return the configured model provider."""
    provider = os.getenv("MODEL_PROVIDER", "ollama").lower()

    if provider == "ollama":
        from strands.models.ollama import OllamaModel

        model_id = os.getenv("OLLAMA_MODEL", "llama3.1")
        host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
        return OllamaModel(host=host, model_id=model_id)

    elif provider == "anthropic":
        from strands.models.anthropic import AnthropicModel

        model_id = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
        api_key = os.getenv("ANTHROPIC_API_KEY")
        return AnthropicModel(model_id=model_id, api_key=api_key)

    else:
        raise ValueError(f"Unsupported MODEL_PROVIDER: {provider}")


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
            "drainage pump deployments."
        ),
    )


def run_agent(prompt: str) -> str:
    """Run the Strands agent with a prompt and return the text response."""
    agent = create_agent()
    response = agent(prompt)
    return str(response)


if __name__ == "__main__":
    user_prompt = sys.argv[1] if len(sys.argv) > 1 else "hello"
    print(f"Running FloodLens agent with prompt: {user_prompt}")
    print(f"Provider: {os.getenv('MODEL_PROVIDER', 'ollama')}")
    try:
        output = run_agent(user_prompt)
        print("Response:")
        print(output)
    except Exception as exc:
        print(f"Agent execution encountered an error: {exc}")
