/**
 * AI scheduling module re-exports.
 */

export {
  createAISchedulingAssistant,
  MAX_SUGGESTIONS,
  MIN_PATTERN_SAMPLES,
  buildAnonymizedAvailability,
  hasTimeOverlap,
  hasConflict,
  countMeetingsOnDay,
  overlapsFocusTime,
  hasAdequateBuffer,
  isWithinPreferredHours,
  scoreSlot,
} from './aiSchedulingAssistant';
export type {
  AISchedulingAssistant,
  AISchedulingAssistantDeps,
  AIHttpClient,
} from './aiSchedulingAssistant';

export {
  createOnDeviceModel,
  createEmptyWeights,
  quantizeWeights,
  dequantizeWeights,
  quantizeToInt8,
  dequantizeFromInt8,
  calculateModelSize,
  MAX_MODEL_SIZE_BYTES,
  MIN_PATTERNS_FOR_MODEL,
} from './onDeviceModel';
export type {
  OnDeviceModel,
  ModelWeights,
  ModelInference,
} from './onDeviceModel';
