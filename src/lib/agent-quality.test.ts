import { describe, it, expect } from 'vitest';
import { runQualityChecks, type AgentDraftInput } from './agent-quality';

/** Helper to create a valid draft with overrides */
function makeDraft(overrides: Partial<AgentDraftInput> = {}): AgentDraftInput {
  return {
    title: 'Test Article',
    description: 'A test description for the article',
    body_md: 'A'.repeat(100), // minimum valid body
    agent_id: 'test-agent',
    ...overrides,
  };
}

describe('runQualityChecks', () => {
  describe('tag whitelist check', () => {
    it('returns no warning when tags are all whitelisted', () => {
      const draft = makeDraft({ tags: ['produk', 'teknis', 'karier'] });
      const warnings = runQualityChecks(draft);
      expect(warnings.find(w => w.code === 'tag_not_whitelisted')).toBeUndefined();
    });

    it('returns no warning when tags are undefined', () => {
      const draft = makeDraft({ tags: undefined });
      const warnings = runQualityChecks(draft);
      expect(warnings.find(w => w.code === 'tag_not_whitelisted')).toBeUndefined();
    });

    it('returns no warning when tags are empty array', () => {
      const draft = makeDraft({ tags: [] });
      const warnings = runQualityChecks(draft);
      expect(warnings.find(w => w.code === 'tag_not_whitelisted')).toBeUndefined();
    });

    it('returns warning for non-whitelisted tags', () => {
      const draft = makeDraft({ tags: ['produk', 'random-tag', 'invalid'] });
      const warnings = runQualityChecks(draft);
      const w = warnings.find(w => w.code === 'tag_not_whitelisted');
      expect(w).toBeDefined();
      expect(w!.severity).toBe('warn');
      expect(w!.message).toContain('random-tag');
      expect(w!.message).toContain('invalid');
    });

    it('accepts all five whitelisted tags', () => {
      const draft = makeDraft({ tags: ['produk', 'teknis', 'karier', 'catatan', 'eksperimen'] });
      const warnings = runQualityChecks(draft);
      expect(warnings.find(w => w.code === 'tag_not_whitelisted')).toBeUndefined();
    });
  });

  describe('excessive URLs check', () => {
    it('returns no warning when body has ≤10 URLs', () => {
      const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`).join('\n');
      const draft = makeDraft({ body_md: urls + '\n' + 'A'.repeat(50) });
      const warnings = runQualityChecks(draft);
      expect(warnings.find(w => w.code === 'excessive_urls')).toBeUndefined();
    });

    it('returns warning when body has >10 URLs', () => {
      const urls = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`).join('\n');
      const draft = makeDraft({ body_md: urls + '\n' + 'A'.repeat(50) });
      const warnings = runQualityChecks(draft);
      const w = warnings.find(w => w.code === 'excessive_urls');
      expect(w).toBeDefined();
      expect(w!.severity).toBe('warn');
      expect(w!.message).toContain('11');
    });

    it('returns no warning when body has no URLs', () => {
      const draft = makeDraft({ body_md: 'Just plain text without any links. '.repeat(10) });
      const warnings = runQualityChecks(draft);
      expect(warnings.find(w => w.code === 'excessive_urls')).toBeUndefined();
    });
  });

  describe('blacklist words check', () => {
    it('returns no warning when body has no blacklisted words', () => {
      const draft = makeDraft({ body_md: 'This is a clean article about programming. '.repeat(5) });
      const warnings = runQualityChecks(draft);
      expect(warnings.find(w => w.code === 'blacklist_words')).toBeUndefined();
    });

    it('returns warning when body contains "casino"', () => {
      const draft = makeDraft({ body_md: 'Visit the best casino online today! '.repeat(5) });
      const warnings = runQualityChecks(draft);
      const w = warnings.find(w => w.code === 'blacklist_words');
      expect(w).toBeDefined();
      expect(w!.message).toContain('casino');
    });

    it('returns warning when body contains "viagra"', () => {
      const draft = makeDraft({ body_md: 'Buy cheap viagra now for best results. '.repeat(5) });
      const warnings = runQualityChecks(draft);
      const w = warnings.find(w => w.code === 'blacklist_words');
      expect(w).toBeDefined();
      expect(w!.message).toContain('viagra');
    });

    it('returns warning when body contains "crypto-pump"', () => {
      const draft = makeDraft({ body_md: 'Join our crypto-pump group for guaranteed returns. '.repeat(5) });
      const warnings = runQualityChecks(draft);
      const w = warnings.find(w => w.code === 'blacklist_words');
      expect(w).toBeDefined();
      expect(w!.message).toContain('crypto-pump');
    });

    it('returns warning when body contains "click here"', () => {
      const draft = makeDraft({ body_md: 'Please click here to claim your prize now. '.repeat(5) });
      const warnings = runQualityChecks(draft);
      const w = warnings.find(w => w.code === 'blacklist_words');
      expect(w).toBeDefined();
      expect(w!.message).toContain('click here');
    });

    it('detects blacklist words case-insensitively', () => {
      const draft = makeDraft({ body_md: 'Visit the best CASINO and buy VIAGRA online. '.repeat(5) });
      const warnings = runQualityChecks(draft);
      const w = warnings.find(w => w.code === 'blacklist_words');
      expect(w).toBeDefined();
      expect(w!.message).toContain('casino');
      expect(w!.message).toContain('viagra');
    });

    it('lists all found blacklisted words in message', () => {
      const draft = makeDraft({ body_md: 'casino and viagra and click here in one post. '.repeat(5) });
      const warnings = runQualityChecks(draft);
      const w = warnings.find(w => w.code === 'blacklist_words');
      expect(w).toBeDefined();
      expect(w!.message).toContain('casino');
      expect(w!.message).toContain('viagra');
      expect(w!.message).toContain('click here');
    });
  });

  describe('repetition check', () => {
    it('returns no warning when no line repeats more than 3 times', () => {
      const body = 'Line A\nLine B\nLine C\nLine A\nLine B\nLine C\n' + 'A'.repeat(50);
      const draft = makeDraft({ body_md: body });
      const warnings = runQualityChecks(draft);
      expect(warnings.find(w => w.code === 'repetitive_content')).toBeUndefined();
    });

    it('returns no warning when a line repeats exactly 3 times', () => {
      const body = 'Repeated line\nRepeated line\nRepeated line\nOther content\n' + 'A'.repeat(50);
      const draft = makeDraft({ body_md: body });
      const warnings = runQualityChecks(draft);
      expect(warnings.find(w => w.code === 'repetitive_content')).toBeUndefined();
    });

    it('returns warning when a line repeats more than 3 times', () => {
      const body = 'Spam line\nSpam line\nSpam line\nSpam line\nOther content\n' + 'A'.repeat(50);
      const draft = makeDraft({ body_md: body });
      const warnings = runQualityChecks(draft);
      const w = warnings.find(w => w.code === 'repetitive_content');
      expect(w).toBeDefined();
      expect(w!.severity).toBe('warn');
    });

    it('ignores empty lines in repetition check', () => {
      const body = '\n\n\n\n\n\nActual content here that is long enough to pass.\n' + 'A'.repeat(50);
      const draft = makeDraft({ body_md: body });
      const warnings = runQualityChecks(draft);
      expect(warnings.find(w => w.code === 'repetitive_content')).toBeUndefined();
    });
  });

  describe('combined checks', () => {
    it('returns empty array for a clean draft', () => {
      const draft = makeDraft({
        tags: ['teknis'],
        body_md: 'This is a well-written article about TypeScript patterns and best practices. '.repeat(5),
      });
      const warnings = runQualityChecks(draft);
      expect(warnings).toEqual([]);
    });

    it('returns multiple warnings for a problematic draft', () => {
      const urls = Array.from({ length: 12 }, (_, i) => `https://spam.com/${i}`).join('\n');
      const body = urls + '\ncasino\n' + 'Buy now!\nBuy now!\nBuy now!\nBuy now!\n';
      const draft = makeDraft({
        tags: ['invalid-tag'],
        body_md: body,
      });
      const warnings = runQualityChecks(draft);
      expect(warnings.length).toBeGreaterThanOrEqual(3);
      expect(warnings.find(w => w.code === 'tag_not_whitelisted')).toBeDefined();
      expect(warnings.find(w => w.code === 'excessive_urls')).toBeDefined();
      expect(warnings.find(w => w.code === 'blacklist_words')).toBeDefined();
      expect(warnings.find(w => w.code === 'repetitive_content')).toBeDefined();
    });

    it('all warnings have severity "warn"', () => {
      const urls = Array.from({ length: 12 }, (_, i) => `https://spam.com/${i}`).join('\n');
      const body = urls + '\ncasino\n' + 'Spam!\nSpam!\nSpam!\nSpam!\n';
      const draft = makeDraft({ tags: ['bad-tag'], body_md: body });
      const warnings = runQualityChecks(draft);
      for (const w of warnings) {
        expect(w.severity).toBe('warn');
      }
    });
  });
});
