from typing import Any, Optional
from pathlib import Path
from ace.roles import ReflectorOutput, AgentOutput
from ace.skillbook import Skillbook
from .skillbook_ext import (
    ContextAwareSkillbook,
    HierarchyConfig,
    ProjectContext,
    ContextAwareSkill,
)
from .reflector_ext import OpenCodeReflector
from .skill_manager_ext import OpenCodeSkillManager
from .llm_adapter import OpenCodeLLMClient


class ACEOpenCodeIntegration:
    """
    Main integration point for OpenCode-ACE plugin.

    Provides context-aware skill learning using ACE framework with OpenCode's LLM.
    Skills are automatically routed to hierarchical skillbooks based on project context.

    Args:
        skillbook_dir: Base directory for skillbooks (default: ~/.config/opencode/ace_skillbooks)
        opencode_url: OpenCode server URL (default: http://localhost:4096)
        model: Optional model configuration

    Example:
        >>> integration = ACEOpenCodeIntegration()
        >>>
        >>> # Inject context before a task
        >>> integration.inject_context(
        ...     task="Implement user authentication",
        ...     context={"language": "python", "framework": "django"}
        ... )
        >>>
        >>> # Learn from task completion
        >>> integration.learn(
        ...     task="Implement user authentication",
        ...     result="Successfully added JWT auth",
        ...     success=True,
        ...     context={"language": "python", "framework": "django"}
        ... )
    """

    def __init__(
        self,
        skillbook_dir: Optional[Path | str] = None,
        opencode_url: str = "http://localhost:4096",
        model: Optional[dict[str, Any]] = None,
    ) -> None:
        if skillbook_dir is None:
            skillbook_dir = Path.home() / ".config" / "opencode" / "ace_skillbooks"
        elif isinstance(skillbook_dir, str):
            skillbook_dir = Path(skillbook_dir)

        self.skillbook_dir = Path(skillbook_dir)
        self.opencode_url = opencode_url
        self.model = model

        hierarchy_config = HierarchyConfig(
            base_path=str(self.skillbook_dir),
            global_path="global_skillbook.json",
            languages_dir="languages",
            frameworks_dir="frameworks",
            projects_dir="projects",
        )

        self.skillbook = ContextAwareSkillbook(hierarchy_config)
        self.reflector = OpenCodeReflector(
            opencode_url=opencode_url,
            session_title="ACE Reflection",
            model=model,
        )
        self.skill_manager = OpenCodeSkillManager(
            opencode_url=opencode_url,
            session_title="ACE Skill Management",
            model=model,
        )

        self._current_context: Optional[ProjectContext] = None

    def detect_project_context(
        self,
        project_path: Optional[Path | str] = None,
    ) -> ProjectContext:
        if project_path is None:
            project_path = Path.cwd()
        elif isinstance(project_path, str):
            project_path = Path(project_path)

        language = None
        framework = None
        project_type = None

        project_path = Path(project_path)

        files = list(project_path.glob("*")) + list(project_path.glob("**/*"))
        file_names = [f.name for f in files if f.is_file()]

        if any(f.endswith((".py", ".pyx", ".pyi")) for f in file_names):
            language = "python"
        elif any(f.endswith((".ts", ".tsx", ".js", ".jsx")) for f in file_names):
            language = "typescript"
        elif any(f.endswith((".go")) for f in file_names):
            language = "go"
        elif any(f.endswith((".rs")) for f in file_names):
            language = "rust"
        elif any(f.endswith((".java", ".kt", ".kts")) for f in file_names):
            language = "java"

        if (
            "requirements.txt" in file_names
            or "pyproject.toml" in file_names
            or "setup.py" in file_names
        ):
            if "django" in file_names or "settings.py" in file_names:
                framework = "django"
            elif "fastapi" in file_names or "main.py" in file_names:
                framework = "fastapi"
            elif "flask" in file_names or "app.py" in file_names:
                framework = "flask"

        if "package.json" in file_names or "node_modules" in [
            f.name for f in files if f.is_dir()
        ]:
            if "next.config.js" in file_names or "next.config.ts" in file_names:
                framework = "next.js"
            elif "vite.config.js" in file_names or "vite.config.ts" in file_names:
                framework = "vite"
            elif "remix.config.js" in file_names:
                framework = "remix"
            elif "nuxt.config.js" in file_names or "nuxt.config.ts" in file_names:
                framework = "nuxt"
            elif language == "typescript":
                framework = "react"

        if language:
            if language == "python":
                if framework in ["django", "fastapi", "flask"]:
                    project_type = "web_backend"
                else:
                    project_type = "python_project"
            elif language == "typescript":
                if framework in ["next.js", "react", "remix"]:
                    project_type = "web_frontend"
                elif framework == "vite":
                    project_type = "vite_project"
                else:
                    project_type = "typescript_project"
            else:
                project_type = f"{language}_project"

        self._current_context = ProjectContext(
            language=language,
            framework=framework,
            project_type=project_type,
            working_directory=str(project_path),
        )
        return self._current_context

    def load_skillbook(self) -> None:
        if self._current_context is None:
            self.detect_project_context()
        self.skillbook.load_hierarchical(self._current_context)

    def get_contextual_skills(
        self,
        task: str,
    ) -> list[ContextAwareSkill]:
        if self._current_context is None:
            self.detect_project_context()

        all_skills = list(self.skillbook._skills.values())
        contextual = [s for s in all_skills if isinstance(s, ContextAwareSkill)]

        return sorted(contextual, key=lambda s: s.helpful - s.harmful, reverse=True)[
            :20
        ]

    def inject_context(
        self,
        task: str,
        context: Optional[dict[str, Any]] = None,
    ) -> str:
        skills = self.get_contextual_skills(task)

        context_parts = []
        for skill in skills:
            context_parts.append(f"Skill: {skill.name}\n{skill.strategy}")
            if skill.examples:
                context_parts.append(f"Example: {skill.examples[0]}")
            context_parts.append("")

        return "\n\n".join(context_parts)

    def learn(
        self,
        task: str,
        result: str,
        success: bool,
        context: Optional[dict[str, Any]] = None,
        agent_output: Optional[AgentOutput] = None,
        ground_truth: Optional[str] = None,
        feedback: Optional[str] = None,
    ) -> None:
        if self._current_context is None:
            if context:
                self._current_context = ProjectContext(
                    language=context.get("language"),
                    framework=context.get("framework"),
                    project_type=context.get("project_type"),
                    project_path=Path.cwd(),
                )
            else:
                self.detect_project_context()

        if agent_output is None:
            from ace.roles import AgentOutput

            agent_output = AgentOutput(
                reasoning="Task completed" if success else "Task failed",
                final_answer=result,
                skill_ids=[],
            )

        reflection = self.reflector.reflect(
            question=task,
            agent_output=agent_output,
            skillbook=self.skillbook,
            ground_truth=ground_truth,
            feedback=feedback,
        )

        output = self.skill_manager.update_skills(
            reflection=reflection,
            skillbook=self.skillbook,
            question_context=f"Task: {task}",
            progress=f"Success: {success}",
        )

        self.skillbook.apply_update_with_context(
            update=output.update,
            context=self._current_context,
            route_new_skills=True,
        )

    def get_skillbook_stats(self) -> dict[str, Any]:
        from ace.skillbook import Skill as ACESkill
        from .skill_ext import ContextAwareSkill

        total = 0
        global_count = 0
        language_count = 0
        framework_count = 0
        project_count = 0

        for skill in self.skillbook._skills.values():
            total += 1
            if isinstance(skill, ContextAwareSkill):
                if skill.hierarchy_level == "global":
                    global_count += 1
                elif skill.hierarchy_level == "language":
                    language_count += 1
                elif skill.hierarchy_level == "framework":
                    framework_count += 1
                elif skill.hierarchy_level == "project":
                    project_count += 1
            else:
                global_count += 1

        return {
            "total": total,
            "global": global_count,
            "language": language_count,
            "framework": framework_count,
            "project": project_count,
        }

    def save_all(self) -> None:
        pass
