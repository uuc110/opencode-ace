#!/usr/bin/env python3
"""
Extended Skillbook with hierarchical context support.

Inherits from ACE's Skillbook and adds:
- Loading/saving skills with context tags
- Hierarchical paths (global/, languages/, frameworks/)
- Merging skills from multiple levels based on project context
"""

import json
import logging
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ace.skillbook import Skillbook as ACESkillbook, Skill as ACESkill
from ace.updates import UpdateBatch

from .skill_ext import ContextAwareSkill, ace_skill_to_context_aware

logger = logging.getLogger(__name__)


class HierarchyConfig:
    """Configuration for skillbook hierarchy paths."""

    def __init__(
        self,
        base_path: str,
        global_path: str = "global/universal.json",
        languages_dir: str = "languages",
        frameworks_dir: str = "frameworks",
        projects_dir: str = "projects",
    ):
        self.base_path = Path(base_path)
        self.global_path = global_path
        self.languages_dir = languages_dir
        self.frameworks_dir = frameworks_dir
        self.projects_dir = projects_dir

    def get_global_path(self) -> Path:
        return self.base_path / self.global_path

    def get_language_path(self, language: str) -> Path:
        return self.base_path / self.languages_dir / f"{language.lower()}.json"

    def get_framework_path(self, framework: str) -> Path:
        return self.base_path / self.frameworks_dir / f"{framework.lower()}.json"

    def get_project_path(self, project_id: str) -> Path:
        return self.base_path / self.projects_dir / f"{project_id}.json"


class ProjectContext:
    """Current project context for skill loading and routing."""

    def __init__(
        self,
        language: Optional[str] = None,
        framework: Optional[str] = None,
        project_type: Optional[str] = None,
        project_id: Optional[str] = None,
        working_directory: Optional[str] = None,
    ):
        self.language = language
        self.framework = framework
        self.project_type = project_type
        self.project_id = project_id
        self.working_directory = working_directory

    def to_dict(self) -> Dict[str, Optional[str]]:
        return {
            "language": self.language,
            "framework": self.framework,
            "project_type": self.project_type,
            "project_id": self.project_id,
            "working_directory": self.working_directory,
        }


class ContextAwareSkillbook(ACESkillbook):
    """
    Extended Skillbook with hierarchical context support.

    Inherits all ACE Skillbook functionality and adds:
    - Hierarchical skill loading (Global -> Language -> Framework -> Project)
    - Context-aware skill routing
    - Multi-path skill storage
    """

    def __init__(self, hierarchy_config: Optional[HierarchyConfig] = None):
        super().__init__()
        self.hierarchy_config = hierarchy_config
        self._context: Optional[ProjectContext] = None
        self._loaded_sources: List[str] = []

    def set_context(self, context: ProjectContext) -> None:
        """Set the current project context."""
        self._context = context

    def get_context(self) -> Optional[ProjectContext]:
        """Get the current project context."""
        return self._context

    def load_hierarchical(self, context: ProjectContext) -> Tuple[int, List[str]]:
        """
        Load skills from hierarchy based on context.

        Loads in order: Global -> Language -> Framework -> Project
        Each level's skills are merged into this skillbook.

        Returns:
            Tuple of (total_skills_loaded, list_of_sources)
        """
        self._context = context
        self._loaded_sources = []
        total_loaded = 0

        if not self.hierarchy_config:
            logger.warning("No hierarchy config set, cannot load hierarchical skills")
            return 0, []

        global_path = self.hierarchy_config.get_global_path()
        loaded, source = self._load_from_path(global_path, "global")
        if loaded > 0:
            total_loaded += loaded
            self._loaded_sources.append(source)

        if context.language:
            lang_path = self.hierarchy_config.get_language_path(context.language)
            loaded, source = self._load_from_path(
                lang_path, f"language/{context.language}"
            )
            if loaded > 0:
                total_loaded += loaded
                self._loaded_sources.append(source)

        if context.framework:
            fw_path = self.hierarchy_config.get_framework_path(context.framework)
            loaded, source = self._load_from_path(
                fw_path, f"framework/{context.framework}"
            )
            if loaded > 0:
                total_loaded += loaded
                self._loaded_sources.append(source)

        if context.project_id:
            proj_path = self.hierarchy_config.get_project_path(context.project_id)
            loaded, source = self._load_from_path(
                proj_path, f"project/{context.project_id}"
            )
            if loaded > 0:
                total_loaded += loaded
                self._loaded_sources.append(source)

        logger.info(
            f"Loaded {total_loaded} skills from {len(self._loaded_sources)} sources"
        )
        return total_loaded, self._loaded_sources

    def _load_from_path(self, path: Path, source_name: str) -> Tuple[int, str]:
        """Load skills from a specific path and merge into this skillbook."""
        if not path.exists():
            logger.debug(f"Skillbook not found at {path}")
            return 0, ""

        try:
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)

            skills_data = data.get("skills", {})
            loaded_count = 0

            for skill_id, skill_dict in skills_data.items():
                if skill_id not in self._skills:
                    if "embedding" not in skill_dict:
                        skill_dict["embedding"] = None
                    if "status" not in skill_dict:
                        skill_dict["status"] = "active"

                    if any(
                        k in skill_dict
                        for k in ["language", "framework", "project_type"]
                    ):
                        skill = ContextAwareSkill(**skill_dict)
                    else:
                        base_skill = ACESkill(
                            **{
                                k: v
                                for k, v in skill_dict.items()
                                if k
                                in [
                                    "id",
                                    "section",
                                    "content",
                                    "helpful",
                                    "harmful",
                                    "neutral",
                                    "created_at",
                                    "updated_at",
                                    "embedding",
                                    "status",
                                ]
                            }
                        )
                        skill = ace_skill_to_context_aware(base_skill)

                    self._skills[skill_id] = skill
                    self._sections.setdefault(skill.section, []).append(skill_id)
                    loaded_count += 1

            return loaded_count, f"{source_name} ({loaded_count} skills)"

        except Exception as e:
            logger.error(f"Failed to load skillbook from {path}: {e}")
            return 0, ""

    def route_skill(self, skill: ContextAwareSkill, context: ProjectContext) -> str:
        """
        Determine the best storage path for a skill based on its content and context.

        Returns:
            Path string relative to base_path where skill should be stored
        """
        if not self.hierarchy_config:
            return "global/universal.json"

        if skill.hierarchy_level == "framework" and context.framework:
            return f"{self.hierarchy_config.frameworks_dir}/{context.framework.lower()}.json"

        if skill.hierarchy_level == "language" and context.language:
            return (
                f"{self.hierarchy_config.languages_dir}/{context.language.lower()}.json"
            )

        if skill.hierarchy_level == "project" and context.project_id:
            return f"{self.hierarchy_config.projects_dir}/{context.project_id}.json"

        return self.hierarchy_config.global_path

    def save_skill_to_hierarchy(
        self, skill: ContextAwareSkill, context: ProjectContext
    ) -> str:
        """
        Save a skill to the appropriate hierarchical skillbook.

        Returns:
            Path where skill was saved
        """
        if not self.hierarchy_config:
            raise ValueError("No hierarchy config set")

        relative_path = self.route_skill(skill, context)
        full_path = self.hierarchy_config.base_path / relative_path

        full_path.parent.mkdir(parents=True, exist_ok=True)

        if full_path.exists():
            with full_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        else:
            data = {"skills": {}, "sections": {}, "next_id": 0}

        skill_dict = asdict(skill)
        data["skills"][skill.id] = skill_dict

        if skill.section not in data["sections"]:
            data["sections"][skill.section] = []
        if skill.id not in data["sections"][skill.section]:
            data["sections"][skill.section].append(skill.id)

        with full_path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        logger.info(f"Saved skill {skill.id} to {relative_path}")
        return relative_path

    def apply_update_with_context(
        self,
        update: UpdateBatch,
        context: ProjectContext,
        route_new_skills: bool = True,
    ) -> None:
        """
        Apply update batch with context-aware routing for new skills.

        If route_new_skills is True, ADD operations will be routed to
        appropriate hierarchical skillbooks based on context.
        """
        self.apply_update(update)

        if route_new_skills and self.hierarchy_config:
            for operation in update.operations:
                if operation.type.upper() == "ADD" and operation.skill_id:
                    skill = self._skills.get(operation.skill_id)
                    if skill and isinstance(skill, ContextAwareSkill):
                        self.save_skill_to_hierarchy(skill, context)

    def get_loaded_sources(self) -> List[str]:
        """Return list of sources that were loaded."""
        return self._loaded_sources.copy()

    def stats_extended(self) -> Dict[str, Any]:
        """Return extended stats including context information."""
        base_stats = self.stats()

        context_skills = {"global": 0, "language": 0, "framework": 0, "project": 0}
        for skill in self._skills.values():
            if isinstance(skill, ContextAwareSkill):
                context_skills[skill.hierarchy_level] = (
                    context_skills.get(skill.hierarchy_level, 0) + 1
                )

        return {
            **base_stats,
            "context_distribution": context_skills,
            "loaded_sources": self._loaded_sources,
            "current_context": self._context.to_dict() if self._context else None,
        }
