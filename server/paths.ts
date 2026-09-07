import os from 'node:os';
import path from 'node:path';

/**
 * Claude Code's config directory.
 *
 * On Windows this is %USERPROFILE%\.claude — NOT %APPDATA%. That is the most
 * common wrong assumption when reading Claude Code's data.
 *
 * A GUI app launched from Finder/Explorer does not inherit shell environment,
 * so CLAUDE_CONFIG_DIR set in .zshrc will be invisible there. Read it when
 * present, otherwise fall back, and let Settings override it later.
 */
export function claudeHome(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override && override.trim() !== '') return path.resolve(override);
  return path.join(os.homedir(), '.claude');
}

/** Where per-project transcripts live. */
export function projectsDir(): string {
  return path.join(claudeHome(), 'projects');
}

/** `~/.claude.json` — holds the single active `oauthAccount`. */
export function claudeConfigJson(): string {
  return path.join(os.homedir(), '.claude.json');
}

/** PID-keyed live session files. Ephemeral: only running sessions appear. */
export function sessionsDir(): string {
  return path.join(claudeHome(), 'sessions');
}

/** Our own state/sprite cache, deliberately a home dotfolder on both OSes. */
export function appDataDir(): string {
  return path.join(os.homedir(), '.poketokenpet');
}
