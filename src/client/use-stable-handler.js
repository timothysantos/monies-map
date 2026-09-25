import { useCallback, useInsertionEffect, useRef } from "react";

// Returns a function whose identity never changes but always calls the
// latest handler. Memoized list rows receive it so a parent re-render does
// not re-render every row just because a closure was recreated.
// Only call the result from events and effects, never during render.
export function useStableHandler(handler) {
  const handlerRef = useRef(handler);
  useInsertionEffect(() => {
    handlerRef.current = handler;
  });
  return useCallback((...args) => handlerRef.current?.(...args), []);
}
