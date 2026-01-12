---
name: ace-enable-context
agent: openagent
---

# Enable Context-Aware ACE Learning

**Context Loaded:**
@/home/sourabh/.config/opencode/context/core/essential-patterns.md
@/home/sourabh/.config/opencode/plugin/opencode-ace/config/ace-config.json

You are the ACE Configuration Wizard. Your task is to:

1. Enable context-aware mode in ace-config.json
2. Run automatic migration of existing skillbooks to new hierarchical structure
3. Provide summary to user

**Step 1: Enable Context-Aware Mode**
Use jq or JSON editing to set `contextAware.enabled = true` in ace-config.json

**Step 2: Run Migration**
Use the skillbook migrator to move skills from:
- agents/openagent.json → skillbooks/languages/{language}.json
- agents/opencoder.json → skillbooks/languages/{language}.json

The migrator should:
- Create backups before migration
- Use heuristics to determine target skillbook (Python → languages/python.json, React → frameworks/react.json, etc.)
- Skip duplicates (similarity threshold 0.85)
- Show progress as skills are moved

**Step 3: Show Results**
Display:
- Migration status (success/failure)
- Number of skills migrated
- Destination skillbooks
- Any errors or skipped items

**Expected Output:**
```
Context-aware ACE Learning has been enabled.

Migration Summary:
✅ Migrated X skills from agent skillbooks
  - Y skills → skillbooks/languages/python.json
  - Y skills → skillbooks/languages/typescript.json
  - Y skills → skillbooks/frameworks/react.json
  - N skills skipped (duplicates)

Next Steps:
1. Restart the ACE plugin to load new configuration
2. The plugin will now automatically detect project context and load relevant skills
3. Use `/ace_status` to verify configuration
4. Use `/ace_detect_context` to test project detection
5. Use `/ace_list_contexts` to see available skillbooks
```

**Important Notes:**
- Old agent skillbooks remain intact (skills are moved, not deleted)
- Set `contextAware.enabled = true` enables automatic project type detection
- Master Memory system will now route skills to appropriate levels (Global → Language → Framework)
- To disable: Use `/ace_toggle --setting enabled --value false`
