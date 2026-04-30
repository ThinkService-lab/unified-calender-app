/**
 * Unit tests for on-device TensorFlow Lite model integration.
 * Requirements: 8.3
 */

import {
  createOnDeviceModel,
  createEmptyWeights,
  quantizeWeights,
  dequantizeWeights,
  quantizeToInt8,
  dequantizeFromInt8,
  calculateModelSize,
  MAX_MODEL_SIZE_BYTES,
  MIN_PATTERNS_FOR_MODEL,
} from '../onDeviceModel';
import type { LearnedPattern } from '../../types';

describe('OnDeviceModel', () => {
  describe('Model size constraint', () => {
    it('model size stays under 1MB', () => {
      const weights = createEmptyWeights();
      const size = calculateModelSize(weights);
      expect(size).toBeLessThan(MAX_MODEL_SIZE_BYTES);
    });

    it('getModelSizeBytes returns size under 1MB', () => {
      const model = createOnDeviceModel();
      expect(model.getModelSizeBytes()).toBeLessThan(MAX_MODEL_SIZE_BYTES);
    });
  });

  describe('INT8 quantization', () => {
    it('quantizes float [0,1] to INT8 [-128,127]', () => {
      expect(quantizeToInt8(0)).toBe(-128);
      expect(quantizeToInt8(1)).toBe(127);
      expect(quantizeToInt8(0.5)).toBe(0); // midpoint — note: Math.round(0.5 * 255 - 128) = 0
    });

    it('dequantizes INT8 back to float [0,1]', () => {
      expect(dequantizeFromInt8(-128)).toBeCloseTo(0, 2);
      expect(dequantizeFromInt8(127)).toBeCloseTo(1, 2);
      expect(dequantizeFromInt8(0)).toBeCloseTo(0.502, 1); // midpoint
    });

    it('round-trips quantize/dequantize with acceptable precision', () => {
      const original = 0.75;
      const quantized = quantizeToInt8(original);
      const restored = dequantizeFromInt8(quantized);
      expect(Math.abs(restored - original)).toBeLessThan(0.01);
    });

    it('quantizeWeights produces quantized flag', () => {
      const weights = createEmptyWeights();
      expect(weights.quantized).toBe(false);

      const quantized = quantizeWeights(weights);
      expect(quantized.quantized).toBe(true);
    });

    it('dequantizeWeights restores float values', () => {
      const weights = createEmptyWeights();
      weights.slotScores[1][10] = 0.8;

      const quantized = quantizeWeights(weights);
      const restored = dequantizeWeights(quantized);

      expect(restored.quantized).toBe(false);
      expect(Math.abs(restored.slotScores[1][10] - 0.8)).toBeLessThan(0.01);
    });
  });

  describe('Fallback heuristics for new users', () => {
    it('isReady returns false for new model', () => {
      const model = createOnDeviceModel();
      expect(model.isReady()).toBe(false);
    });

    it('uses fallback heuristics when model is not ready', async () => {
      const model = createOnDeviceModel();
      const result = await model.infer(1, 10); // Monday 10am

      expect(result.usedModel).toBe(false);
      expect(result.preferenceScore).toBeGreaterThan(0);
    });

    it('fallback prefers business hours on weekdays', async () => {
      const model = createOnDeviceModel();

      const businessHour = await model.infer(1, 10); // Monday 10am
      const lateNight = await model.infer(1, 23); // Monday 11pm
      const weekend = await model.infer(0, 10); // Sunday 10am

      expect(businessHour.preferenceScore).toBeGreaterThan(lateNight.preferenceScore);
      expect(businessHour.preferenceScore).toBeGreaterThan(weekend.preferenceScore);
    });

    it('handles invalid day/hour gracefully', async () => {
      const model = createOnDeviceModel();

      const result = await model.infer(-1, 25);
      expect(result.preferenceScore).toBe(0.5);
      expect(result.usedModel).toBe(false);
    });
  });

  describe('Pattern learning', () => {
    it('becomes ready after sufficient training samples', () => {
      const model = createOnDeviceModel();

      // Train with enough patterns
      for (let i = 0; i < MIN_PATTERNS_FOR_MODEL; i++) {
        model.train({
          dayOfWeek: 1,
          hourSlot: 10,
          acceptanceRate: 0.9,
          averageDuration: 30,
          sampleCount: 1,
        });
      }

      expect(model.isReady()).toBe(true);
    });

    it('uses learned model after sufficient training', async () => {
      const model = createOnDeviceModel();

      for (let i = 0; i < MIN_PATTERNS_FOR_MODEL; i++) {
        model.train({
          dayOfWeek: 1,
          hourSlot: 10,
          acceptanceRate: 0.9,
          averageDuration: 30,
          sampleCount: 1,
        });
      }

      const result = await model.infer(1, 10);
      expect(result.usedModel).toBe(true);
    });

    it('initializes from existing patterns', async () => {
      const patterns: LearnedPattern[] = [];
      for (let i = 0; i < MIN_PATTERNS_FOR_MODEL; i++) {
        patterns.push({
          dayOfWeek: 2,
          hourSlot: 14,
          acceptanceRate: 0.85,
          averageDuration: 45,
          sampleCount: 1,
        });
      }

      const model = createOnDeviceModel(patterns);
      expect(model.isReady()).toBe(true);

      const result = await model.infer(2, 14);
      expect(result.usedModel).toBe(true);
    });

    it('skips invalid patterns silently', () => {
      const model = createOnDeviceModel();

      // Invalid day/hour should not crash
      expect(() =>
        model.train({
          dayOfWeek: 8,
          hourSlot: 25,
          acceptanceRate: 0.5,
          averageDuration: 30,
          sampleCount: 1,
        }),
      ).not.toThrow();
    });
  });

  describe('Data stays on device', () => {
    it('getWeights returns a copy (not a reference)', () => {
      const model = createOnDeviceModel();
      const weights1 = model.getWeights();
      const weights2 = model.getWeights();

      // Modifying one should not affect the other
      weights1.slotScores[0][0] = 999;
      expect(weights2.slotScores[0][0]).not.toBe(999);
    });

    it('model weights contain no event details', () => {
      const model = createOnDeviceModel();
      model.train({
        dayOfWeek: 1,
        hourSlot: 10,
        acceptanceRate: 0.9,
        averageDuration: 30,
        sampleCount: 5,
      });

      const weights = model.getWeights();
      const serialized = JSON.stringify(weights);

      // Should only contain numeric data, no event titles/descriptions/names
      expect(serialized).not.toContain('title');
      expect(serialized).not.toContain('description');
      expect(serialized).not.toContain('attendee');
    });
  });
});
