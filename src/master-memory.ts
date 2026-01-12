/**
 * Master Memory System
 *
 * Manages hierarchical skill storage with automatic promotion
 * between context levels (global ← language ← framework)
 */

import { createOpencodeClient } from '@opencode-ai/sdk';
import path from 'path';
import type { ProjectContext } from './project-detection.js';

interface Skill {
  id: string;
  section: string;
  content: string;
  helpful: number;
  harmful: number;
  neutral: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillbookHierarchy {
  global: {
    universal: string;
  };
  languages: Record<string, string>;
  frameworks: Record<string, string>;
  projects?: {
    enabled: boolean;
    basePath: string;
    relativeToWorkDir: boolean;
  };
}

export interface RoutingRules {
  default: string;
  priorityOrder: string[];
  useLLMFallback: boolean;
  byContext: {
    language: Record<string, string>;
    framework: Record<string, string>;
    projectType: Record<string, string>;
  };
  fallbackPriority: string[];
}

export interface PromotionRules {
  enabled: boolean;
  criteria: {
    minHelpfulScore: number;
    minSuccessRate: number;
    ageThreshold: number;
    usageCount: number;
  };
  reviewInterval: number;
}

export interface MasterMemoryConfig {
  masterMemory: {
    global: {
      path: string;
      promotionThreshold: number;
      minPromotionScore: number;
    };
  };
  promotionRules: PromotionRules;
}

export class MasterMemoryRouter {
  private hierarchy: SkillbookHierarchy;
  private routingRules: RoutingRules;
  private promotionRules: PromotionRules;
  private lastPromotionCheck: number = 0;
  private llmAvailable: boolean | null = null;

  constructor(
    hierarchy: SkillbookHierarchy,
    routingRules: RoutingRules,
    options: { promotionRules?: PromotionRules } = {}
  ) {
    this.hierarchy = hierarchy;
    this.routingRules = routingRules;
    this.promotionRules = options.promotionRules || {
      enabled: false,
      criteria: {
        minHelpfulScore: 10,
        minSuccessRate: 0.85,
        ageThreshold: 14,
        usageCount: 5
      },
      reviewInterval: 7
    };
  }

  /**
   * Load skills from all relevant levels (Global + Language + Framework + Project)
   */
  async loadMasterContext(context: ProjectContext): Promise<{
    skills: Skill[];
    sources: string[];
  }> {
    const skills: Skill[] = [];
    const sources: string[] = [];

    // Level 1: Universal (always loaded)
    const universalSkills = await this.loadSkillbook(this.hierarchy.global.universal);
    if (universalSkills.length > 0) {
      skills.push(...universalSkills);
      sources.push(`Master/Universal (${universalSkills.length} skills)`);
    }

    // Level 2: Language-specific
    if (context.language) {
      const langPath = this.hierarchy.languages[context.language];
      if (langPath) {
        const langSkills = await this.loadSkillbook(langPath);
        if (langSkills.length > 0) {
          skills.push(...langSkills);
          sources.push(`Language/${context.language} (${langSkills.length} skills)`);
        }
      }
    }

    // Level 3: Framework-specific
    if (context.framework) {
      const fwPath = this.hierarchy.frameworks[context.framework];
      if (fwPath) {
        const fwSkills = await this.loadSkillbook(fwPath);
        if (fwSkills.length > 0) {
          skills.push(...fwSkills);
          sources.push(`Framework/${context.framework} (${fwSkills.length} skills)`);
        }
      }
    }

    // Level 4: Project-specific (optional)
    if (this.hierarchy.projects?.enabled && context.workDir) {
      const projectSkills = await this.loadProjectSkills(context.workDir);
      if (projectSkills.length > 0) {
        skills.push(...projectSkills);
        sources.push(`Project/Specific (${projectSkills.length} skills)`);
      }
    }

    return { skills, sources };
  }

  /**
   * Determine where to store a new skill based on content analysis
   */
  async routeSkill(
    skillContent: string,
    context: ProjectContext,
    existingSkill?: Skill
  ): Promise<{
    path: string;
    level: 'universal' | 'language' | 'framework' | 'project';
    reason: string;
  }> {
    // If updating existing, keep same location
    if (existingSkill) {
      return {
        path: this.getPathForSkill(existingSkill.id),
        level: this.getLevelForSkill(existingSkill.id),
        reason: 'Updating existing skill at original location'
      };
    }

    // Use LLM to determine skill scope if configured and available
    if (this.routingRules.useLLMFallback && this.llmAvailable !== false) {
      const llmDecision = await this.askLLMSkillScope(skillContent, context);
      if (llmDecision.level && llmDecision.reason) {
        return {
          path: this.resolveLevelPath(llmDecision.level, context),
          level: llmDecision.level,
          reason: `LLM classified: ${llmDecision.reason}`
        };
      }
    }

    // Heuristic-based routing
    const analysis = this.analyzeSkillScope(skillContent, context);

    return {
      path: this.resolveLevelPath(analysis.level, context),
      level: analysis.level,
      reason: analysis.reason
    };
  }

  /**
   * Ask LLM to determine where skill should be stored
   */
  private async askLLMSkillScope(
    skillContent: string,
    context: ProjectContext
  ): Promise<{ level: string | null; reason: string | null }> {
    try {
      const client = createOpencodeClient({ baseUrl: 'http://localhost:4096' });

      const session = await client.session.create({
        body: { title: 'ACE Skill Classification' }
      });

      if (!session.data?.id) {
        this.llmAvailable = false;
        return { level: null, reason: null };
      }

      const prompt = `You are ACE Skill Classifier. Determine where this skill should be stored.

Skill Content:
${skillContent}

Current Context:
- Language: ${context.language || 'Unknown'}
- Framework: ${context.framework || 'Unknown'}
- Project Type: ${context.projectType || 'Unknown'}

Options:
1. Universal: Works across all projects/languages (e.g., "Always run tests before committing")
2. Language: Specific to a programming language (e.g., "Use async/await for I/O")
3. Framework: Specific to a framework (e.g., "Use hooks in React components")
4. Project: Specific to this one project only (e.g., "Use custom internal library X")

Return JSON:
{
  "level": "universal" | "language" | "framework" | "project",
  "reason": "Brief explanation of why this level is appropriate"
}`;

      const response = await client.session.prompt({
        path: { id: session.data.id },
        body: {
          model: { providerID: 'zai-coding-plan', modelID: 'glm-4.6V' },
          parts: [{ type: 'text', text: prompt }]
        }
      });

      const content = response.data?.parts?.[0]?.text || (response as any).choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        await client.session.delete({ path: { id: session.data.id } });
        this.llmAvailable = true;
        return { level: parsed.level, reason: parsed.reason };
      }

      await client.session.delete({ path: { id: session.data.id } });
      return { level: null, reason: null };
    } catch (error) {
      this.llmAvailable = false;
      if (this.llmAvailable === null) {
        console.log('[ACE] LLM fallback unavailable, using heuristic routing');
      }
      return { level: null, reason: null };
    }
  }

  /**
   * Heuristic-based skill scope analysis
   */
  private analyzeSkillScope(
    skillContent: string,
    context: ProjectContext
  ): { level: string; reason: string } {
    const content = skillContent.toLowerCase();

    // Check for universal indicators
    const universalKeywords = [
      'always', 'never', 'before committing', 'before deploying',
      'general', 'best practice', 'universal', 'any project',
      'regardless of language', 'framework-agnostic'
    ];
    const hasUniversalKeywords = universalKeywords.some(kw => content.includes(kw));

    // Check for language-specific indicators
    const languageSpecific = [
      context.language === 'python' && /(?:def |class |import |async def|pyproject|requirements)/.test(content),
      context.language === 'typescript' && /(?:interface |type |export |import from |\.ts)/.test(content),
      context.language === 'javascript' && /(?:function |const |let |var |require\()/i.test(content),
      context.language === 'go' && /(?:func |package main|import "|go run)/.test(content)
    ];
    const languageMatches = languageSpecific.some(Boolean);

    // Check for framework-specific indicators
    const frameworkSpecific = [
      context.framework === 'react' && /(?:react|useeffect|usestate|usememo|usecallback|jsx|tsx)/i.test(content),
      context.framework === 'django' && /(?:django|models\.py|views\.py|settings\.py)/i.test(content),
      context.framework === 'fastapi' && /(?:fastapi|@app\.|api route|uvicorn|pydantic)/i.test(content),
      context.framework === 'vue' && /(?:vue|<template>|v-for|v-if|v-bind)/i.test(content)
    ];
    const frameworkMatches = frameworkSpecific.some(Boolean);

    // Check for project-specific indicators
    const projectKeywords = [
      'custom', 'internal', 'our', 'specific to this project',
      'project-specific', 'this codebase', 'our team', 'internal library'
    ];
    const hasProjectKeywords = projectKeywords.some(kw => content.includes(kw));

    // Decision hierarchy
    if (hasProjectKeywords && context.projectType) {
      return { level: 'project', reason: 'Contains project-specific references' };
    }

    if (frameworkMatches) {
      return { level: 'framework', reason: 'Contains framework-specific terminology' };
    }

    if (languageMatches) {
      return { level: 'language', reason: 'Contains language-specific syntax/patterns' };
    }

    if (hasUniversalKeywords) {
      return { level: 'universal', reason: 'Appears to be a universal best practice' };
    }

    // Default: Store at language level if available, otherwise universal
    if (context.language) {
      return { level: 'language', reason: 'Defaulting to language level' };
    }

    return { level: 'universal', reason: 'Defaulting to universal level' };
  }

  /**
   * Check for skills that should be promoted to higher levels
   */
  async checkForPromotions(): Promise<{
    candidates: Array<{
      skill: Skill;
      from: string;
      to: string;
      reason: string;
    }>;
  }> {
    if (!this.promotionRules.enabled) {
      return { candidates: [] };
    }

    const candidates: Array<{
      skill: Skill;
      from: string;
      to: string;
      reason: string;
    }> = [];

    // Check language skills for promotion to universal
    for (const [lang, langPath] of Object.entries(this.hierarchy.languages)) {
      const langSkills = await this.loadSkillbook(langPath);

      for (const skill of langSkills) {
        if (this.shouldPromoteToUniversal(skill)) {
          candidates.push({
            skill,
            from: langPath,
            to: this.hierarchy.global.universal,
            reason: `High helpful score (${skill.helpful}) and success rate`
          });
        }
      }
    }

    return { candidates };
  }

  /**
   * Determine if skill should be promoted to universal
   */
  private shouldPromoteToUniversal(skill: Skill): boolean {
    const rules = this.promotionRules.criteria;

    const total = skill.helpful + skill.harmful + skill.neutral;
    const successRate = total > 0 ? skill.helpful / total : 0;

    // Check all criteria
    const meetsHelpful = skill.helpful >= rules.minHelpfulScore;
    const meetsSuccessRate = successRate >= rules.minSuccessRate;

    // Check age
    const age = Date.now() - new Date(skill.createdAt).getTime();
    const ageInDays = age / (1000 * 60 * 60 * 24);
    const meetsAge = ageInDays >= rules.ageThreshold;

    return meetsHelpful && meetsSuccessRate && meetsAge;
  }

  private resolveLevelPath(level: string, context: ProjectContext): string {
    switch (level) {
      case 'universal':
        return this.hierarchy.global.universal;
      case 'language':
        return context.language ? this.hierarchy.languages[context.language] : this.hierarchy.global.universal;
      case 'framework':
        return context.framework ? this.hierarchy.frameworks[context.framework] : this.hierarchy.global.universal;
      case 'project':
        if (this.hierarchy.projects?.enabled && this.hierarchy.projects.relativeToWorkDir && context.workDir) {
          return path.join(context.workDir, this.hierarchy.projects.basePath);
        }
        return this.hierarchy.global.universal;
      default:
        return this.hierarchy.global.universal;
    }
  }

  private async loadSkillbook(skillbookPath: string): Promise<Skill[]> {
    const fullPath = path.join(import.meta.dir, '..', skillbookPath);
    try {
      const content = await Bun.file(fullPath).text();
      const data = JSON.parse(content);
      return data.skills || [];
    } catch {
      return [];
    }
  }

  private async loadProjectSkills(workDir: string): Promise<Skill[]> {
    if (!this.hierarchy.projects?.enabled) return [];

    const projectPath = path.join(workDir, this.hierarchy.projects.basePath);
    try {
      const content = await Bun.file(projectPath).text();
      const data = JSON.parse(content);
      return data.skills || [];
    } catch {
      return [];
    }
  }

  private getPathForSkill(skillId: string): string {
    const idParts = skillId.split('-');
    const level = idParts[0];

    if (level === 'universal') return this.hierarchy.global.universal;
    if (level && this.hierarchy.languages[level]) return this.hierarchy.languages[level];
    if (level && this.hierarchy.frameworks[level]) return this.hierarchy.frameworks[level];

    return this.hierarchy.global.universal;
  }

  private getLevelForSkill(skillId: string): 'universal' | 'language' | 'framework' | 'project' {
    const level = skillId.split('-')[0];
    if (level === 'universal' || level === 'language' || level === 'framework' || level === 'project') {
      return level;
    }
    return 'universal';
  }

  /**
   * Start periodic promotion checking
   */
  private startPromotionChecker(): void {
    if (this.promotionCheckInterval) return;

    const intervalMs = this.promotionRules.reviewInterval * 24 * 60 * 60 * 1000;
    this.promotionCheckInterval = setInterval(async () => {
      console.log('[ACE] Running periodic promotion check...');
      const { candidates } = await this.checkForPromotions();
      if (candidates.length > 0) {
        console.log(`[ACE] Found ${candidates.length} promotion candidates`);
      }
    }, intervalMs);
  }

  /**
   * Stop promotion checker
   */
  stopPromotionChecker(): void {
    if (this.promotionCheckInterval) {
      clearInterval(this.promotionCheckInterval);
      this.promotionCheckInterval = null;
    }
  }
}
