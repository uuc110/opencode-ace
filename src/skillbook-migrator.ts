/**
 * Skillbook Migration System
 *
 * Migrates legacy agent skillbooks to new hierarchical structure
 */

import { loadSkillbook, saveSkillbook } from './index.js';

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

export interface MigrationOptions {
  dryRun: boolean;
  backupExisting: boolean;
  confirmEachMove: boolean;
}

export class SkillbookMigrator {
  private hierarchy: any;

  constructor(hierarchy: any) {
    this.hierarchy = hierarchy;
  }

  /**
   * Migrate all legacy agent skillbooks
   */
  async migrate(options: MigrationOptions = {
    dryRun: false,
    backupExisting: true,
    confirmEachMove: false
  }): Promise<{
    success: boolean;
    migrated: number;
    skipped: number;
    errors: string[];
  }> {
    console.log('[ACE] Starting skillbook migration...');
    const errors: string[] = [];

    // 1. Backup existing skillbooks
    if (options.backupExisting) {
      console.log('[ACE] Backing up existing skillbooks...');
      await this.backupAllSkillbooks();
    }

    // 2. Migrate each agent skillbook
    const agentSkillbooks = [
      { id: 'openagent', path: 'agents/openagent.json' },
      { id: 'opencoder', path: 'agents/opencoder.json' }
    ];

    let totalMigrated = 0;
    let totalSkipped = 0;

    for (const agent of agentSkillbooks) {
      try {
        const result = await this.migrateAgentSkillbook(
          agent.id,
          agent.path,
          options
        );
        totalMigrated += result.migrated;
        totalSkipped += result.skipped;
        errors.push(...result.errors);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to migrate ${agent.id}: ${msg}`);
      }
    }

    console.log(`[ACE] Migration complete: ${totalMigrated} migrated, ${totalSkipped} skipped`);

    return {
      success: errors.length === 0,
      migrated: totalMigrated,
      skipped: totalSkipped,
      errors
    };
  }

  /**
   * Migrate a single agent skillbook
   */
  private async migrateAgentSkillbook(
    agentId: string,
    path: string,
    options: MigrationOptions
  ): Promise<{ migrated: number; skipped: number; errors: string[] }> {
    console.log(`[ACE] Migrating ${agentId}...`);
    const errors: string[] = [];

    const skills = await loadSkillbook(path);
    if (skills.length === 0) {
      console.log(`[ACE] ${agentId} has no skills to migrate`);
      return { migrated: 0, skipped: 0, errors };
    }

    let migrated = 0;
    let skipped = 0;

    for (const skill of skills) {
      // Analyze skill content to determine target
      const target = this.inferTargetSkillbook(skill.content);

      if (options.dryRun) {
        console.log(`[DRY RUN] ${skill.id} → ${target.path}`);
        migrated++;
        continue;
      }

      try {
        // Load target skillbook
        const targetSkills = await loadSkillbook(target.path);

        // Check for duplicates
        const isDuplicate = targetSkills.some(s =>
          this.calculateSimilarity(s.content, skill.content) > 0.85
        );

        if (isDuplicate) {
          console.log(`[ACE] Skipping duplicate skill: ${skill.id}`);
          skipped++;
          continue;
        }

        // Add skill to target
        targetSkills.push(skill);
        await saveSkillbook(target.path, targetSkills);
        migrated++;

        console.log(`[ACE] Migrated ${skill.id} → ${target.level} (${target.reason})`);

        // Remove from source (if not dry run)
        const sourceSkills = await loadSkillbook(path);
        const remainingSkills = sourceSkills.filter(s => s.id !== skill.id);
        await saveSkillbook(path, remainingSkills);

      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to migrate ${skill.id}: ${msg}`);
      }
    }

    return { migrated, skipped, errors };
  }

  /**
   * Infer target skillbook for a skill using heuristics
   */
  private inferTargetSkillbook(content: string): {
    path: string;
    level: 'universal' | 'language' | 'framework';
    reason: string;
  } {
    const contentLower = content.toLowerCase();

    // Python patterns
    if (this.matchesAny(contentLower, [
      'python', 'pyproject', 'requirements', 'pip install', 'import ', 'def ',
      'class ', 'async def', 'django', 'fastapi', 'flask'
    ])) {
      return {
        path: this.hierarchy.languages?.python || 'skillbooks/languages/python.json',
        level: 'language',
        reason: 'Contains Python-specific keywords'
      };
    }

    // React patterns
    if (this.matchesAny(contentLower, [
      'react', 'useeffect', 'usestate', 'usememo', 'usecallback',
      'jsx', 'tsx', 'component', 'props', 'react-dom', 'next'
    ])) {
      return {
        path: this.hierarchy.frameworks?.react || 'skillbooks/frameworks/react.json',
        level: 'framework',
        reason: 'Contains React-specific keywords'
      };
    }

    // TypeScript patterns
    if (this.matchesAny(contentLower, [
      'typescript', 'interface ', 'type ', 'tsconfig', 'tsx', 'type safety'
    ])) {
      return {
        path: this.hierarchy.languages?.typescript || 'skillbooks/languages/typescript.json',
        level: 'language',
        reason: 'Contains TypeScript-specific keywords'
      };
    }

    // JavaScript patterns
    if (this.matchesAny(contentLower, [
      'javascript', 'npm install', 'node_modules', 'package.json',
      'function ', 'const ', 'let ', 'var ', 'require('
    ])) {
      return {
        path: this.hierarchy.languages?.javascript || 'skillbooks/languages/javascript.json',
        level: 'language',
        reason: 'Contains JavaScript-specific keywords'
      };
    }

    // Django patterns
    if (this.matchesAny(contentLower, [
      'django', 'settings.py', 'urls.py', 'views.py', 'models.py',
      'django orm', 'django template'
    ])) {
      return {
        path: this.hierarchy.frameworks?.django || 'skillbooks/frameworks/django.json',
        level: 'framework',
        reason: 'Contains Django-specific keywords'
      };
    }

    // FastAPI patterns
    if (this.matchesAny(contentLower, [
      'fastapi', '@app.', 'api route', 'uvicorn', 'pydantic'
    ])) {
      return {
        path: this.hierarchy.frameworks?.fastapi || 'skillbooks/frameworks/fastapi.json',
        level: 'framework',
        reason: 'Contains FastAPI-specific keywords'
      };
    }

    // Next.js patterns
    if (this.matchesAny(contentLower, [
      'next.js', 'nextjs', 'next.config', 'app router', 'pages router'
    ])) {
      return {
        path: this.hierarchy.frameworks?.nextjs || 'skillbooks/frameworks/nextjs.json',
        level: 'framework',
        reason: 'Contains Next.js-specific keywords'
      };
    }

    // Go patterns
    if (this.matchesAny(contentLower, [
      'go.mod', 'package main', 'func ', 'import "', 'go run', 'go build'
    ])) {
      return {
        path: this.hierarchy.languages?.go || 'skillbooks/languages/go.json',
        level: 'language',
        reason: 'Contains Go-specific keywords'
      };
    }

    // Rust patterns
    if (this.matchesAny(contentLower, [
      'cargo.toml', 'use ', 'impl ', 'fn main', 'cargo build'
    ])) {
      return {
        path: this.hierarchy.languages?.rust || 'skillbooks/languages/rust.json',
        level: 'language',
        reason: 'Contains Rust-specific keywords'
      };
    }

    // Universal patterns (default)
    if (this.matchesAny(contentLower, [
      'always', 'never', 'best practice', 'before committing',
      'before deploying', 'general', 'any project', 'framework-agnostic'
    ])) {
      return {
        path: this.hierarchy.global?.universal || 'skillbooks/global/universal.json',
        level: 'universal',
        reason: 'Appears to be a universal best practice'
      };
    }

    // Default to universal if uncertain
    return {
      path: this.hierarchy.global?.universal || 'skillbooks/global/universal.json',
      level: 'universal',
      reason: 'Could not determine specific category, defaulting to universal'
    };
  }

  private matchesAny(text: string, patterns: string[]): boolean {
    return patterns.some(p => text.includes(p));
  }

  private calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private async backupAllSkillbooks(): Promise<void> {
    const backupDir = path.join(import.meta.dir, '..', 'skillbooks', 'backups', 'migration');
    await Bun.$`mkdir -p ${backupDir}`.text();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `pre-migration-${timestamp}.tar.gz`);

    await Bun.$`cd ${path.join(import.meta.dir, '..', 'skillbooks')} && tar -czf ${backupPath} .`.text();
    console.log(`[ACE] Backed up skillbooks to: ${backupPath}`);
  }
}
