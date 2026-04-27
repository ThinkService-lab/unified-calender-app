# Zustand - State Management

Source: https://github.com/pmndrs/zustand

## Overview
Zustand is a small, fast, scalable state management solution for React using simplified flux principles. Hook-based API, no boilerplate, no providers needed.

## Why Zustand
- Handles zombie child problem, React concurrency, and context loss between mixed renderers
- No context providers needed
- Components only re-render on changes (unlike React Context)
- Simple, un-opinionated, action-based

## Core Usage

### Create a Store
```ts
import { create } from 'zustand'

const useBearStore = create((set) => ({
  bears: 0,
  increasePopulation: () => set((state) => ({ bears: state.bears + 1 })),
  removeAllBears: () => set({ bears: 0 }),
}))
```

### Use in Components
```tsx
function BearCounter() {
  const bears = useBearStore((state) => state.bears)
  return <h1>{bears} around here ...</h1>
}
```

## Best Practices

### Selecting State
- Use selectors to pick atomic state slices (strict equality by default)
- Use `useShallow` for object/array picks to prevent unnecessary rerenders
- Custom equality functions available via `createWithEqualityFn`

### Async Actions
```ts
const useFishStore = create((set) => ({
  fishies: {},
  fetch: async (pond) => {
    const response = await fetch(pond)
    set({ fishies: await response.json() })
  },
}))
```

### Persist Middleware
```ts
import { persist, createJSONStorage } from 'zustand/middleware'

const useFishStore = create(
  persist(
    (set, get) => ({
      fishes: 0,
      addAFish: () => set({ fishes: get().fishes + 1 }),
    }),
    {
      name: 'food-storage',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
)
```

### Immer Middleware
```ts
import { immer } from 'zustand/middleware/immer'

const useBeeStore = create(
  immer((set) => ({
    bees: 0,
    addBees: (by) => set((state) => { state.bees += by }),
  })),
)
```

### Devtools
```ts
import { devtools } from 'zustand/middleware'
const usePlainStore = create(devtools((set) => ...))
```

### Vanilla Store (without React)
```ts
import { createStore } from 'zustand/vanilla'
const store = createStore((set) => ...)
const { getState, setState, subscribe } = store
```

### Transient Updates (high-frequency)
Use `subscribe` + `useRef` for state changes that shouldn't trigger re-renders.

### TypeScript
Use `create<State>()(...)` pattern for proper type inference.
