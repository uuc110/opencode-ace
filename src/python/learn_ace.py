import sys
import json
from pathlib import Path
from ace.roles import AgentOutput
from ace_opencode.integration import ACEOpenCodeIntegration


def main():
    args = json.loads(sys.argv[1])

    integration = ACEOpenCodeIntegration()

    task = args.get("task", "")
    result = args.get("result", "")
    success = args.get("success", True)

    agent_output = AgentOutput(
        reasoning=result if success else f"Failed: {result}",
        final_answer=result,
        skill_ids=[],
    )

    context = args.get("context")
    if context:
        from ace_opencode.skillbook_ext import ProjectContext

        integration._current_context = ProjectContext(
            language=context.get("language"),
            framework=context.get("framework"),
            project_type=context.get("project_type"),
            project_path=Path.cwd(),
        )
    else:
        integration.detect_project_context()

    try:
        integration.learn(
            task=task,
            result=result,
            success=success,
            agent_output=agent_output,
        )

        stats = integration.get_skillbook_stats()

        output = {
            "success": True,
            "newSkillsAdded": 1,
            "stats": stats,
        }

        print(json.dumps(output))
    except Exception as e:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": str(e),
                }
            )
        )


if __name__ == "__main__":
    main()
