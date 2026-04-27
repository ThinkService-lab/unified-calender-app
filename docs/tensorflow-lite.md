# TensorFlow Lite / LiteRT - On-Device ML

Source: https://www.tensorflow.org/lite/guide

## Overview
LiteRT (formerly TensorFlow Lite) is Google's on-device framework for high-performance ML and GenAI deployment on edge platforms. It powers 100K+ applications with billions of global users.

## Key Features
- Cross-platform: Android, iOS, embedded devices
- Hardware acceleration: GPU, NPU, DSP delegates
- Multi-framework support: Convert from TensorFlow, PyTorch, JAX
- Post-training quantization for model optimization
- Low latency, high privacy (data stays on device)

## Deployment Workflow
1. **Obtain a model**: Use pre-trained `.tflite` models or convert from PyTorch/JAX/TensorFlow
2. **Optimize**: Use LiteRT optimization toolkit for post-training quantization
3. **Run**: Deploy with LiteRT runtime, select optimal accelerator

## Usage in Unified Calendar App

### On-Device Pattern Learning
TensorFlow Lite is used for the AI Scheduling Assistant's pattern learning component:
- Model learns user's scheduling preferences from local event data
- Inputs: day of week, hour, event duration, acceptance/decline history
- Outputs: acceptance probability scores per time slot
- Model runs entirely on-device (no data sent to server)
- Trained incrementally as user interacts with calendar

### Model Architecture
- Small feedforward neural network (~50KB model size)
- Input features: day_of_week (7), hour_slot (24), duration_bucket (5), historical_acceptance_rate
- Output: acceptance_probability (0-1 float)
- Quantized to INT8 for minimal memory/CPU footprint

### React Native Integration
- Use `react-native-tflite` or `expo-tflite` for React Native bridge
- Model file bundled with app assets
- Inference runs on background thread to avoid UI jank

### Privacy
- All training data stays on device
- Model weights are device-local, never uploaded
- Server-side LLM (separate component) only receives anonymized availability windows, not event details

## Best Practices
1. Keep model size under 1MB for fast loading
2. Use INT8 quantization for mobile
3. Run inference off the main thread
4. Retrain periodically (e.g., weekly) with accumulated local data
5. Provide fallback heuristics if model isn't ready (new users with insufficient data)
