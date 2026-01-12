/**
 * Project Context Detection System
 *
 * Detects language, framework, and project type from filesystem
 * Uses multiple strategies: filesystem-based, session metadata, LLM fallback
 */

export interface ProjectContext {
  language: string | null;
  framework: string | null;
  projectType: string | null;
  confidence: number;
  detectedAt: string;
  detectionMethod: 'filesystem' | 'session' | 'llm' | 'combined';
  workDir: string;
}

export interface DetectionRule {
  name: string;
  files?: string[];
  dependencies?: string[];
  directories?: string[];
  extensions?: string[];
  imports?: string[];
  priority: number;
}

export interface DetectionConfig {
  languages: DetectionRule[];
  frameworks: DetectionRule[];
  projectTypes: DetectionRule[];
}

export class ProjectDetector {
  private detectionCache = new Map<string, { context: ProjectContext; expiresAt: number }>();
  private config: DetectionConfig;

  constructor(config: DetectionConfig) {
    this.config = config;
  }

  /**
   * Detect project context using multiple strategies
   */
  async detect(
    workDir: string,
    sessionMetadata?: Record<string, unknown>
  ): Promise<ProjectContext> {
    const cacheKey = workDir;
    const cached = this.detectionCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      console.log('[ACE] Using cached context detection');
      return cached.context;
    }

    const detectionMode = 'both';

    const contexts: ProjectContext[] = [];

    const fsContext = await this.detectFromFiles(workDir);
    if (fsContext.language || fsContext.framework) {
      contexts.push(fsContext);
      console.log('[ACE] Filesystem detection:', {
        language: fsContext.language,
        framework: fsContext.framework,
        confidence: fsContext.confidence
      });
    }

    if (sessionMetadata) {
      const sessionContext = this.detectFromSession(sessionMetadata, workDir);
      if (sessionContext.language || sessionContext.framework) {
        contexts.push(sessionContext);
        console.log('[ACE] Session metadata detection:', {
          language: sessionContext.language,
          framework: sessionContext.framework
        });
      }
    }

    const merged = this.mergeContexts(contexts, workDir);

    this.detectionCache.set(cacheKey, {
      context: merged,
      expiresAt: Date.now() + 60 * 60 * 1000
    });

    return merged;
  }

  /**
   * Detect from filesystem
   */
  private async detectFromFiles(workDir: string): Promise<ProjectContext> {
    const language = await this.detectLanguage(workDir);
    const framework = await this.detectFramework(workDir);
    const projectType = await this.detectProjectType(workDir, language, framework);

    return {
      language,
      framework,
      projectType,
      confidence: this.calculateConfidence(language, framework, projectType),
      detectedAt: new Date().toISOString(),
      detectionMethod: 'filesystem',
      workDir
    };
  }

  /**
   * Detect from session metadata
   */
  private detectFromSession(metadata: Record<string, unknown>, workDir: string): ProjectContext {
    const language = metadata.language as string | null || null;
    const framework = metadata.framework as string | null || null;
    const projectType = metadata.projectType as string | null || null;

    return {
      language,
      framework,
      projectType,
      confidence: language || framework ? 0.9 : 0.5,
      detectedAt: new Date().toISOString(),
      detectionMethod: 'session',
      workDir: (metadata.workDir as string) || workDir
    };
  }

  /**
   * Merge multiple detection sources
   */
  private mergeContexts(
    contexts: ProjectContext[],
    workDir: string
  ): ProjectContext {
    if (contexts.length === 0) {
      return {
        language: null,
        framework: null,
        projectType: null,
        confidence: 0,
        detectedAt: new Date().toISOString(),
        detectionMethod: 'combined',
        workDir
      };
    }

    let language: string | null = null;
    let framework: string | null = null;
    let projectType: string | null = null;

    const fsContext = contexts.find(c => c.detectionMethod === 'filesystem');
    const sessionContext = contexts.find(c => c.detectionMethod === 'session');

    if (fsContext?.language) {
      language = fsContext.language;
    }
    if (sessionContext?.language && !language) {
      language = sessionContext.language;
    }

    if (fsContext?.framework) {
      framework = fsContext.framework;
    }
    if (sessionContext?.framework && !framework) {
      framework = sessionContext.framework;
    }

    if (fsContext?.projectType) {
      projectType = fsContext.projectType;
    }
    if (sessionContext?.projectType && !projectType) {
      projectType = sessionContext.projectType;
    }

    return {
      language,
      framework,
      projectType,
      confidence: Math.max(...contexts.map(c => c.confidence)),
      detectedAt: new Date().toISOString(),
      detectionMethod: 'combined',
      workDir
    };
  }

  /**
   * Detect programming language
   */
  private async detectLanguage(workDir: string): Promise<string | null> {
    const scores = new Map<string, number>();

    for (const rule of this.config.languages) {
      let score = 0;

      if (rule.files) {
        for (const file of rule.files) {
          if (file.includes('*')) {
            const pattern = file.replace('*', '**');
            const hasFiles = await this.checkFilesWithExtension(workDir, pattern);
            if (hasFiles) score += rule.priority * 0.5;
          } else {
            const exists = await this.fileExists(workDir, file);
            if (exists) score += rule.priority;
          }
        }
      }

      scores.set(rule.name, score);
    }

    const highest = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])[0];

    return highest[1] > 0 ? highest[0] : null;
  }

  /**
   * Detect framework
   */
  private async detectFramework(workDir: string): Promise<string | null> {
    const scores = new Map<string, number>();

    for (const rule of this.config.frameworks) {
      let score = 0;

      if (rule.dependencies && rule.files) {
        for (const file of rule.files) {
          const exists = await this.fileExists(workDir, file);
          if (exists) {
            const hasDeps = await this.checkDependencies(
              this.resolvePath(workDir, file),
              rule.dependencies
            );
            if (hasDeps) score += rule.priority;
          }
        }
      }

      if (rule.directories) {
        for (const dir of rule.directories) {
          const exists = await this.fileExists(this.resolvePath(workDir, dir));
          if (exists) score += rule.priority * 0.5;
        }
      }

      if (rule.files && !rule.dependencies) {
        for (const file of rule.files) {
          const exists = await this.fileExists(workDir, file);
          if (exists) score += rule.priority;
        }
      }

      scores.set(rule.name, score);
    }

    const highest = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])[0];

    return highest[1] > 0 ? highest[0] : null;
  }

  /**
   * Detect project type (frontend/backend/fullstack)
   */
  private async detectProjectType(
    workDir: string,
    language: string | null,
    framework: string | null
  ): Promise<string | null> {
    for (const rule of this.config.projectTypes) {
      let matchCount = 0;

      if (framework && rule.frameworks?.includes(framework)) {
        matchCount++;
      }
      if (language && rule.languages?.includes(language)) {
        matchCount++;
      }

      if (rule.directories) {
        for (const dir of rule.directories) {
          const exists = await this.fileExists(this.resolvePath(workDir, dir));
          if (exists) matchCount++;
        }
      }

      if (matchCount >= 2) {
        return rule.name;
      }
    }

    return null;
  }

  private calculateConfidence(
    language: string | null,
    framework: string | null,
    projectType: string | null
  ): number {
    let matches = 0;
    if (language) matches++;
    if (framework) matches++;
    if (projectType) matches++;
    return matches / 3;
  }

  private async fileExists(workDir: string, path: string): Promise<boolean> {
    try {
      const exists = await Bun.file(this.resolvePath(workDir, path)).exists();
      return exists;
    } catch {
      return false;
    }
  }

  private resolvePath(workDir: string, path: string): string {
    const { join } = require('path');
    return join(workDir, path);
  }

  private async checkFilesWithExtension(
    workDir: string,
    ext: string
  ): Promise<boolean> {
    try {
      const files = await Bun.$`find ${workDir} -name "${ext}" -type f 2>/dev/null || true`.text();
      return files.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async checkDependencies(
    filePath: string,
    requiredDeps: string[]
  ): Promise<boolean> {
    try {
      const content = await Bun.file(filePath).text();
      const contentLower = content.toLowerCase();

      for (const dep of requiredDeps) {
        if (contentLower.includes(dep.toLowerCase())) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Clear detection cache
   */
  clearCache(): void {
    this.detectionCache.clear();
  }
}
