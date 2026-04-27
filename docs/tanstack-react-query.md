# TanStack Query (React Query) - Server State Management

Source: https://tanstack.com/query/latest/docs/framework/react/overview

## Overview
TanStack Query handles fetching, caching, synchronizing, and updating server state. It replaces manual data-fetching patterns with declarative, cache-aware queries.

## Key Capabilities
- Automatic caching and deduplication
- Background refetching and stale-while-revalidate
- Window focus refetching
- Pagination and infinite scroll
- Optimistic updates
- Offline support
- Memory management and garbage collection

## Basic Usage

```tsx
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Example />
    </QueryClientProvider>
  )
}

function Example() {
  const { isPending, error, data } = useQuery({
    queryKey: ['repoData'],
    queryFn: () =>
      fetch('https://api.github.com/repos/TanStack/query')
        .then((res) => res.json()),
  })

  if (isPending) return 'Loading...'
  if (error) return 'An error has occurred: ' + error.message

  return <div><h1>{data.name}</h1></div>
}
```

## Query States
- `isPending` / `status === 'pending'` — No data yet
- `isError` / `status === 'error'` — Error encountered
- `isSuccess` / `status === 'success'` — Data available

## Fetch Status
- `fetchStatus === 'fetching'` — Currently fetching
- `fetchStatus === 'paused'` — Wanted to fetch but paused (no network)
- `fetchStatus === 'idle'` — Not doing anything

## Best Practices
- Use unique, serializable query keys
- Check `isPending` → `isError` → render data
- Use `useMutation` for write operations
- Use query invalidation after mutations
- TypeScript narrows `data` type after status checks
