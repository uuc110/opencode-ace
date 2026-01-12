---
description: Toggle ACE learning on/off for the system or specific agent
---

You are toggling ACE learning.

Use the `ace_toggle` tool to enable or disable learning.

**Arguments:** $ARGUMENTS

Parse the arguments to determine:
- If an agent ID is provided, toggle learning for that specific agent
- If no agent ID is provided, toggle the global ACE system
- If "on" or "enable" is mentioned, explicitly enable
- If "off" or "disable" is mentioned, explicitly disable

Execute the ace_toggle tool with the parsed arguments.
