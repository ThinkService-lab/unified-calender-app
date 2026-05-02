/**
 * Unit tests for onboarding wiring logic (Task 18.9).
 *
 * Tests the integration between OnboardingManager and the app entry point:
 * - OnboardingManager.isComplete() as single source of truth
 * - First-launch detection (isComplete returns false for new users)
 * - Completion persistence (isComplete returns true after completeStep/skip)
 * - OnboardingAnimator callbacks wire to OnboardingManager methods
 *
 * These tests validate the logic that App.tsx uses to decide whether to
 * show the OnboardingAnimator overlay. App.tsx itself is not imported
 * because it lives outside the jest roots and contains JSX that requires
 * a full React Native transform pipeline.
 *
 * Requirements: 20.1, 20.7
 */

import { createOnboardingManager, ONBOARDING_STEPS } from '../../../onboarding/onboardingManager';
import type { OnboardingManager } from '../../../onboarding/onboardingManager';
import type { DatabaseDriver } from '../../../db/database';

// ─── In-memory DB (mirrors the one in App.tsx) ──────────────────────────────

function createInMemoryDb(): DatabaseDriver {
  const tables = new Map<string, Array<Record<string, unknown>>>();

  return {
    async execute(sql: string, params?: unknown[]): Promise<void> {
      if (sql.includes('CREATE TABLE') || sql.includes('PRAGMA')) return;

      if (sql.includes('INSERT INTO onboarding_state')) {
        const rows = tables.get('onboarding_state') ?? [];
        rows.push({
          user_id: params?.[0],
          current_step: params?.[1],
          completed_steps: params?.[2],
          skipped: params?.[3],
          first_opened_at: params?.[4],
          tooltips_dismissed: params?.[5],
        });
        tables.set('onboarding_state', rows);
        return;
      }

      if (sql.includes('UPDATE onboarding_state')) {
        const rows = tables.get('onboarding_state') ?? [];
        const userId = params?.[5];
        const idx = rows.findIndex((r) => r.user_id === userId);
        if (idx >= 0) {
          rows[idx] = {
            user_id: userId,
            current_step: params?.[0],
            completed_steps: params?.[1],
            skipped: params?.[2],
            first_opened_at: params?.[3],
            tooltips_dismissed: params?.[4],
          };
        }
        return;
      }
    },

    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (sql.includes('FROM onboarding_state')) {
        const rows = tables.get('onboarding_state') ?? [];
        const userId = params?.[0];
        const matches = rows.filter((r) => r.user_id === userId);
        return matches as T[];
      }
      return [];
    },

    async close(): Promise<void> {},
    isOpen(): boolean { return true; },
    supportsTransactions: false,
    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return fn({ execute: this.execute.bind(this), query: this.query.bind(this) });
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const DEMO_USER_ID = 'user-1';

describe('App onboarding wiring (Task 18.9)', () => {
  let db: DatabaseDriver;
  let manager: OnboardingManager;

  beforeEach(() => {
    db = createInMemoryDb();
    manager = createOnboardingManager({ db });
  });

  describe('isComplete as single source of truth (Req 20.1)', () => {
    it('should return false for a new user (first launch)', async () => {
      const complete = await manager.isComplete(DEMO_USER_ID);
      expect(complete).toBe(false);
    });

    it('should return false after completing only some steps', async () => {
      await manager.completeStep(DEMO_USER_ID, 'welcome');
      await manager.completeStep(DEMO_USER_ID, 'connect_first_account');

      const complete = await manager.isComplete(DEMO_USER_ID);
      expect(complete).toBe(false);
    });

    it('should return true after completing all steps', async () => {
      for (const step of ONBOARDING_STEPS) {
        await manager.completeStep(DEMO_USER_ID, step);
      }

      const complete = await manager.isComplete(DEMO_USER_ID);
      expect(complete).toBe(true);
    });

    it('should return true after skipping onboarding', async () => {
      await manager.skipOnboarding(DEMO_USER_ID);

      const complete = await manager.isComplete(DEMO_USER_ID);
      expect(complete).toBe(true);
    });
  });

  describe('OnboardingAnimator callback wiring (Req 20.7)', () => {
    it('completeStep persists state so onboarding is not shown again', async () => {
      // Simulate what OnboardingAnimator.handleNext does:
      // it calls completeStep for each ONBOARDING_STEPS_TO_COMPLETE
      const stepsToComplete = ['welcome', 'connect_first_account', 'choose_view', 'explore_features'] as const;

      for (const step of stepsToComplete) {
        await manager.completeStep(DEMO_USER_ID, step);
      }

      // On next "launch", isComplete should return true
      const complete = await manager.isComplete(DEMO_USER_ID);
      expect(complete).toBe(true);
    });

    it('skipOnboarding persists state so onboarding is not shown again', async () => {
      // Simulate what OnboardingAnimator.handleSkip does
      await manager.skipOnboarding(DEMO_USER_ID);

      // On next "launch", isComplete should return true
      const complete = await manager.isComplete(DEMO_USER_ID);
      expect(complete).toBe(true);
    });

    it('onComplete callback pattern: isComplete check drives overlay visibility', async () => {
      // This simulates the App.tsx pattern:
      // 1. Check isComplete on mount
      // 2. If false, show overlay (showOnboarding = true)
      // 3. After onComplete fires, set showOnboarding = false

      // Step 1: First launch check
      const firstCheck = await manager.isComplete(DEMO_USER_ID);
      const showOnboarding = !firstCheck;
      expect(showOnboarding).toBe(true);

      // Step 2: User completes onboarding (OnboardingAnimator calls completeStep internally)
      for (const step of ONBOARDING_STEPS) {
        await manager.completeStep(DEMO_USER_ID, step);
      }

      // Step 3: On next launch, overlay should not show
      const secondCheck = await manager.isComplete(DEMO_USER_ID);
      const showOnboardingAfter = !secondCheck;
      expect(showOnboardingAfter).toBe(false);
    });
  });

  describe('state isolation between users', () => {
    it('should track onboarding state independently per user', async () => {
      // User 1 completes onboarding
      await manager.skipOnboarding('user-1');

      // User 2 is still new
      const user1Complete = await manager.isComplete('user-1');
      const user2Complete = await manager.isComplete('user-2');

      expect(user1Complete).toBe(true);
      expect(user2Complete).toBe(false);
    });
  });

  describe('error resilience', () => {
    it('should handle database errors gracefully in the App.tsx pattern', async () => {
      // Create a manager with a failing DB
      const failingDb: DatabaseDriver = {
        async execute(): Promise<void> { throw new Error('DB write failed'); },
        async query(): Promise<never[]> { throw new Error('DB read failed'); },
        async close(): Promise<void> {},
        isOpen(): boolean { return false; },
        supportsTransactions: false,
        async transaction<T>(): Promise<T> { throw new Error('DB transaction failed'); },
      };

      const failingManager = createOnboardingManager({ db: failingDb });

      // The App.tsx pattern wraps isComplete in a try/catch:
      //   manager.isComplete(userId).then(...).catch(() => setShowOnboarding(false))
      // Verify that isComplete rejects so the catch handler fires
      await expect(failingManager.isComplete(DEMO_USER_ID)).rejects.toThrow();
    });
  });
});
