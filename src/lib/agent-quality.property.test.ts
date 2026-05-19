import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { runQualityChecks, type AgentDraftInput } from './agent-quality';

/**
 * Property-based tests for agent-quality heuristic checks.
 *
 * **Validates: Requirements AGP-005**
 */

const BLACKLIST_WORDS = ['casino', 'viagra', 'crypto-pump', 'click here'];

function makeDraft(overrides: Partial<AgentDraftInput> = {}): AgentDraftInput {
  return {
    title: 'Test Title',
    description: 'Test description',
    body_md: 'A'.repeat(100),
    agent_id: 'test-agent',
    ...overrides,
  };
}

/** Generate a safe string from limited alphabet (no blacklist words possible) */
const safeTextArb = (min: number, max: number) =>
  fc.string({ unit: fc.constantFrom(...'abdefgjklmnopqtuwxyz0123456789 '.split('')), minLength: min, maxLength: max });

/** Generate filler text from basic alphabet */
const fillerArb = (min: number, max: number) =>
  fc.string({ unit: fc.constantFrom(...'abcdefghijklmnop '.split('')), minLength: min, maxLength: max });

describe('Property 5: Quality heuristic detection', () => {
  it('>10 URLs in body → excessive_urls warning', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 11, max: 30 }),
        fillerArb(50, 100),
        (urlCount, filler) => {
          const urls = Array.from({ length: urlCount }, (_, i) => `https://example.com/page/${i}`).join('\n');
          const body = urls + '\n' + filler;
          const draft = makeDraft({ body_md: body });
          const warnings = runQualityChecks(draft);

          const excessiveUrlWarning = warnings.find(w => w.code === 'excessive_urls');
          expect(excessiveUrlWarning).toBeDefined();
          expect(excessiveUrlWarning!.severity).toBe('warn');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('≤10 URLs in body → no excessive_urls warning', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fillerArb(100, 200),
        (urlCount, filler) => {
          const urls = Array.from({ length: urlCount }, (_, i) => `https://example.com/page/${i}`).join('\n');
          const body = filler + '\n' + urls;
          const draft = makeDraft({ body_md: body });
          const warnings = runQualityChecks(draft);

          const excessiveUrlWarning = warnings.find(w => w.code === 'excessive_urls');
          expect(excessiveUrlWarning).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('blacklist words in body → blacklist_words warning', () => {
    fc.assert(
      fc.property(
        fc.subarray(BLACKLIST_WORDS, { minLength: 1 }),
        fillerArb(80, 200),
        (words, filler) => {
          const body = filler + ' ' + words.join(' and ') + ' ' + filler;
          const draft = makeDraft({ body_md: body });
          const warnings = runQualityChecks(draft);

          const blacklistWarning = warnings.find(w => w.code === 'blacklist_words');
          expect(blacklistWarning).toBeDefined();
          expect(blacklistWarning!.severity).toBe('warn');
          for (const word of words) {
            expect(blacklistWarning!.message.toLowerCase()).toContain(word);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('no blacklist words in body → no blacklist_words warning', () => {
    fc.assert(
      fc.property(
        safeTextArb(100, 300),
        (body) => {
          // Precondition: ensure no blacklist words are accidentally formed
          const lower = body.toLowerCase();
          const hasBlacklist = BLACKLIST_WORDS.some(w => lower.includes(w));
          fc.pre(!hasBlacklist);

          const draft = makeDraft({ body_md: body });
          const warnings = runQualityChecks(draft);

          const blacklistWarning = warnings.find(w => w.code === 'blacklist_words');
          expect(blacklistWarning).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('line repeated >3 times → repetitive_content warning', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(...'abcdefghijklmnop'.split('')), minLength: 5, maxLength: 30 }),
        fc.integer({ min: 4, max: 20 }),
        fillerArb(20, 50),
        (repeatedLine, repeatCount, filler) => {
          const repeated = Array(repeatCount).fill(repeatedLine).join('\n');
          const body = repeated + '\n' + filler;
          const draft = makeDraft({ body_md: body });
          const warnings = runQualityChecks(draft);

          const repetitionWarning = warnings.find(w => w.code === 'repetitive_content');
          expect(repetitionWarning).toBeDefined();
          expect(repetitionWarning!.severity).toBe('warn');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('no line repeated >3 times → no repetitive_content warning', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), minLength: 3, maxLength: 30 }),
          { minLength: 5, maxLength: 20 }
        ),
        (lines) => {
          // Ensure uniqueness then repeat each at most 3 times
          const uniqueLines = [...new Set(lines)];
          const body = uniqueLines.flatMap(l => [l, l, l]).join('\n');
          fc.pre(body.length >= 100);

          const draft = makeDraft({ body_md: body });
          const warnings = runQualityChecks(draft);

          const repetitionWarning = warnings.find(w => w.code === 'repetitive_content');
          expect(repetitionWarning).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
