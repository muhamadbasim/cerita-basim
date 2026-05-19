/**
 * Heuristic quality checks for agent-submitted drafts.
 * Warnings are non-blocking — draft is still saved regardless.
 * Requirement: AGP-005
 */

/** Allowed tags for agent drafts */
const TAG_WHITELIST = ['produk', 'teknis', 'karier', 'catatan', 'eksperimen'];

/** Regex to match URLs in markdown body */
const URL_REGEX = /https?:\/\/[^\s)]+/g;

/** Words that flag potentially spammy content */
const BLACKLIST_WORDS = ['casino', 'viagra', 'crypto-pump', 'click here'];

export interface QualityWarning {
  code: string;
  message: string;
  severity: 'warn' | 'info';
}

export interface AgentDraftInput {
  title: string;
  description: string;
  body_md: string;
  agent_id: string;
  slug?: string;
  tags?: string[];
  cover?: string;
}

/**
 * Run heuristic quality checks on an agent draft.
 * Returns an array of warnings (may be empty if all checks pass).
 * Warnings are non-blocking — the draft should still be saved.
 */
export function runQualityChecks(draft: AgentDraftInput): QualityWarning[] {
  const warnings: QualityWarning[] = [];

  // Tag whitelist check
  if (draft.tags && draft.tags.length > 0) {
    const invalidTags = draft.tags.filter(t => !TAG_WHITELIST.includes(t));
    if (invalidTags.length > 0) {
      warnings.push({
        code: 'tag_not_whitelisted',
        message: `Tags not in whitelist: ${invalidTags.join(', ')}`,
        severity: 'warn',
      });
    }
  }

  // Excessive URLs check (>10 URLs in body_md)
  const urlMatches = draft.body_md.match(URL_REGEX) || [];
  if (urlMatches.length > 10) {
    warnings.push({
      code: 'excessive_urls',
      message: `Body contains ${urlMatches.length} URLs (max recommended: 10)`,
      severity: 'warn',
    });
  }

  // Blacklist words check
  const lower = draft.body_md.toLowerCase();
  const foundWords = BLACKLIST_WORDS.filter(w => lower.includes(w));
  if (foundWords.length > 0) {
    warnings.push({
      code: 'blacklist_words',
      message: `Contains flagged words: ${foundWords.join(', ')}`,
      severity: 'warn',
    });
  }

  // Repetition check (same line repeated >3 times)
  const lines = draft.body_md.split('\n').filter(l => l.trim().length > 0);
  const freq = new Map<string, number>();
  for (const line of lines) {
    freq.set(line, (freq.get(line) || 0) + 1);
  }
  const hasRepetition = [...freq.values()].some(count => count > 3);
  if (hasRepetition) {
    warnings.push({
      code: 'repetitive_content',
      message: 'Body contains repetitive lines (same line appears more than 3 times)',
      severity: 'warn',
    });
  }

  return warnings;
}
