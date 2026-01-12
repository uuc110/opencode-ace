from typing import Any, Optional
from ace.roles import Reflector, ReflectorOutput
from ace.skillbook import Skillbook
from .llm_adapter import OpenCodeLLMClient


class OpenCodeReflector(Reflector):
    """
    ACE Reflector that uses OpenCode's LLM infrastructure.

    This wrapper provides reflection capabilities using OpenCode SDK for LLM calls,
    allowing the use of configured providers (GitHub Copilot, local models, etc.)
    without requiring external API keys.

    Args:
        opencode_url: OpenCode server URL (default: http://localhost:4096)
        session_title: Title for OpenCode sessions (default: "ACE Reflection")
        model: Model configuration to use (uses OpenCode default if not specified)
        prompt_template: Custom prompt template (uses ACE's REFLECTOR_PROMPT by default)
        max_retries: Maximum validation retries via Instructor (default: 3)

    Example:
        >>> reflector = OpenCodeReflector()
        >>> reflection = reflector.reflect(
        ...     question="What is 2+2?",
        ...     agent_output=agent_output,
        ...     skillbook=skillbook,
        ...     ground_truth="4"
        ... )
        >>> print(reflection.key_insight)
        Successfully solved the arithmetic problem
    """

    def __init__(
        self,
        opencode_url: str = "http://localhost:4096",
        session_title: str = "ACE Reflection",
        model: Optional[dict[str, Any]] = None,
        prompt_template: str | None = None,
        *,
        max_retries: int = 3,
    ) -> None:
        llm = OpenCodeLLMClient(
            opencode_url=opencode_url,
            session_title=session_title,
            model=model,
        )

        from ace.roles import REFLECTOR_PROMPT

        if prompt_template is None:
            prompt_template = REFLECTOR_PROMPT

        super().__init__(
            llm=llm,
            prompt_template=prompt_template,
            max_retries=max_retries,
        )
