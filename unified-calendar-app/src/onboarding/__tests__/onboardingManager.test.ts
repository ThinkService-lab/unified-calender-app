/**
 * Unit tests for OnboardingManager.
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

import {
  createOnboardingManager,
  getNextStep,
  ONBOARDING_STEPS,
  TOOLTIP_DISPLAY_PERIOD_MS,
} from '../onboardingManager';
import type { OnboardingManager } from '../onboardingManager';
import type { DatabaseDriver } from '../../db/database';
import type { OnboardingStep } from '../../types/onboarding';

// ── Test helpers ──

function createMockDb(): DatabaseDriver & {
  executeCalls: Array<{ sql: string; params?: unknown[] }>;
  rows: Map<string, Record<string, unknown>[]>;
} {
  const executeCalls: Array<{ sql: string; params?: unknown[] }> = [];
  const rows = new Map<string, Record<string, unknown>[]>();

  return {
    executeCalls,
    rows,
    async execute(sql: string, params?: unknown[]): Promise<void> {
      executeCalls.push({ sql, params });

      // Simulate INSERT into onboarding_state
      if (sql.includes('INSERT INTO onboarding_state')) {
        const p = params ?? [];
        const row: Record<string, unknown> = {
          user_id: p[0],
          current_step: p[1],
          completed_steps: p[2],
          skipped: p[3],
          first_opened_at: p[4],
          tooltips_dismissed: p[5],
        };
        rows.set(`onboarding_${p[0]}`, [row]);
      }

      // Simulate UPDATE onboarding_state
      if (sql.includes('UPDATE onboarding_state')) {
        const p = params ?? [];
        const userId = p[5]; // last param in UPDATE ... WHERE user_id = ?
        const row: Record<string, unknown> = {
          user_id: userId,
          current_step: p[0],
          completed_steps: p[1],
          skipped: p[2],
          first_opened_at: p[3],
          tooltips_dismissed: p[4],
        };
        rows.set(`onboarding_${userId}`, [row]);
      }
    },
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (sql.includes('FROM onboarding_state WHERE user_id')) {
        const userId = params?.[0];
        const result = rows.get(`onboarding_${userId}`);
        return (result ?? []) as T[];
      }
      return [] as T[];
    },
    async close(): Promise<void> {},
    isOpen(): boolean {
      return true;
    },
    supportsTransactions: false,
    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return fn({ execute: this.execute.bind(this), query: this.query.bind(this) });
    },
  };
}

// ── Tests ──

describe('OnboardingManager', () => {
  let db: ReturnType<typeof createMockDb>;
  let manager: OnboardingManager;
  let currentTime: number;

  beforeEach(() => {
    db = createMockDb();
    currentTime = Date.now();
    manager = createOnboardingManager({
      db,
      now: () => currentTime,
    });
  });

  describe('getNextStep', () => {
    it('should return connect_first_account after welcome', () => {
      expect(getNextStep('welcome')).toBe('connect_first_account');
    });

    it('should return choose_view after connect_first_account', () => {
      expect(getNextStep('connect_first_account')).toBe('choose_view');
    });

    it('should return explore_features after choose_view', () => {
      expect(getNextStep('choose_view')).toBe('explore_features');
    });

    it('should return null after explore_features (last step)', () => {
      expect(getNextStep('explore_features')).toBeNull();
    });
  });

  describe('ONBOARDING_STEPS', () => {
    it('should have exactly 4 steps (Req 11.1)', () => {
      expect(ONBOARDING_STEPS).toHaveLength(4);
    });

    it('should be in the correct order', () => {
      expect(ONBOARDING_STEPS).toEqual([
        'welcome',
        'connect_first_account',
        'choose_view',
        'explore_features',
      ]);
    });
  });

  describe('getOnboardingState', () => {
    it('should create initial state at welcome step for new user (Req 11.1)', async () => {
      const state = await manager.getOnboardingState('user-1');

      expect(state.currentStep).toBe('welcome');
      expect(state.completedSteps).toEqual([]);
      expect(state.skipped).toBe(false);
      expect(state.firstOpenedAt).toBeInstanceOf(Date);
      expect(state.tooltipsDismissed).toEqual([]);
    });

    it('should persist initial state to database', async () => {
      await manager.getOnboardingState('user-1');

      const insertCall = db.executeCalls.find((c) =>
        c.sql.includes('INSERT INTO onboarding_state'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall!.params?.[0]).toBe('user-1');
      expect(insertCall!.params?.[1]).toBe('welcome');
    });

    it('should return existing state for returning user', async () => {
      // First call creates state
      await manager.getOnboardingState('user-1');

      // Second call should return existing state
      const state = await manager.getOnboardingState('user-1');

      expect(state.currentStep).toBe('welcome');
    });

    it('should set firstOpenedAt to current time', async () => {
      const state = await manager.getOnboardingState('user-1');

      expect(state.firstOpenedAt.getTime()).toBe(currentTime);
    });
  });

  describe('completeStep', () => {
    it('should advance from welcome to connect_first_account', async () => {
      await manager.getOnboardingState('user-1');
      await manager.completeStep('user-1', 'welcome');

      const state = await manager.getOnboardingState('user-1');
      expect(state.currentStep).toBe('connect_first_account');
      expect(state.completedSteps).toContain('welcome');
    });

    it('should advance through all 4 steps in order (Req 11.1)', async () => {
      await manager.getOnboardingState('user-1');

      await manager.completeStep('user-1', 'welcome');
      let state = await manager.getOnboardingState('user-1');
      expect(state.currentStep).toBe('connect_first_account');

      await manager.completeStep('user-1', 'connect_first_account');
      state = await manager.getOnboardingState('user-1');
      expect(state.currentStep).toBe('choose_view');

      await manager.completeStep('user-1', 'choose_view');
      state = await manager.getOnboardingState('user-1');
      expect(state.currentStep).toBe('explore_features');

      await manager.completeStep('user-1', 'explore_features');
      state = await manager.getOnboardingState('user-1');
      expect(state.completedSteps).toHaveLength(4);
    });

    it('should not allow completing a step out of order', async () => {
      await manager.getOnboardingState('user-1');

      // Try to complete step 2 when on step 1
      await manager.completeStep('user-1', 'connect_first_account');

      const state = await manager.getOnboardingState('user-1');
      expect(state.currentStep).toBe('welcome');
      expect(state.completedSteps).toEqual([]);
    });

    it('should not re-complete an already completed step', async () => {
      await manager.getOnboardingState('user-1');
      await manager.completeStep('user-1', 'welcome');

      // Try to complete welcome again — should be a no-op since currentStep moved
      await manager.completeStep('user-1', 'welcome');

      const state = await manager.getOnboardingState('user-1');
      expect(state.completedSteps.filter((s) => s === 'welcome')).toHaveLength(1);
    });

    it('should mark all steps completed when last step is done (Req 11.3)', async () => {
      await manager.getOnboardingState('user-1');
      await manager.completeStep('user-1', 'welcome');
      await manager.completeStep('user-1', 'connect_first_account');
      await manager.completeStep('user-1', 'choose_view');
      await manager.completeStep('user-1', 'explore_features');

      const state = await manager.getOnboardingState('user-1');
      expect(state.completedSteps).toEqual(ONBOARDING_STEPS);
    });

    it('should persist state after completing a step', async () => {
      await manager.getOnboardingState('user-1');
      await manager.completeStep('user-1', 'welcome');

      const updateCall = db.executeCalls.find(
        (c) => c.sql.includes('UPDATE onboarding_state') && c.params?.[0] === 'connect_first_account',
      );
      expect(updateCall).toBeDefined();
    });
  });

  describe('skipOnboarding (Req 11.5)', () => {
    it('should mark all steps as completed', async () => {
      await manager.getOnboardingState('user-1');
      await manager.skipOnboarding('user-1');

      const state = await manager.getOnboardingState('user-1');
      expect(state.completedSteps).toEqual([...ONBOARDING_STEPS]);
    });

    it('should set skipped flag to true', async () => {
      await manager.getOnboardingState('user-1');
      await manager.skipOnboarding('user-1');

      const state = await manager.getOnboardingState('user-1');
      expect(state.skipped).toBe(true);
    });

    it('should set currentStep to the last step', async () => {
      await manager.getOnboardingState('user-1');
      await manager.skipOnboarding('user-1');

      const state = await manager.getOnboardingState('user-1');
      expect(state.currentStep).toBe('explore_features');
    });

    it('should preserve firstOpenedAt timestamp', async () => {
      const state1 = await manager.getOnboardingState('user-1');
      const originalTime = state1.firstOpenedAt.getTime();

      currentTime += 5000; // Advance time
      await manager.skipOnboarding('user-1');

      const state2 = await manager.getOnboardingState('user-1');
      expect(state2.firstOpenedAt.getTime()).toBe(originalTime);
    });
  });

  describe('resetOnboarding (Req 11.5)', () => {
    it('should reset currentStep to welcome', async () => {
      await manager.getOnboardingState('user-1');
      await manager.completeStep('user-1', 'welcome');
      await manager.completeStep('user-1', 'connect_first_account');

      await manager.resetOnboarding('user-1');

      const state = await manager.getOnboardingState('user-1');
      expect(state.currentStep).toBe('welcome');
    });

    it('should clear completedSteps', async () => {
      await manager.getOnboardingState('user-1');
      await manager.completeStep('user-1', 'welcome');

      await manager.resetOnboarding('user-1');

      const state = await manager.getOnboardingState('user-1');
      expect(state.completedSteps).toEqual([]);
    });

    it('should clear skipped flag', async () => {
      await manager.getOnboardingState('user-1');
      await manager.skipOnboarding('user-1');

      await manager.resetOnboarding('user-1');

      const state = await manager.getOnboardingState('user-1');
      expect(state.skipped).toBe(false);
    });

    it('should preserve firstOpenedAt', async () => {
      const state1 = await manager.getOnboardingState('user-1');
      const originalTime = state1.firstOpenedAt.getTime();

      currentTime += 10000;
      await manager.resetOnboarding('user-1');

      const state2 = await manager.getOnboardingState('user-1');
      expect(state2.firstOpenedAt.getTime()).toBe(originalTime);
    });

    it('should preserve tooltipsDismissed', async () => {
      await manager.getOnboardingState('user-1');
      await manager.dismissTooltip('user-1', 'sync_indicator');

      await manager.resetOnboarding('user-1');

      const state = await manager.getOnboardingState('user-1');
      expect(state.tooltipsDismissed).toContain('sync_indicator');
    });
  });

  describe('shouldShowTooltip (Req 11.4)', () => {
    it('should return true within 7-day period for undismissed tooltip', async () => {
      await manager.getOnboardingState('user-1');

      const show = await manager.shouldShowTooltip('user-1', 'conflict_badge');
      expect(show).toBe(true);
    });

    it('should return false after 7-day period', async () => {
      await manager.getOnboardingState('user-1');

      // Advance time past 7 days
      currentTime += TOOLTIP_DISPLAY_PERIOD_MS + 1;

      const show = await manager.shouldShowTooltip('user-1', 'conflict_badge');
      expect(show).toBe(false);
    });

    it('should return false for dismissed tooltip', async () => {
      await manager.getOnboardingState('user-1');
      await manager.dismissTooltip('user-1', 'conflict_badge');

      const show = await manager.shouldShowTooltip('user-1', 'conflict_badge');
      expect(show).toBe(false);
    });

    it('should return true for different feature when one is dismissed', async () => {
      await manager.getOnboardingState('user-1');
      await manager.dismissTooltip('user-1', 'conflict_badge');

      const show = await manager.shouldShowTooltip('user-1', 'sync_indicator');
      expect(show).toBe(true);
    });

    it('should return true at exactly 7 days (boundary)', async () => {
      await manager.getOnboardingState('user-1');

      // Advance time to exactly 7 days
      currentTime += TOOLTIP_DISPLAY_PERIOD_MS;

      const show = await manager.shouldShowTooltip('user-1', 'conflict_badge');
      expect(show).toBe(true);
    });

    it('should return false at 7 days + 1ms (boundary)', async () => {
      await manager.getOnboardingState('user-1');

      currentTime += TOOLTIP_DISPLAY_PERIOD_MS + 1;

      const show = await manager.shouldShowTooltip('user-1', 'conflict_badge');
      expect(show).toBe(false);
    });
  });

  describe('dismissTooltip', () => {
    it('should add feature to tooltipsDismissed', async () => {
      await manager.getOnboardingState('user-1');
      await manager.dismissTooltip('user-1', 'sync_indicator');

      const state = await manager.getOnboardingState('user-1');
      expect(state.tooltipsDismissed).toContain('sync_indicator');
    });

    it('should not duplicate dismissed tooltips', async () => {
      await manager.getOnboardingState('user-1');
      await manager.dismissTooltip('user-1', 'sync_indicator');
      await manager.dismissTooltip('user-1', 'sync_indicator');

      const state = await manager.getOnboardingState('user-1');
      expect(state.tooltipsDismissed.filter((t) => t === 'sync_indicator')).toHaveLength(1);
    });

    it('should support dismissing multiple different tooltips', async () => {
      await manager.getOnboardingState('user-1');
      await manager.dismissTooltip('user-1', 'sync_indicator');
      await manager.dismissTooltip('user-1', 'conflict_badge');
      await manager.dismissTooltip('user-1', 'ai_assistant');

      const state = await manager.getOnboardingState('user-1');
      expect(state.tooltipsDismissed).toHaveLength(3);
      expect(state.tooltipsDismissed).toContain('sync_indicator');
      expect(state.tooltipsDismissed).toContain('conflict_badge');
      expect(state.tooltipsDismissed).toContain('ai_assistant');
    });

    it('should persist dismissed tooltips to database', async () => {
      await manager.getOnboardingState('user-1');
      await manager.dismissTooltip('user-1', 'sync_indicator');

      const updateCall = db.executeCalls.find(
        (c) =>
          c.sql.includes('UPDATE onboarding_state') &&
          typeof c.params?.[4] === 'string' &&
          c.params[4].includes('sync_indicator'),
      );
      expect(updateCall).toBeDefined();
    });
  });

  describe('multi-user isolation', () => {
    it('should maintain separate state per user', async () => {
      await manager.getOnboardingState('user-1');
      await manager.getOnboardingState('user-2');

      await manager.completeStep('user-1', 'welcome');

      const state1 = await manager.getOnboardingState('user-1');
      const state2 = await manager.getOnboardingState('user-2');

      expect(state1.currentStep).toBe('connect_first_account');
      expect(state2.currentStep).toBe('welcome');
    });

    it('should not share tooltip dismissals between users', async () => {
      await manager.getOnboardingState('user-1');
      await manager.getOnboardingState('user-2');

      await manager.dismissTooltip('user-1', 'sync_indicator');

      const show1 = await manager.shouldShowTooltip('user-1', 'sync_indicator');
      const show2 = await manager.shouldShowTooltip('user-2', 'sync_indicator');

      expect(show1).toBe(false);
      expect(show2).toBe(true);
    });
  });

  describe('TOOLTIP_DISPLAY_PERIOD_MS', () => {
    it('should be exactly 7 days in milliseconds', () => {
      expect(TOOLTIP_DISPLAY_PERIOD_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('full onboarding flow integration', () => {
    it('should support complete flow: welcome → connect → choose → explore (Req 11.1, 11.3)', async () => {
      // Step 1: First open
      const initial = await manager.getOnboardingState('user-1');
      expect(initial.currentStep).toBe('welcome');

      // Step 2: Complete welcome
      await manager.completeStep('user-1', 'welcome');
      const afterWelcome = await manager.getOnboardingState('user-1');
      expect(afterWelcome.currentStep).toBe('connect_first_account');

      // Step 3: Complete connect_first_account (Req 11.2)
      await manager.completeStep('user-1', 'connect_first_account');
      const afterConnect = await manager.getOnboardingState('user-1');
      expect(afterConnect.currentStep).toBe('choose_view');

      // Step 4: Complete choose_view
      await manager.completeStep('user-1', 'choose_view');
      const afterChoose = await manager.getOnboardingState('user-1');
      expect(afterChoose.currentStep).toBe('explore_features');

      // Step 5: Complete explore_features — flow done (Req 11.3)
      await manager.completeStep('user-1', 'explore_features');
      const final = await manager.getOnboardingState('user-1');
      expect(final.completedSteps).toHaveLength(4);
      expect(final.completedSteps).toEqual([...ONBOARDING_STEPS]);
    });

    it('should support skip then reset flow (Req 11.5)', async () => {
      await manager.getOnboardingState('user-1');

      // Skip onboarding
      await manager.skipOnboarding('user-1');
      let state = await manager.getOnboardingState('user-1');
      expect(state.skipped).toBe(true);
      expect(state.completedSteps).toHaveLength(4);

      // Reset from settings
      await manager.resetOnboarding('user-1');
      state = await manager.getOnboardingState('user-1');
      expect(state.skipped).toBe(false);
      expect(state.completedSteps).toHaveLength(0);
      expect(state.currentStep).toBe('welcome');

      // Complete flow normally
      await manager.completeStep('user-1', 'welcome');
      state = await manager.getOnboardingState('user-1');
      expect(state.currentStep).toBe('connect_first_account');
    });
  });

  describe('isComplete', () => {
    it('should return false for new user', async () => {
      const complete = await manager.isComplete('user-1');
      expect(complete).toBe(false);
    });

    it('should return false when partially complete', async () => {
      await manager.getOnboardingState('user-1');
      await manager.completeStep('user-1', 'welcome');
      await manager.completeStep('user-1', 'connect_first_account');

      const complete = await manager.isComplete('user-1');
      expect(complete).toBe(false);
    });

    it('should return true when all steps completed', async () => {
      await manager.getOnboardingState('user-1');
      await manager.completeStep('user-1', 'welcome');
      await manager.completeStep('user-1', 'connect_first_account');
      await manager.completeStep('user-1', 'choose_view');
      await manager.completeStep('user-1', 'explore_features');

      const complete = await manager.isComplete('user-1');
      expect(complete).toBe(true);
    });

    it('should return true when skipped', async () => {
      await manager.getOnboardingState('user-1');
      await manager.skipOnboarding('user-1');

      const complete = await manager.isComplete('user-1');
      expect(complete).toBe(true);
    });

    it('should return false after reset', async () => {
      await manager.getOnboardingState('user-1');
      await manager.skipOnboarding('user-1');
      await manager.resetOnboarding('user-1');

      const complete = await manager.isComplete('user-1');
      expect(complete).toBe(false);
    });
  });

  describe('onComplete callback (Req 11.3)', () => {
    let onCompleteMock: jest.Mock;
    let managerWithCallback: OnboardingManager;

    beforeEach(() => {
      onCompleteMock = jest.fn();
      managerWithCallback = createOnboardingManager({
        db,
        now: () => currentTime,
        onComplete: onCompleteMock,
      });
    });

    it('should fire when last step is completed', async () => {
      await managerWithCallback.getOnboardingState('user-1');
      await managerWithCallback.completeStep('user-1', 'welcome');
      await managerWithCallback.completeStep('user-1', 'connect_first_account');
      await managerWithCallback.completeStep('user-1', 'choose_view');

      expect(onCompleteMock).not.toHaveBeenCalled();

      await managerWithCallback.completeStep('user-1', 'explore_features');

      expect(onCompleteMock).toHaveBeenCalledTimes(1);
      expect(onCompleteMock).toHaveBeenCalledWith('user-1');
    });

    it('should fire when onboarding is skipped', async () => {
      await managerWithCallback.getOnboardingState('user-1');
      await managerWithCallback.skipOnboarding('user-1');

      expect(onCompleteMock).toHaveBeenCalledTimes(1);
      expect(onCompleteMock).toHaveBeenCalledWith('user-1');
    });

    it('should not fire on intermediate step completions', async () => {
      await managerWithCallback.getOnboardingState('user-1');
      await managerWithCallback.completeStep('user-1', 'welcome');
      await managerWithCallback.completeStep('user-1', 'connect_first_account');
      await managerWithCallback.completeStep('user-1', 'choose_view');

      expect(onCompleteMock).not.toHaveBeenCalled();
    });

    it('should not fire on reset', async () => {
      await managerWithCallback.getOnboardingState('user-1');
      await managerWithCallback.skipOnboarding('user-1');
      onCompleteMock.mockClear();

      await managerWithCallback.resetOnboarding('user-1');

      expect(onCompleteMock).not.toHaveBeenCalled();
    });

    it('should work without callback configured (no error)', async () => {
      // The default manager has no onComplete — should not throw
      await manager.getOnboardingState('user-1');
      await manager.completeStep('user-1', 'welcome');
      await manager.completeStep('user-1', 'connect_first_account');
      await manager.completeStep('user-1', 'choose_view');
      await manager.completeStep('user-1', 'explore_features');
      // No error thrown — passes
    });
  });
});
