#!/usr/bin/env python3
import json
import sys
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
from dataclasses import dataclass, field, asdict
from difflib import SequenceMatcher


def string_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


@dataclass
class Skill:
    id: str
    section: str
    content: str
    helpful: int = 0
    harmful: int = 0
    neutral: int = 0
    createdAt: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updatedAt: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    # Context tags for hierarchical memory
    language: Optional[str] = None
    framework: Optional[str] = None
    projectType: Optional[str] = None


class SkillbookManager:
    def __init__(self, base_path: str):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

        self.global_dir = self.base_path / "global"
        self.agents_dir = self.base_path / "agents"
        self.sessions_dir = self.base_path / "sessions"

        for dir_path in [self.global_dir, self.agents_dir, self.sessions_dir]:
            dir_path.mkdir(exist_ok=True)

    def load_skillbook(self, skillbook_path: str) -> list[Skill]:
        full_path = self.base_path / skillbook_path
        try:
            with open(full_path, "r") as f:
                data = json.load(f)
                return [Skill(**s) for s in data.get("skills", [])]
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    def save_skillbook(self, skillbook_path: str, skills: list[Skill]) -> bool:
        full_path = self.base_path / skillbook_path
        full_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            data = {
                "version": "1.0.0",
                "updatedAt": datetime.now(timezone.utc).isoformat(),
                "skills": [asdict(s) for s in skills],
            }
            with open(full_path, "w") as f:
                json.dump(data, f, indent=2)
            return True
        except Exception:
            return False

    def find_similar_skill(
        self, skills: list[Skill], content: str, threshold: float = 0.85
    ) -> Optional[Skill]:
        for skill in skills:
            if string_similarity(skill.content, content) >= threshold:
                return skill
        return None

    def add_skill(
        self,
        skillbook_path: str,
        section: str,
        content: str,
        deduplicate: bool = True,
        similarity_threshold: float = 0.85,
        language: Optional[str] = None,
        framework: Optional[str] = None,
        project_type: Optional[str] = None,
    ) -> tuple[Skill, bool]:
        skills = self.load_skillbook(skillbook_path)

        if deduplicate:
            existing = self.find_similar_skill(skills, content, similarity_threshold)
            if existing:
                existing.updatedAt = datetime.now(timezone.utc).isoformat()
                self.save_skillbook(skillbook_path, skills)
                return existing, False

        next_id = 1
        for skill in skills:
            if skill.section == section:
                try:
                    current_num = int(skill.id.split("-")[-1])
                    next_id = max(next_id, current_num + 1)
                except (ValueError, IndexError):
                    pass

        new_skill = Skill(
            id=f"{section}-{next_id:05d}",
            section=section,
            content=content,
            helpful=0,
            harmful=0,
            neutral=0,
            language=language,
            framework=framework,
            project_type=project_type,
        )

        skills.append(new_skill)
        self.save_skillbook(skillbook_path, skills)

        return new_skill, True

    def tag_skill(
        self, skillbook_path: str, skill_id: str, tag: str, increment: int = 1
    ) -> Optional[Skill]:
        if tag not in ("helpful", "harmful", "neutral"):
            return None

        skills = self.load_skillbook(skillbook_path)

        for skill in skills:
            if skill.id == skill_id:
                current = getattr(skill, tag)
                setattr(skill, tag, current + increment)
                skill.updatedAt = datetime.now(timezone.utc).isoformat()
                self.save_skillbook(skillbook_path, skills)
                return skill

        return None

    def update_skill(
        self,
        skillbook_path: str,
        skill_id: str,
        content: str,
        language: Optional[str] = None,
        framework: Optional[str] = None,
        project_type: Optional[str] = None,
    ) -> Optional[Skill]:
        skills = self.load_skillbook(skillbook_path)

        for skill in skills:
            if skill.id == skill_id:
                skill.content = content
                skill.updatedAt = datetime.now(timezone.utc).isoformat()
                if language:
                    skill.language = language
                if framework:
                    skill.framework = framework
                if project_type:
                    skill.project_type = project_type
                self.save_skillbook(skillbook_path, skills)
                return skill
        return None

    def remove_skill(self, skillbook_path: str, skill_id: str) -> bool:
        skills = self.load_skillbook(skillbook_path)
        original_len = len(skills)

        skills = [s for s in skills if s.id != skill_id]

        if len(skills) < original_len:
            self.save_skillbook(skillbook_path, skills)
            return True

        return False

    def get_stats(self, skillbook_path: str) -> dict:
        skills = self.load_skillbook(skillbook_path)
        sections = list(set(s.section for s in skills))

        return {
            "totalSkills": len(skills),
            "helpfulSkills": sum(1 for s in skills if s.helpful > s.harmful),
            "harmfulSkills": sum(1 for s in skills if s.harmful > s.helpful),
            "neutralSkills": sum(1 for s in skills if s.helpful == s.harmful),
            "sections": sections,
        }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No arguments provided"}))
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON arguments"}))
        sys.exit(1)

    action = args.get("action", "stats")
    base_path = args.get("basePath", "./skillbooks")
    skillbook_path = args.get("skillbookPath", "global/global.json")

    manager = SkillbookManager(base_path)

    if action == "stats":
        result = manager.get_stats(skillbook_path)
        print(json.dumps(result))

    elif action == "add":
        section = args.get("section", "general")
        content = args.get("content", "")
        deduplicate = args.get("deduplicate", True)
        threshold = args.get("similarityThreshold", 0.85)
        skill, is_new = manager.add_skill(
            skillbook_path, section, content, deduplicate, threshold
        )
        result = asdict(skill)
        result["isNew"] = is_new
        print(json.dumps(result))

    elif action == "tag":
        skill_id = args.get("skillId")
        tag = args.get("tag")
        increment = args.get("increment", 1)
        skill = manager.tag_skill(skillbook_path, skill_id, tag, increment)
        if skill:
            print(json.dumps(asdict(skill)))
        else:
            print(json.dumps({"error": "Skill not found or invalid tag"}))

    elif action == "update":
        skill_id = args.get("skillId")
        content = args.get("content")
        skill = manager.update_skill(skillbook_path, skill_id, content)
        if skill:
            print(json.dumps(asdict(skill)))
        else:
            print(json.dumps({"error": "Skill not found"}))

    elif action == "remove":
        skill_id = args.get("skillId")
        success = manager.remove_skill(skillbook_path, skill_id)
        print(json.dumps({"success": success}))

    elif action == "load":
        skills = manager.load_skillbook(skillbook_path)
        print(json.dumps({"skills": [asdict(s) for s in skills]}))

    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
