import type { Plugin } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { createOpencodeClient } from '@opencode-ai/sdk';
import { applyReflection, shouldLearnNow } from './learning.js';
import { ProjectDetector, type ProjectContext } from './project-detection.js';
import { MasterMemoryRouter, type SkillbookHierarchy, type RoutingRules } from './master-memory.js';
import path from 'path';
import { spawn } from 'child_process';

export interface AceConfig {
  enabled: boolean;
  aceModel: string;
  asyncLearning: boolean;
  autoInjectContext: boolean;
  autoLearn: boolean;
  agents: Record<string, AgentConfig>;
  skillbookSettings: SkillbookSettings;
  paths: PathSettings;
}

export interface AgentConfig {
  enabled: boolean;
  skillbook: string;
  useGlobalSkillbook: boolean;
  learningMode: 'sync' | 'async';
}

export interface SkillbookSettings {
  autoSave: boolean;
  saveInterval: number;
  maxSkillsPerSection: number;
  deduplication: {
    enabled: boolean;
    similarityThreshold: number;
  };
}

export interface PathSettings {
  skillbooks: string;
  pythonModule: string;
}

export interface Skill {
  id: string;
  section: string;
  content: string;
  helpful: number;
  harmful: number;
  neutral: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillbookStats {
  totalSkills: number;
  helpfulSkills: number;
  harmfulSkills: number;
  neutralSkills: number;
  sections: string[];
}

export interface PythonResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface SessionState {
  agentId: string;
  contextInjected: boolean;
  messageCount: number;
  lastLearningTime?: number;
  learningCount?: number;
  errorDetected?: boolean;
  projectContext?: ProjectContext;
}

const activeSessions = new Map<string, SessionState>();
let cachedDetector: ProjectDetector | null = null;
let cachedRouter: MasterMemoryRouter | null = null;

async function loadAceConfig(): Promise<AceConfig> {
  const configPath = path.join(import.meta.dir, '..', 'config', 'ace-config.json');
  try {
    const content = await Bun.file(configPath).text();
    return JSON.parse(content);
  } catch {
    return {
      enabled: true,
      aceModel: 'gpt-4o-mini',
      asyncLearning: true,
      autoInjectContext: true,
      autoLearn: true,
      agents: {
        openagent: {
          enabled: true,
          skillbook: 'agents/openagent.json',
          useGlobalSkillbook: true,
          learningMode: 'async',
        },
        opencoder: {
          enabled: true,
          skillbook: 'agents/opencoder.json',
          useGlobalSkillbook: true,
          learningMode: 'async',
        },
      },
      skillbookSettings: {
        autoSave: true,
        saveInterval: 10,
        maxSkillsPerSection: 50,
        deduplication: {
          enabled: true,
          similarityThreshold: 0.85,
        },
      },
      paths: {
        skillbooks: './skillbooks',
        pythonModule: './src/python',
      },
    };
  }
}

function getProjectDetector(config: AceConfig): ProjectDetector {
  if (!cachedDetector) {
    const detectionConfig = (config as any).detectionRules || {
      languages: [],
      frameworks: [],
      projectTypes: []
    };
    cachedDetector = new ProjectDetector(detectionConfig);
  }
  return cachedDetector;
}

function getMasterMemoryRouter(config: AceConfig): { router: MasterMemoryRouter; hierarchy: SkillbookHierarchy } | null {
  if (!cachedRouter) {
    const hierarchy = (config as any).skillbookHierarchy;
    const routingRules = (config as any).routingRules;
    const promotionRules = (config as any).promotionRules;
    
    if (hierarchy && routingRules && promotionRules) {
      const router = new MasterMemoryRouter(hierarchy, routingRules, { promotionRules });
      cachedRouter = { router, hierarchy };
    }
  }
  return cachedRouter;
}

async function saveAceConfig(config: AceConfig): Promise<void> {
  const configPath = path.join(import.meta.dir, '..', 'config', 'ace-config.json');
  await Bun.write(configPath, JSON.stringify(config, null, 2));
}

async function callPython(script: string, args: Record<string, unknown> = {}): Promise<PythonResult> {
  const pythonPath = path.join(import.meta.dir, 'python', script);
  const venvPython = path.join(import.meta.dir, '..', '.venv', 'bin', 'python3');
  const pythonCmd = (await Bun.file(venvPython).exists()) ? venvPython : 'python3';

  return new Promise((resolve) => {
    const proc = spawn(pythonCmd, [pythonPath, JSON.stringify(args)], {
      cwd: path.join(import.meta.dir, '..'),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const data = JSON.parse(stdout.trim());
          resolve({ success: true, data });
        } catch {
          resolve({ success: true, data: stdout.trim() });
        }
      } else {
        resolve({ success: false, error: stderr || `Process exited with code ${code}` });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

async function callPythonAsync(script: string, args: Record<string, unknown> = {}): Promise<void> {
  const pythonPath = path.join(import.meta.dir, 'python', script);
  const venvPython = path.join(import.meta.dir, '..', '.venv', 'bin', 'python3');
  const pythonCmd = (await Bun.file(venvPython).exists()) ? venvPython : 'python3';

  const proc = spawn(pythonCmd, [pythonPath, JSON.stringify(args)], {
    cwd: path.join(import.meta.dir, '..'),
    detached: true,
    stdio: 'ignore',
  });

  proc.unref();
}

async function loadSkillbook(skillbookPath: string): Promise<Skill[]> {
  const fullPath = path.join(import.meta.dir, '..', 'skillbooks', skillbookPath);
  try {
    const content = await Bun.file(fullPath).text();
    const data = JSON.parse(content);
    return data.skills || [];
  } catch {
    return [];
  }
}

async function saveSkillbook(skillbookPath: string, skills: Skill[]): Promise<boolean> {
  const fullPath = path.join(import.meta.dir, '..', 'skillbooks', skillbookPath);
  try {
    const data = {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      skills,
    };
    await Bun.write(fullPath, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

function getSkillbookStats(skills: Skill[]): SkillbookStats {
  const sections = [...new Set(skills.map((s) => s.section))];
  return {
    totalSkills: skills.length,
    helpfulSkills: skills.filter((s) => s.helpful > s.harmful).length,
    harmfulSkills: skills.filter((s) => s.harmful > s.helpful).length,
    neutralSkills: skills.filter((s) => s.helpful === s.harmful).length,
    sections,
  };
}

function formatContextAwareContext(skills: Skill[], sources: string[]): string {
  const helpfulSkills = skills
    .filter((s) => s.helpful > s.harmful)
    .sort((a, b) => (b.helpful - b.harmful) - (a.helpful - a.harmful));

  if (helpfulSkills.length === 0) return '';

  const lines: string[] = [];
  lines.push('## ACE Learned Strategies (Context-Aware)');
  lines.push('');
  lines.push(`Sources: ${sources.join(' + ')}`);
  lines.push('');
  lines.push('These patterns have been learned from past executions in similar contexts:');
  lines.push('');

  for (const skill of helpfulSkills.slice(0, 15)) {
    lines.push(`- [${skill.id}] ${skill.content}`);
  }

  lines.push('');
  lines.push('Apply these patterns where relevant to current task.');

  return lines.join('\n');
}

function getMasterMemoryRouter(config: AceConfig): { router: MasterMemoryRouter; hierarchy: SkillbookHierarchy } | null {
  if (!cachedRouter) {
    const hierarchy = (config as any).skillbookHierarchy;
    const routingRules = (config as any).routingRules;
    const promotionRules = (config as any).promotionRules;
    
    if (hierarchy && routingRules && promotionRules) {
      const router = new MasterMemoryRouter(hierarchy, routingRules, { promotionRules });
      cachedRouter = { router, hierarchy };
    }
  }
  return cachedRouter;
}

async function getSkillbookContext(config: AceConfig, agentId: string): Promise<string> {
  const agentConfig = config.agents[agentId];
  if (!agentConfig) return '';

  const skills = await loadSkillbook(agentConfig.skillbook);
  const globalSkills = agentConfig.useGlobalSkillbook ? await loadSkillbook('global/global.json') : [];

  const allSkills = [...globalSkills, ...skills];
  if (allSkills.length === 0) return '';

  const helpfulSkills = allSkills.filter((s) => s.helpful > s.harmful).sort((a, b) => b.helpful - a.helpful);

  if (helpfulSkills.length === 0) return '';

  const lines: string[] = [];
  lines.push('## ACE Learned Strategies');
  lines.push('');
  lines.push('These patterns have been learned from successful past executions:');
  lines.push('');

  for (const skill of helpfulSkills.slice(0, 15)) {
    lines.push(`- [${skill.id}] ${skill.content}`);
  }

  lines.push('');
  lines.push('Apply these patterns where relevant to the current task.');

  return lines.join('\n');
}

async function triggerLearning(
  config: AceConfig,
  sessionState: SessionState,
  properties: { content: string; userMessage: string; role: string }
): Promise<void> {
  const agentConfig = config.agents[sessionState.agentId];
  if (!agentConfig?.enabled || !config.enabled) return;

  const shouldLearn = await shouldLearnNow(sessionState, config, properties);

  if (shouldLearn.learn) {
    await applyReflection(
      config,
      sessionState.agentId,
      shouldLearn.task!,
      shouldLearn.result!,
      shouldLearn.success!,
      sessionState
    );
  }
}

let eventListenerRetryCount = 0;
const MAX_RETRIES = 5;

async function startEventListener(config: AceConfig): Promise<void> {
  if (!config.enabled || (!config.autoInjectContext && !config.autoLearn)) {
    return;
  }

  if (eventListenerRetryCount >= MAX_RETRIES) {
    console.error('[ACE] Max retries reached. Giving up on event listener.');
    eventListenerRetryCount = 0;
    return;
  }

  try {
    const client = createOpencodeClient({ baseUrl: 'http://localhost:4096' });

    console.log('[ACE] Connecting to OpenCode events at http://localhost:4096...');
    const events = await client.event.subscribe();
    eventListenerRetryCount = 0;

    for await (const event of events.stream) {
      await handleEvent(client, config, event).catch(() => {});
    }
  } catch (error) {
    eventListenerRetryCount++;
    console.log(`[ACE] Connection attempt ${eventListenerRetryCount}/${MAX_RETRIES} failed:`, error);

    if (eventListenerRetryCount < MAX_RETRIES) {
      const delay = Math.min(eventListenerRetryCount * 2000, 30000);
      console.log(`[ACE] Retrying in ${delay}ms...`);
      setTimeout(() => startEventListener(config), delay);
    } else {
      console.error('[ACE] Max connection retries reached. Event listener not started.');
      eventListenerRetryCount = 0;
    }
  }
}

async function handleEvent(
  client: ReturnType<typeof createOpencodeClient>,
  config: AceConfig,
  event: { type: string; properties: Record<string, unknown> }
): Promise<void> {
  const { type, properties } = event;

  if (type === 'session.created' || type === 'session.started') {
    const sessionId = properties.sessionId as string;
    const agentId = (properties.agentId as string) || 'openagent';
    const workDir = (properties.workDir as string) || process.cwd();

    let projectContext: ProjectContext | undefined;
    
    if ((config as any).contextAware?.enabled) {
      const detector = getProjectDetector(config);
      projectContext = await detector.detect(workDir, properties as Record<string, unknown>);
      
      console.log('[ACE] Detected context:', {
        language: projectContext.language,
        framework: projectContext.framework,
        projectType: projectContext.projectType,
        confidence: Math.round((projectContext.confidence || 0) * 100) + '%',
        detectionMethod: projectContext.detectionMethod
      });
    }
    
    activeSessions.set(sessionId, {
      agentId,
      contextInjected: false,
      messageCount: 0,
      projectContext
    });

    if (config.autoInjectContext && config.agents[agentId]?.enabled) {
      let context: string;
      
      if ((config as any).contextAware?.enabled && projectContext) {
        const router = getMasterMemoryRouter(config);
        const { skills, sources } = await router.router.loadMasterContext(projectContext);
        context = formatContextAwareContext(skills, sources);
        console.log(`[ACE] Context sources: ${sources.join(' + ')}`);
      } else {
        context = await getSkillbookContext(config, agentId);
      }
      
      if (context) {
        await client.session.prompt({
          path: { id: sessionId },
          body: {
            noReply: true,
            parts: [{ type: 'text', text: context }],
          },
        });

        const session = activeSessions.get(sessionId);
        if (session) {
          session.contextInjected = true;
        }
      }
    }
  }

  if (type === 'message.created' && properties.role === 'user') {
    const sessionId = properties.sessionId as string;
    const session = activeSessions.get(sessionId);

    if (session && !session.contextInjected && config.autoInjectContext) {
      const context = await getSkillbookContext(config, session.agentId);
      if (context) {
        await client.session.prompt({
          path: { id: sessionId },
          body: {
            noReply: true,
            parts: [{ type: 'text', text: context }],
          },
        });
        session.contextInjected = true;
      }
    }

    if (session) {
      session.messageCount++;
    }
  }

  if (type === 'message.completed' && properties.role === 'assistant') {
    const sessionId = properties.sessionId as string;
    const session = activeSessions.get(sessionId);

    if (session && config.autoLearn) {
      const content = properties.content as string;
      const userMessage = properties.userMessage as string;

      if (content && userMessage) {
        await triggerLearning(config, session, properties);
      }
    }
  }

  if (type === 'session.ended' || type === 'session.deleted') {
    const sessionId = properties.sessionId as string;
    activeSessions.delete(sessionId);
  }
}

export const AcePlugin: Plugin = async () => {
  const config = await loadAceConfig();

  startEventListener(config).catch(() => {});

  const aceStatusTool = tool({
    description: 'Get ACE status and skillbook statistics',
    args: {
      agentId: tool.schema.string().optional().describe('Specific agent ID to check'),
    },
    async execute(args) {
      const currentConfig = await loadAceConfig();
      if (!currentConfig.enabled) {
        return 'ACE is disabled. Use /ace-toggle to enable.';
      }

      const results: string[] = [];
      results.push('=== ACE System Status ===');
      results.push(`Status: ${currentConfig.enabled ? 'Enabled' : 'Disabled'}`);
      results.push(`Auto-Inject Context: ${currentConfig.autoInjectContext ? 'Yes' : 'No'}`);
      results.push(`Auto-Learn: ${currentConfig.autoLearn ? 'Yes' : 'No'}`);
      results.push(`Learning Mode: ${currentConfig.asyncLearning ? 'Async' : 'Sync'}`);
      results.push(`Active Sessions: ${activeSessions.size}`);
      results.push('');

      const globalSkills = await loadSkillbook('global/global.json');
      const globalStats = getSkillbookStats(globalSkills);
      results.push('=== Global Skillbook ===');
      results.push(`Total: ${globalStats.totalSkills} | Helpful: ${globalStats.helpfulSkills} | Harmful: ${globalStats.harmfulSkills}`);
      results.push('');

      const agentsToCheck = args.agentId ? [args.agentId] : Object.keys(currentConfig.agents);

      for (const agentId of agentsToCheck) {
        const agentConfig = currentConfig.agents[agentId];
        if (!agentConfig) continue;

        const skills = await loadSkillbook(agentConfig.skillbook);
        const stats = getSkillbookStats(skills);

        results.push(`=== ${agentId} ===`);
        results.push(`Learning: ${agentConfig.enabled ? 'On' : 'Off'} | Skills: ${stats.totalSkills} | Helpful: ${stats.helpfulSkills}`);
      }

      return results.join('\n');
    },
  });

  const aceInspectTool = tool({
    description: 'Inspect skills in an agent skillbook',
    args: {
      agentId: tool.schema.string().describe('Agent ID to inspect'),
      section: tool.schema.string().optional().describe('Filter by section'),
      limit: tool.schema.number().optional().describe('Limit results (default: 10)'),
    },
    async execute(args) {
      const currentConfig = await loadAceConfig();
      const agentConfig = currentConfig.agents[args.agentId];
      if (!agentConfig) {
        return `Agent "${args.agentId}" not found. Available: ${Object.keys(currentConfig.agents).join(', ')}`;
      }

      let skills = await loadSkillbook(agentConfig.skillbook);

      if (args.section) {
        skills = skills.filter((s) => s.section === args.section);
      }

      skills.sort((a, b) => (b.helpful - b.harmful) - (a.helpful - a.harmful));
      skills = skills.slice(0, args.limit || 10);

      if (skills.length === 0) {
        return `No skills found for "${args.agentId}"`;
      }

      const results: string[] = [`=== ${args.agentId} Skills (${skills.length}) ===`, ''];

      for (const skill of skills) {
        const score = skill.helpful - skill.harmful;
        const indicator = score > 0 ? '✓' : score < 0 ? '✗' : '○';
        results.push(`${indicator} [${skill.id}] Score: ${score >= 0 ? '+' : ''}${score}`);
        results.push(`  ${skill.content}`);
        results.push('');
      }

      return results.join('\n');
    },
  });

  const aceToggleTool = tool({
    description: 'Toggle ACE settings',
    args: {
      setting: tool.schema.enum(['enabled', 'autoInject', 'autoLearn']).optional().describe('Setting to toggle'),
      agentId: tool.schema.string().optional().describe('Toggle specific agent'),
      value: tool.schema.boolean().optional().describe('Explicit value'),
    },
    async execute(args) {
      const currentConfig = await loadAceConfig();

      if (args.agentId) {
        const agentConfig = currentConfig.agents[args.agentId];
        if (!agentConfig) {
          return `Agent "${args.agentId}" not found.`;
        }
        const newValue = args.value ?? !agentConfig.enabled;
        currentConfig.agents[args.agentId].enabled = newValue;
        await saveAceConfig(currentConfig);
        return `${args.agentId} learning: ${newValue ? 'enabled' : 'disabled'}`;
      }

      const setting = args.setting || 'enabled';
      if (setting === 'enabled') {
        currentConfig.enabled = args.value ?? !currentConfig.enabled;
        await saveAceConfig(currentConfig);
        return `ACE: ${currentConfig.enabled ? 'enabled' : 'disabled'}`;
      }
      if (setting === 'autoInject') {
        currentConfig.autoInjectContext = args.value ?? !currentConfig.autoInjectContext;
        await saveAceConfig(currentConfig);
        return `Auto-inject context: ${currentConfig.autoInjectContext ? 'enabled' : 'disabled'}`;
      }
      if (setting === 'autoLearn') {
        currentConfig.autoLearn = args.value ?? !currentConfig.autoLearn;
        await saveAceConfig(currentConfig);
        return `Auto-learn: ${currentConfig.autoLearn ? 'enabled' : 'disabled'}`;
      }

      return 'Unknown setting';
    },
  });

  const aceDetectContextTool = tool({
    description: 'Detect current project context (language, framework, type)',
    args: {},
    async execute(args) {
      const currentConfig = await loadAceConfig();
      if (!(currentConfig as any).contextAware?.enabled) {
        return 'Context-aware mode is disabled. Use /ace-toggle to enable.';
      }

      const workDir = process.cwd();
      const detector = getProjectDetector(currentConfig);
      const context = await detector.detect(workDir);

      return `Project Context:
    - Language: ${context.language || 'Unknown'}
    - Framework: ${context.framework || 'Unknown'}
    - Project Type: ${context.projectType || 'Unknown'}
    - Confidence: ${Math.round((context.confidence || 0) * 100)}%
    - Detection Method: ${context.detectionMethod}
    - Detected: ${context.detectedAt}`;
    }
  });

  const aceListContextsTool = tool({
    description: 'List available project contexts and skill counts',
    args: {},
    async execute(args) {
      const currentConfig = await loadAceConfig();
      const hierarchy = (currentConfig as any).skillbookHierarchy;

      const results: string[] = [];
      results.push('=== Available Skillbooks ===');
      results.push(`Master/Universal: ${hierarchy.global.universal}`);
      results.push('');
      results.push('Languages:');
      for (const [name, path] of Object.entries(hierarchy.languages || {})) {
        const skills = await loadSkillbook(path);
        results.push(`  ${name}: ${skills.length} skills`);
      }
      results.push('');
      results.push('Frameworks:');
      for (const [name, path] of Object.entries(hierarchy.frameworks || {})) {
        const skills = await loadSkillbook(path);
        results.push(`  ${name}: ${skills.length} skills`);
      }

      return results.join('\n');
    }
  });

  const aceClearTool = tool({
    description: 'Clear an agent skillbook',
    args: {
      agentId: tool.schema.string().describe('Agent ID to clear'),
      confirm: tool.schema.boolean().describe('Must be true to confirm'),
    },
    async execute(args) {
      if (!args.confirm) {
        return 'Set confirm=true to clear skillbook.';
      }

      const currentConfig = await loadAceConfig();
      const agentConfig = currentConfig.agents[args.agentId];
      if (!agentConfig) {
        return `Agent "${args.agentId}" not found.`;
      }

      const skills = await loadSkillbook(agentConfig.skillbook);
      const count = skills.length;
      await saveSkillbook(agentConfig.skillbook, []);

      return `Cleared ${count} skills from ${args.agentId}`;
    },
  });

  const aceExportTool = tool({
    description: 'Export skillbook to file',
    args: {
      agentId: tool.schema.string().describe('Agent ID to export'),
      outputPath: tool.schema.string().optional().describe('Output path'),
    },
    async execute(args) {
      const currentConfig = await loadAceConfig();
      const agentConfig = currentConfig.agents[args.agentId];
      if (!agentConfig) {
        return `Agent "${args.agentId}" not found.`;
      }

      const skills = await loadSkillbook(agentConfig.skillbook);
      const exportData = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        agentId: args.agentId,
        skills,
      };

      const outputPath = args.outputPath || path.join(import.meta.dir, '..', 'exports', `${args.agentId}-${Date.now()}.json`);
      const exportsDir = path.dirname(outputPath);
      await Bun.write(path.join(exportsDir, '.gitkeep'), '');
      await Bun.write(outputPath, JSON.stringify(exportData, null, 2));

      return `Exported ${skills.length} skills to: ${outputPath}`;
    },
  });

  const aceImportTool = tool({
    description: 'Import skillbook from file',
    args: {
      agentId: tool.schema.string().describe('Agent ID to import into'),
      inputPath: tool.schema.string().describe('Path to import file'),
      merge: tool.schema.boolean().optional().describe('Merge with existing'),
    },
    async execute(args) {
      const currentConfig = await loadAceConfig();
      const agentConfig = currentConfig.agents[args.agentId];
      if (!agentConfig) {
        return `Agent "${args.agentId}" not found.`;
      }

      try {
        const content = await Bun.file(args.inputPath).text();
        const importData = JSON.parse(content);
        const importedSkills: Skill[] = importData.skills || [];

        if (args.merge) {
          const existingSkills = await loadSkillbook(agentConfig.skillbook);
          const existingIds = new Set(existingSkills.map((s) => s.id));
          let added = 0;

          for (const skill of importedSkills) {
            if (!existingIds.has(skill.id)) {
              existingSkills.push(skill);
              added++;
            }
          }

          await saveSkillbook(agentConfig.skillbook, existingSkills);
          return `Merged ${added} skills (${importedSkills.length - added} duplicates skipped)`;
        }

        await saveSkillbook(agentConfig.skillbook, importedSkills);
        return `Imported ${importedSkills.length} skills (replaced existing)`;
      } catch (err) {
        return `Import failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  const aceLearnTool = tool({
    description: 'Manually trigger learning from a task',
    args: {
      agentId: tool.schema.string().describe('Agent ID'),
      task: tool.schema.string().describe('Task description'),
      result: tool.schema.string().describe('Result summary'),
      success: tool.schema.boolean().describe('Task succeeded'),
    },
    async execute(args) {
      const currentConfig = await loadAceConfig();
      if (!currentConfig.enabled) {
        return 'ACE is disabled.';
      }

      await triggerLearning(currentConfig, args.agentId, args.task, args.result, args.success);
      return `Learning triggered for ${args.agentId}`;
    },
  });

  const aceGetContextTool = tool({
    description: 'Get skillbook context for an agent',
    args: {
      agentId: tool.schema.string().describe('Agent ID'),
    },
    async execute(args) {
      const currentConfig = await loadAceConfig();
      return await getSkillbookContext(currentConfig, args.agentId);
    },
  });

  return {
    tool: {
      ace_status: aceStatusTool,
      ace_inspect: aceInspectTool,
      ace_toggle: aceToggleTool,
      ace_clear: aceClearTool,
      ace_export: aceExportTool,
      ace_import: aceImportTool,
      ace_learn: aceLearnTool,
      ace_get_context: aceGetContextTool,
      ace_detect_context: aceDetectContextTool,
      ace_list_contexts: aceListContextsTool
    },
  };
};

export default AcePlugin;
