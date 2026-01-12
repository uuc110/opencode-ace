#!/usr/bin/env python3
"""
OpenCode ACE Plugin - Learning Module

Uses OpenCode SDK directly for reflection and learning.
No external API keys needed - uses user's configured models.
"""

import json
import sys
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List

from .skillbook_manager import SkillbookManager, Skill


def format_reflector_prompt(task: str, result: str, success: bool) -> str:
    """
    Format prompt for Reflector role using OpenCode models.

    This is based on ACE v2.1 Reflector prompts, adapted for
    direct use with OpenCode API.
    """
    success_str = "Yes" if success else "No"

    return f"""You are the Reflector role from the Agentic Context Engine (ACE).
Your job is to analyze task execution and extract reusable patterns.

## QUICK REFERENCE
Role: ACE Reflector - Senior Analytical Reviewer
Mission: Diagnose generator performance and extract concrete learnings

## CORE MISSION
You are a senior reviewer who diagnoses generator performance through systematic analysis,
extracting concrete, actionable learnings from actual execution experiences
to improve future performance.

## INPUT ANALYSIS CONTEXT

### Performance Data
Question: {task}
Result: {result}
Success: {success_str}

## DIAGNOSTIC PROTOCOL

Execute systematic analysis:

### 1. Outcome Assessment
- Determine if execution succeeded or failed
- Identify what approach was used
- Note any errors or obstacles encountered

### 2. Pattern Extraction
- Extract 3-5 reusable patterns from the execution
- Each pattern must be:
  * Specific and actionable
  * Reference actual code, commands, file names, or techniques used
  * Include concrete examples (not vague advice)
  * Clearly indicate when to apply each pattern
  * Focus on reusable technical knowledge

### 3. Learning Analysis (if failed)
If the task failed:
- Error identification: What specifically went wrong
- Root cause analysis: Why it happened
- Correct approach: What should have been done instead
- Suggested action: How to fix it

## OUTPUT FORMAT

Provide a JSON response with this exact structure:
{{
  "reasoning": "Brief systematic explanation of what happened and why",
  "keyInsights": ["insight 1", "insight 2", "insight 3"],
  "patterns": [
    "Actionable pattern 1 - specific technique used",
    "Actionable pattern 2 - specific command or approach",
    "Actionable pattern 3 - specific code pattern or practice"
  ],
  "errorIdentified": "What went wrong (only if failed)",
  "rootCause": "Why it failed (only if failed)",
  "suggestedAction": "How to fix it (only if failed)"
}}

Return ONLY valid JSON, no markdown formatting, no extra text."""


async def reflect_with_opencode(
    task: str,
    result: str,
    success: bool,
    provider_id: str,
    model_id: str,
    base_url: str = "http://localhost:39905",
) -> dict:
    """
    Perform reflection using OpenCode SDK directly.

    Creates a temporary session, prompts the model with Reflector role,
    and returns the parsed JSON response.
    """
    try:
        from opencode_ai import AsyncOpencode
        import httpx

        client = AsyncOpencode(base_url=base_url)

        # Create temporary session for reflection
        session_response = await client.session.create(
            {"body": {"title": "ACE Reflection"}}
        )

        if not session_response.ok:
            return {
                "success": False,
                "error": f"Failed to create session: {session_response.status_code}",
            }

        session_id = session_response.parse().id
        prompt = format_reflector_prompt(task, result, success)

        # Call model with Reflector prompt
        prompt_response = await client.session.prompt(
            {
                "path": {"id": session_id},
                "body": {
                    "model": {"providerID": provider_id, "modelID": model_id},
                    "parts": [{"type": "text", "text": prompt}],
                },
            }
        )

        if not prompt_response.ok:
            return {
                "success": False,
                "error": f"Prompt failed: {prompt_response.status_code}",
            }

        # Parse JSON response
        content = prompt_response.parse().choices[0].message.content

        # Extract JSON from response (handle markdown code blocks)
        import re

        json_match = re.search(r"\{[\s\S]*\}", content)
        if not json_match:
            return {"success": False, "error": "No JSON found in model response"}

        reflection_data = json.loads(json_match.group(0))

        # Validate required fields
        required_fields = ["reasoning", "keyInsights", "patterns"]
        for field in required_fields:
            if field not in reflection_data:
                return {"success": False, "error": f"Missing required field: {field}"}

        # Clean up session
        await client.session.delete({"path": {"id": session_id}})

        return {
            "success": True,
            "reflection": reflection_data,
            "method": "opencode-sdk",
        }

    except ImportError:
        return {
            "success": False,
            "error": "opencode-ai package not installed. Run: pip install opencode-ai",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def learn_with_reflection_sync(
    agent_id: str,
    task: str,
    result: str,
    success: bool,
    reflection: str,
    skillbook_path: str,
) -> dict:
    """
    Store reflection results to skillbook (synchronous mode).

    Uses skillbook_manager for deduplication and storage.
    No LLM call needed - reflection data is pre-processed.
    """
    try:
        base_path = Path(skillbook_path).parent.parent
        relative_path = Path(skillbook_path).relative_to(base_path)
        manager = SkillbookManager(str(base_path))

        reflection_data = json.loads(reflection)

        skills_added = 0
        skills_updated = 0
        existing_skills = manager.load_skillbook(str(relative_path))

        for pattern in reflection_data.get("patterns", []):
            section = "success" if success else "failure"

            existing = manager.find_similar_skill(
                existing_skills, pattern, threshold=0.85
            )

            if existing:
                existing.updatedAt = datetime.now(timezone.utc).isoformat()
                manager.save_skillbook(str(relative_path), existing_skills)
                skills_updated += 1
            else:
                skill, is_new = manager.add_skill(
                    str(relative_path), section, pattern, deduplicate=False
                )
                if is_new:
                    skills_added += 1
                existing_skills = manager.load_skillbook(str(relative_path))

        return {
            "success": True,
            "skillsCount": len(existing_skills),
            "newSkillsAdded": skills_added,
            "skillsUpdated": skills_updated,
            "method": "reflection",
        }

    except Exception as e:
        return {"success": False, "error": str(e), "method": "reflection"}


def learn_with_reflection_async(
    agent_id: str,
    task: str,
    result: str,
    success: bool,
    reflection: str,
    skillbook_path: str,
) -> dict:
    """
    Store reflection results to skillbook (asynchronous mode).

    Forks to background to avoid blocking the main process.
    Returns immediately, does work in background.
    """
    import asyncio
    import subprocess

    # Prepare data for subprocess
    args_data = {
        "agentId": agent_id,
        "task": task,
        "result": result,
        "success": success,
        "reflection": reflection,
        "skillbookPath": skillbook_path,
        "mode": "reflection-only",
    }

    # Fork to background
    process = subprocess.Popen(
        [sys.executable, __file__, "learn_with_reflection_sync"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    process.stdin.write(json.dumps(args_data))
    process.stdin.close()

    return {
        "success": True,
        "message": "Learning initiated in background",
        "method": "reflection-async",
    }


def learn_with_reflection(
    agent_id: str,
    task: str,
    result: str,
    success: bool,
    reflection: str,
    skillbook_path: str,
    async_mode: bool = False,
) -> dict:
    """
    Learn from reflection data with sync/async mode selection.
    """
    if async_mode:
        return learn_with_reflection_async(
            agent_id, task, result, success, reflection, skillbook_path
        )
    else:
        import asyncio

        return asyncio.run(
            learn_with_reflection_sync(
                agent_id, task, result, success, reflection, skillbook_path
            )
        )


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No arguments provided"}))
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON arguments"}))
        sys.exit(1)

    agent_id = args.get("agentId", "unknown")
    task = args.get("task", "")
    result = args.get("result", "")
    success = args.get("success", True)
    reflection = args.get("reflection")
    mode = args.get("mode", "auto")
    skillbook_path = args.get("skillbookPath", "./skillbooks/agents/default.json")

    # Model configuration
    models = args.get(
        "learningModels",
        [
            {"providerID": "zai-coding-plan", "modelID": "glm-4.7"},
            {"providerID": "github-copilot", "modelID": "gemini-3-flash-preview"},
        ],
    )

    # Context information (new)
    context = args.get("context") if args.get("context") else {}

    if mode == "reflection-only" and reflection:
        if mode == "reflection-async" or args.get("asyncLearning", False):
            output = learn_with_reflection_async(
                agent_id, task, result, success, reflection, skillbook_path, context
            )
        else:
            output = learn_with_reflection(
                agent_id, task, result, success, reflection, skillbook_path, context
            )
    elif reflection:
        if mode == "reflection-async" or args.get("asyncLearning", False):
            output = learn_with_reflection_async(
                agent_id, task, result, success, reflection, skillbook_path, context
            )
        else:
            output = learn_with_reflection(
                agent_id, task, result, success, reflection, skillbook_path, context
            )
    else:
        # Fallback to simple mode (no reflection)
        from skillbook_manager import SkillbookManager

        base_path = Path(skillbook_path).parent.parent
        relative_path = Path(skillbook_path).relative_to(base_path)
        manager = SkillbookManager(str(base_path))

        section = "success" if success else "failure"
        content = f"Task: {task[:200]}. Result: {result[:200]}"
        if success:
            content = f"Successfully executed: {task[:300]}"
        else:
            content = f"Failed task pattern: {task[:200]}. Issue: {result[:100]}"

        skill, is_new = manager.add_skill(
            str(relative_path), section, content, **context
        )

        output = {
            "success": True,
            "skillId": skill.id,
            "isNew": is_new,
            "skillsCount": len(manager.load_skillbook(str(relative_path))),
            "method": "simple",
        }

        print(json.dumps(output))


if __name__ == "__main__":
    main()
