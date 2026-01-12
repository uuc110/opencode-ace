---
description: Clear all skills from an agent's skillbook
---

You are clearing an agent's skillbook.

**WARNING:** This action will permanently delete all learned skills for the specified agent.

**Arguments:** $ARGUMENTS

Parse the arguments to extract the agent ID.

Before executing:
1. Confirm with the user that they want to clear all skills
2. Show how many skills will be deleted
3. Only proceed if the user confirms

Use the `ace_clear` tool with confirm=true only after user confirmation.
