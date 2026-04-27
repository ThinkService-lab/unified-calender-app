# fast-check - Property-Based Testing

Source: https://github.com/dubzzz/fast-check

## Overview
fast-check is a property-based testing framework for JavaScript/TypeScript (like QuickCheck). It checks that properties hold true for all generated inputs.

## Core Concept
A property is: "for all (x, y, ...) such that precondition(x, y, ...) holds, predicate(x, y, ...) is true"

## Installation
```bash
npm install fast-check --save-dev
```

## Basic Usage

```ts
import fc from 'fast-check';

describe('properties', () => {
  it('should always contain itself', () => {
    fc.assert(fc.property(fc.string(), (text) => contains(text, text)));
  });

  it('should always contain its substrings', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (a, b, c) => {
        return contains(a + b + c, b);
      }),
    );
  });
});
```

## Failure Output
```
Error: Property failed after 1 tests (seed: 1527422598337, path: 0:0): ["","",""]
Shrunk 1 time(s)
Got error: Property failed by returning false
```

## Key Strengths
- Strong TypeScript types
- Extensible: `map`, `chain` (flatMap), `fc.pre()` for preconditions
- Smart shrinking on `fc.oneof`
- Biased by default (generates both small and large values)
- Verbose mode for debugging
- Replay directly on minimal counterexample
- Model-based testing for UIs, APIs, state machines
- Race condition detection for async code
- Custom examples alongside generated ones
- Logger per predicate run (`fc.context`)

## Compatibility
| fast-check | node     | ECMAScript | TypeScript |
|-----------|----------|------------|------------|
| 4.x       | ≥12.17.0 | ES2020     | ≥5.0       |
| 3.x       | ≥8       | ES2017     | ≥4.1       |

## Built-in Arbitraries (Generators)
- Primitives: `fc.integer()`, `fc.float()`, `fc.string()`, `fc.boolean()`
- Dates: `fc.date()`
- Arrays: `fc.array()`, `fc.uniqueArray()`
- Objects: `fc.object()`, `fc.record()`
- Combinators: `fc.oneof()`, `fc.option()`, `fc.tuple()`
- Custom: `.map()`, `.chain()`, `.filter()`

## Configuration Options
```ts
fc.assert(
  fc.property(arbInput, (input) => { /* ... */ }),
  { numRuns: 100, seed: 42, verbose: true }
);
```

## Trusted By
jest, jasmine, fp-ts, io-ts, ramda, js-yaml, query-string, and many others.
