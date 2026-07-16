import { useState, useEffect } from 'react';

/**
 * Returns a debounced version of the input value.
 * The debounced value updates `delay` ms after the input stops changing.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
