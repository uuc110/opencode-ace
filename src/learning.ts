import type { AceConfig, SessionState } from './index.js';
import { MasterMemoryRouter, type SkillbookHierarchy } from './master-memory.js';
import { createOpencodeClient } from '@opencode-ai/sdk';
import { spawn } from 'child_process';
import path from 'path';

let cachedRouter: { router: MasterMemoryRouter; hierarchy: SkillbookHierarchy } | null = null;

export interface ReflectorOutput {
  reasoning: string;
  keyInsights: string[];
  patterns: string[];
  errorIdentified?: string;
  rootCause?: string;
  suggestedAction?: string;
}

export interface LearningModels {
  providerID: string;
  modelID: string;
}

export interface LearningTriggers {
  intervalMinutes: number;
  onErrorResolution: boolean;
  onTaskCompletion: boolean;
  minMessagesForCompletion: number;
  maxLearningPerSession: number;
}

export interface SkillValidation {
  minLength: number;
  maxLength: number;
  requireEvidence: boolean;
  minAtomicityScore: number;
}

export interface PythonResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface LearningDecision {
  learn: boolean;
  task?: string;
  result?: string;
  success?: boolean;
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

function formatReflectorPrompt(task: string, result: string, success: boolean): string {
  return `You are Reflector role from Agentic Context Engine (ACE).
Your job is to analyze task execution and extract reusable patterns.

**Task:**
${task}

**Result:**
${result}

**Success:** ${success ? 'Yes' : 'No'}

Provide a JSON response with this exact structure:
{
  "reasoning": "Brief explanation of what happened and why",
  "keyInsights": ["insight 1", "insight 2", "insight 3"],
  "patterns": [
    "Actionable pattern 1 - specific technique used",
    "Actionable pattern 2 - specific command or approach",
    "Actionable pattern 3 - specific code pattern or practice"
  ],
  "errorIdentified": "What went wrong (only if failed)",
  "rootCause": "Why it failed (only if failed)",
  "suggestedAction": "How to fix it (only if failed)"
}

Requirements for patterns:
- Be specific and actionable
- Reference actual code, commands, file names, or techniques used
- Include concrete examples (not vague advice)
- Clearly indicate when to apply each pattern
- Focus on reusable technical knowledge

Return ONLY valid JSON, no markdown formatting, no extra text.`;
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

async function callPythonSync(script: string, args: Record<string, unknown> = {}): Promise<PythonResult> {
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

async function reflectAndExtract(
  task: string,
  result: string,
  success: boolean,
  config: AceConfig
): Promise<ReflectorOutput> {
  const client = createOpencodeClient({ baseUrl: 'http://localhost:4096' });

  const session = await client.session.create({
    body: {
      title: 'ACE Reflection',
    },
  });

  const models = (config as any).learningModels || [
    { providerID: 'zai-coding-plan', modelID: 'glm-4.7' },
    { providerID: 'github-copilot', modelID: 'gemini-3-flash-preview' },
  ];

  const prompt = formatReflectorPrompt(task, result, success);

  for (const model of models) {
    try {
      console.log(`[ACE] Using model: ${model.providerID}/${model.modelID}`);

      const response = await client.session.prompt({
        path: { id: session.data.id },
        body: {
          model: { providerID: model.providerID, modelID: model.modelID },
          parts: [{ type: 'text', text: prompt }],
        },
      });

      const content = response.data?.parts?.[0]?.text || (response as any).choices?.[0]?.message?.content || '';

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (
        !parsed.reasoning ||
        !Array.isArray(parsed.keyInsights) ||
        !Array.isArray(parsed.patterns)
      ) {
        throw new Error('Invalid reflection structure');
      }

      await client.session.delete({ path: { id: session.data.id } }).catch(() => {});

      console.log(`[ACE] Reflection successful: ${parsed.patterns.length} patterns extracted`);
      return parsed as ReflectorOutput;
    } catch (error) {
      console.log(
        `[ACE] Model ${model.providerID}/${model.modelID} failed:`,
        error instanceof Error ? error.message : String(error)
      );
      continue;
    }
  }

  await client.session.delete({ path: { id: session.data.id } }).catch(() => {});

  throw new Error('All learning models failed');
}

export function validateSkill(content: string, validation?: SkillValidation): {
  valid: boolean;
  reason?: string;
} {
  const config = validation || {
    minLength: 50,
    maxLength: 2000,
    requireEvidence: true,
    minAtomicityScore: 0.7,
  };

  const trimmed = content.trim();

  if (trimmed.length < config.minLength) {
    return { valid: false, reason: `Too short (${trimmed.length} chars, min ${config.minLength})` };
  }
  if (trimmed.length > config.maxLength) {
    return { valid: false, reason: `Too long (${trimmed.length} chars, max ${config.maxLength})` };
  }

  const genericPatterns = [
    /^use\s+npm\s+install$/i,
    /^run\s+test$/i,
    /^check\s+the\s+logs$/i,
    /^fix\s+the\s+error$/i,
    /^try\s+again$/i,
    /^restart\s+the\s+server$/i,
    /^delete\s+the\s+file$/i,
    /^read\s+the\s+documentation$/i,
  ];

  for (const pattern of genericPatterns) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: 'Too generic - lacks specificity' };
    }
  }

  if (config.requireEvidence) {
    const evidenceIndicators = [
      /[a-zA-Z0-9_\-]+\.(?:ts|js|tsx|jsx|py|go|rs|java|json|yaml|yml|toml|md|sql)/,
      /(?:npm|pip|cargo|go mod|yarn|bun|pnpm)\s+(?:install|add|remove|uninstall|update)/i,
      /(?:git|docker|kubectl|curl|wget|aws|gcloud)\s+[a-z0-9\-]+/i,
      /https?:\/\/[^\s<>"]+/,
      /--?[a-z0-9\-]+(?:=\w+|=["'][^"']*['])/i,
      /\b(?:function|class|interface|type|const|let|var|def|fn|struct|enum|impl)\s+\w+/i,
      /\b(?:import|export|require|from|include|use)\s+["'][^"']*['']/i,
      /\b[A-Z][a-zA-Z0-9]*\.(?:create|update|delete|save|load|get|set)/,
      /\b\d+\s*(?:bytes|KB|MB|GB|TB|ms|s|min|hr)/i,
    ];

    const hasEvidence = evidenceIndicators.some((p) => p.test(trimmed));
    if (!hasEvidence) {
      return { valid: false, reason: 'No technical evidence found (needs specific commands, code, or references)' };
    }
  }

  const sentences = trimmed.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length > 5) {
    return { valid: false, reason: `Not atomic (${sentences.length} sentences, should focus on one concept)` };
  }

  return { valid: true };
}

export async function backupSkillbook(skillbookPath: string): Promise<{
  success: boolean;
  backupPath?: string;
  error?: string;
}> {
  try {
    const fullSkillbookPath = path.join(import.meta.dir, '..', skillbookPath);

    const exists = await Bun.file(fullSkillbookPath).exists();
    if (!exists) {
      return { success: true };
    }

    const content = await Bun.file(fullSkillbookPath).text();

    const backupDir = path.join(import.meta.dir, '..', 'skillbooks', 'backups');
    await Bun.write(path.join(backupDir, '.gitkeep'), '');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const skillbookName = path.basename(skillbookPath, '.json');
    const backupName = `${skillbookName}-${timestamp}.json`;
    const backupPath = path.join(backupDir, backupName);

    await Bun.write(backupPath, content);

    await cleanupOldBackups(skillbookName, 10);

    console.log(`[ACE] Backed up skillbook to: ${backupPath}`);
    return { success: true, backupPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function cleanupOldBackups(skillbookName: string, keepCount: number): Promise<void> {
  try {
    const backupDir = path.join(import.meta.dir, '..', 'skillbooks', 'backups');

    const dir = await Bun.$`ls -t ${backupDir}/${skillbookName}-*.json 2>/dev/null || true`.text();
    const backupFiles = dir.split('\n').filter((f) => f.trim().length > 0);

    const filesToDelete = backupFiles.slice(keepCount);

    for (const oldFile of filesToDelete) {
      const oldPath = path.join(backupDir, oldFile);
      await Bun.file(oldPath).exists().then(exists => {
        if (exists) return Bun.$`rm ${oldPath}`;
      }).catch(() => {});
    }
  } catch {
    // Silently fail cleanup
  }
}

export async function shouldLearnNow(
  session: SessionState & { lastLearningTime?: number; learningCount?: number },
  config: AceConfig,
  properties: {
    content: string;
    userMessage: string;
    role: string;
  }
): Promise<LearningDecision> {
  const triggers = (config as any).learningTriggers || {
    intervalMinutes: 5,
    onErrorResolution: true,
    onTaskCompletion: true,
    minMessagesForCompletion: 3,
    maxLearningPerSession: 10,
  };

  const content = properties.content as string;
  const userMessage = properties.userMessage as string;

  const now = Date.now();
  const timeSinceLastLearn = session.lastLearningTime ? now - session.lastLearningTime : Infinity;

  const learningCount = session.learningCount || 0;
  const canLearnMore = learningCount < triggers.maxLearningPerSession;

  const timeBased = timeSinceLastLearn >= triggers.intervalMinutes * 60 * 1000;

  const justSucceeded =
    !content.toLowerCase().includes('error') && !content.toLowerCase().includes('failed');
  const errorResolution =
    session.errorDetected && justSucceeded && session.messageCount >= 2;

  const completionPhrases = [
    'done',
    'completed',
    'finished',
    'successfully',
    'implemented',
    'deployed',
    'ready',
    'complete',
  ];

  const completed =
    completionPhrases.some((p) => content.toLowerCase().includes(p)) &&
    session.messageCount >= triggers.minMessagesForCompletion;

  if ((timeBased || (triggers.onErrorResolution && errorResolution) || (triggers.onTaskCompletion && completed)) && canLearnMore) {
    console.log(`[ACE] Learning triggered: timeBased=${timeBased}, errorResolution=${errorResolution}, completed=${completed}`);

    session.learningCount = learningCount + 1;

    return {
      learn: true,
      task: userMessage.slice(0, 500),
      result: content.slice(0, 1000),
      success: justSucceeded,
    };
  }

  if (!justSucceeded) {
    session.errorDetected = true;
  } else {
    session.errorDetected = false;
  }

  return { learn: false };
}

export async function applyReflection(
  config: AceConfig,
  agentId: string,
  task: string,
  result: string,
  success: boolean,
  sessionState?: SessionState
): Promise<{ success: boolean; error?: string; skillsAdded?: number }> {
  try {
    console.log(`[ACE] Starting ACE learning for agent ${agentId}`);

    const pythonArgs = {
      task,
      result,
      success,
      context: sessionState?.projectContext ? {
        language: sessionState.projectContext.language,
        framework: sessionState.projectContext.framework,
        projectType: sessionState.projectContext.projectType
      } : undefined
    };

    const agentConfig = config.agents[agentId];
    const isAsync = config.asyncLearning || agentConfig?.learningMode === 'async';

    if (isAsync) {
      await callPythonAsync('learn_ace.py', pythonArgs);
      console.log('[ACE] Learning initiated (async)');
      return { success: true, skillsAdded: 0 };
    } else {
      const pythonResult = await callPythonSync('learn_ace.py', pythonArgs);
      if (!pythonResult.success) {
        throw new Error(pythonResult.error);
      }
      const data = pythonResult.data as any;
      console.log(`[ACE] Learning completed (sync): ${data.newSkillsAdded} skills added`);
      return { success: true, skillsAdded: data.newSkillsAdded };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[ACE] Learning failed:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

export async function getMasterMemoryRouter(config: AceConfig): Promise<{ router: MasterMemoryRouter; hierarchy: SkillbookHierarchy } | null> {
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
