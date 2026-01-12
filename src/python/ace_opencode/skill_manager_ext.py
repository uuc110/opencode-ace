from typing import Any, Optional
from ace.roles import SkillManager, SkillManagerOutput, ReflectorOutput
from ace.deduplication import DeduplicationManager
from .llm_adapter import OpenCodeLLMClient


class OpenCodeSkillManager(SkillManager):
    """
    ACE SkillManager that uses OpenCode's LLM infrastructure.

    This wrapper provides skill management capabilities using OpenCode SDK for LLM calls,
    allowing the use of configured providers (GitHub Copilot, local models, etc.)
    without requiring external API keys.

    Args:
        opencode_url: OpenCode server URL (default: http://localhost:4096)
        session_title: Title for OpenCode sessions (default: "ACE Skill Management")
        model: Model configuration to use (uses OpenCode default if not specified)
        prompt_template: Custom prompt template (uses ACE's SKILL_MANAGER_PROMPT by default)
        max_retries: Maximum validation retries via Instructor (default: 3)
        dedup_manager: Optional DeduplicationManager for skill deduplication

    Example:
        >>> skill_manager = OpenCodeSkillManager()
        >>> output = skill_manager.update_skills(
        ...     reflection=reflection,
        ...     skillbook=skillbook,
        ...     question_context="Math problem solving",
        ...     progress="5/10 problems solved correctly"
        ... )
        >>> skillbook.apply_update(output.update)
    """

    def __init__(
        self,
        opencode_url: str = "http://localhost:4096",
        session_title: str = "ACE Skill Management",
        model: Optional[dict[str, Any]] = None,
        prompt_template: str | None = None,
        *,
        max_retries: int = 3,
        dedup_manager: Optional[DeduplicationManager] = None,
    ) -> None:
        llm = OpenCodeLLMClient(
            opencode_url=opencode_url,
            session_title=session_title,
            model=model,
        )

        from ace.roles import SKILL_MANAGER_PROMPT

        if prompt_template is None:
            prompt_template = SKILL_MANAGER_PROMPT

        super().__init__(
            llm=llm,
            prompt_template=prompt_template,
            max_retries=max_retries,
            dedup_manager=dedup_manager,
        )
