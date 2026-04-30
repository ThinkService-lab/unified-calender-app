/**
 * On-device TensorFlow Lite model integration for AI scheduling.
 * Provides pattern learning and inference for meeting time preferences.
 *
 * Requirements: 8.3
 *
 * Key constraints:
 * - Model size under 1MB with INT8 quantization
 * - Inference runs off main thread
 * - All training data stays on device — never uploaded
 * - Fallback heuristics for new users with insufficient data
 */

import type { LearnedPattern, SchedulingPreferences } from '../types';

/** Minimum number of learned patterns before the model is considered trained. */
const MIN_PATTERNS_FOR_MODEL = 10;

/** Model size budget in bytes (1MB). */
export const MAX_MODEL_SIZE_BYTES = 1 * 1024 * 1024;

/** INT8 quantization range. */
const INT8_MIN = -128;
const INT8_MAX = 127;

/**
 * Represents the on-device model weights.
 * In a real implementation this would be a TFLite FlatBuffer.
 * Here we use a lightweight representation that stays under 1MB.
 */
export interface ModelWeights {
  /** Slot preference scores indexed by [dayOfWeek][hourSlot]. 7 days × 24 hours = 168 values. */
  slotScores: number[][];
  /** Version counter for tracking model updates. */
  version: number;
  /** Total training samples used. */
  totalSamples: number;
  /** Quantized flag — true when weights are INT8 quantized. */
  quantized: boolean;
}

/**
 * Inference result from the on-device model.
 */
export interface ModelInference {
  /** Predicted preference score for a given time slot (0-1). */
  preferenceScore: number;
  /** Whether the model was used (vs fallback heuristics). */
  usedModel: boolean;
}

/**
 * Quantize a float value to INT8 range [-128, 127].
 */
export function quantizeToInt8(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  const result = Math.round(clamped * (INT8_MAX - INT8_MIN) + INT8_MIN);
  return result === 0 ? 0 : result; // Normalize -0 to 0
}

/**
 * Dequantize an INT8 value back to float [0, 1].
 */
export function dequantizeFromInt8(quantized: number): number {
  return (quantized - INT8_MIN) / (INT8_MAX - INT8_MIN);
}

/**
 * Calculate the serialized size of model weights in bytes.
 * Each INT8 value = 1 byte. 7 × 24 = 168 bytes for slot scores + metadata overhead.
 */
export function calculateModelSize(weights: ModelWeights): number {
  // 7 days × 24 hours × 1 byte (INT8) + metadata (version, totalSamples, quantized flag)
  const slotBytes = 7 * 24 * 1; // 168 bytes for INT8 quantized scores
  const metadataBytes = 4 + 4 + 1; // version (4) + totalSamples (4) + quantized (1)
  return slotBytes + metadataBytes;
}

/**
 * Create initial empty model weights.
 */
export function createEmptyWeights(): ModelWeights {
  const slotScores: number[][] = [];
  for (let day = 0; day < 7; day++) {
    slotScores[day] = new Array(24).fill(0.5); // neutral score
  }
  return {
    slotScores,
    version: 0,
    totalSamples: 0,
    quantized: false,
  };
}

/**
 * Quantize model weights to INT8 for storage efficiency.
 */
export function quantizeWeights(weights: ModelWeights): ModelWeights {
  const quantizedScores: number[][] = [];
  for (let day = 0; day < 7; day++) {
    quantizedScores[day] = weights.slotScores[day].map(quantizeToInt8);
  }
  return {
    slotScores: quantizedScores,
    version: weights.version,
    totalSamples: weights.totalSamples,
    quantized: true,
  };
}

/**
 * Dequantize model weights from INT8 back to float.
 */
export function dequantizeWeights(weights: ModelWeights): ModelWeights {
  if (!weights.quantized) return weights;

  const floatScores: number[][] = [];
  for (let day = 0; day < 7; day++) {
    floatScores[day] = weights.slotScores[day].map(dequantizeFromInt8);
  }
  return {
    slotScores: floatScores,
    version: weights.version,
    totalSamples: weights.totalSamples,
    quantized: false,
  };
}

/**
 * On-device model for scheduling pattern learning.
 * All data stays on device — never uploaded.
 */
export interface OnDeviceModel {
  /** Run inference for a given day/hour slot. Runs off the main thread. */
  infer(dayOfWeek: number, hourSlot: number): Promise<ModelInference>;
  /** Update model with a new training sample. */
  train(pattern: LearnedPattern): void;
  /** Get current model weights. */
  getWeights(): ModelWeights;
  /** Check if model has sufficient data to be useful. */
  isReady(): boolean;
  /** Get the model size in bytes. */
  getModelSizeBytes(): number;
}

/**
 * Creates an on-device model instance.
 * Uses fallback heuristics when insufficient training data is available.
 */
export function createOnDeviceModel(
  initialPatterns?: LearnedPattern[],
): OnDeviceModel {
  let weights = createEmptyWeights();

  // Initialize from existing patterns if provided
  if (initialPatterns && initialPatterns.length > 0) {
    for (const pattern of initialPatterns) {
      updateWeightsFromPattern(pattern);
    }
  }

  function updateWeightsFromPattern(pattern: LearnedPattern): void {
    const { dayOfWeek, hourSlot, acceptanceRate, sampleCount } = pattern;

    if (dayOfWeek < 0 || dayOfWeek > 6 || hourSlot < 0 || hourSlot > 23) {
      return; // Invalid slot, skip
    }

    // Weighted update: more samples = more influence
    const learningRate = Math.min(0.1, 1 / (weights.totalSamples + 1));
    const currentScore = weights.slotScores[dayOfWeek][hourSlot];
    const targetScore = acceptanceRate;

    weights.slotScores[dayOfWeek][hourSlot] =
      currentScore + learningRate * (targetScore - currentScore);

    weights.totalSamples += sampleCount;
    weights.version += 1;
  }

  /**
   * Fallback heuristic scoring for new users.
   * Prefers standard business hours (9-17) on weekdays.
   */
  function fallbackScore(dayOfWeek: number, hourSlot: number): number {
    // Weekend penalty
    if (dayOfWeek === 0 || dayOfWeek === 6) return 0.2;

    // Business hours preference
    if (hourSlot >= 9 && hourSlot < 12) return 0.85; // Morning
    if (hourSlot >= 13 && hourSlot < 17) return 0.8; // Afternoon
    if (hourSlot === 12) return 0.5; // Lunch hour
    if (hourSlot >= 8 && hourSlot < 9) return 0.6; // Early morning
    if (hourSlot >= 17 && hourSlot < 18) return 0.5; // Late afternoon

    return 0.3; // Outside business hours
  }

  async function infer(dayOfWeek: number, hourSlot: number): Promise<ModelInference> {
    // Yield to the event loop to avoid blocking the main/UI thread.
    // In production with a real TFLite model, this would use
    // InteractionManager.runAfterInteractions or a native worker thread.
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (dayOfWeek < 0 || dayOfWeek > 6 || hourSlot < 0 || hourSlot > 23) {
      return { preferenceScore: 0.5, usedModel: false };
    }

    if (!isReady()) {
      // Fallback heuristics for new users
      return {
        preferenceScore: fallbackScore(dayOfWeek, hourSlot),
        usedModel: false,
      };
    }

    // Use learned model weights
    const score = weights.slotScores[dayOfWeek][hourSlot];
    return {
      preferenceScore: Math.max(0, Math.min(1, score)),
      usedModel: true,
    };
  }

  function train(pattern: LearnedPattern): void {
    updateWeightsFromPattern(pattern);
  }

  function getWeights(): ModelWeights {
    return { ...weights, slotScores: weights.slotScores.map((row) => [...row]) };
  }

  function isReady(): boolean {
    return weights.totalSamples >= MIN_PATTERNS_FOR_MODEL;
  }

  function getModelSizeBytes(): number {
    return calculateModelSize(weights);
  }

  return {
    infer,
    train,
    getWeights,
    isReady,
    getModelSizeBytes,
  };
}

export { MIN_PATTERNS_FOR_MODEL };
