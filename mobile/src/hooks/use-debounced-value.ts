import { useEffect, useState } from 'react';

// Waits for the text to stop changing before returning it, so typing in a
// search box does not fire a request for every keystroke.
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, settled]);

  return settled;
}
