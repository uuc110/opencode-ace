#!/usr/bin/env python3
"""
Extended Skill class with context-awareness for hierarchical memory.

Inherits from ACE's base Skill class and adds fields for tracking
which language, framework, and project type a skill belongs to.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional

from ace.skillbook import Skill as ACESkill


@dataclass
class ContextAwareSkill(ACESkill):
    """
    Extended Skill with context tags for hierarchical memory routing.

    Inherits all ACE Skill functionality (id, section, content, helpful/harmful/neutral,
    timestamps, embedding, status) and adds context-aware fields.
    """

    language: Optional[str] = None
    framework: Optional[str] = None
    project_type: Optional[str] = None

    hierarchy_level: Literal["global", "language", "framework", "project"] = "global"
    promotion_count: int = 0
    source_project: Optional[str] = None

    def to_llm_dict(self) -> Dict[str, Any]:
        """Return dictionary with LLM-relevant fields including context."""
        base = super().to_llm_dict()

        if self.language:
            base["language"] = self.language
        if self.framework:
            base["framework"] = self.framework
        if self.project_type:
            base["project_type"] = self.project_type
        if self.hierarchy_level != "global":
            base["hierarchy_level"] = self.hierarchy_level

        return base

    def matches_context(
        self,
        language: Optional[str] = None,
        framework: Optional[str] = None,
        project_type: Optional[str] = None,
    ) -> bool:
        """Check if skill matches the given context."""
        if self.hierarchy_level == "global":
            return True

        if self.language and language and self.language.lower() != language.lower():
            return False

        if self.framework and framework and self.framework.lower() != framework.lower():
            return False

        if (
            self.project_type
            and project_type
            and self.project_type.lower() != project_type.lower()
        ):
            return False

        return True

    def should_promote(
        self, min_helpful: int = 10, min_success_rate: float = 0.85
    ) -> bool:
        """Check if skill should be promoted to higher hierarchy level."""
        if self.hierarchy_level == "global":
            return False

        total = self.helpful + self.harmful + self.neutral
        if total < min_helpful:
            return False

        success_rate = self.helpful / total if total > 0 else 0
        return success_rate >= min_success_rate


def ace_skill_to_context_aware(skill: ACESkill, **context_fields) -> ContextAwareSkill:
    """Convert an ACE Skill to ContextAwareSkill with context fields."""
    return ContextAwareSkill(
        id=skill.id,
        section=skill.section,
        content=skill.content,
        helpful=skill.helpful,
        harmful=skill.harmful,
        neutral=skill.neutral,
        created_at=skill.created_at,
        updated_at=skill.updated_at,
        embedding=skill.embedding,
        status=skill.status,
        **context_fields,
    )


def context_aware_to_ace_skill(skill: ContextAwareSkill) -> ACESkill:
    """Convert ContextAwareSkill back to base ACE Skill (strips context)."""
    return ACESkill(
        id=skill.id,
        section=skill.section,
        content=skill.content,
        helpful=skill.helpful,
        harmful=skill.harmful,
        neutral=skill.neutral,
        created_at=skill.created_at,
        updated_at=skill.updated_at,
        embedding=skill.embedding,
        status=skill.status,
    )
