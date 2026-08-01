import { useState } from "react";

/**
 * Call `onChange(next)` during render whenever `value` differs from the value
 * seen on the previous render of this component. Nothing is called on the first
 * render — seed the dependent state with `useState` instead.
 *
 * This is React's documented "adjusting state during render" pattern
 * (https://react.dev/reference/react/useState#storing-information-from-previous-renders),
 * and it is the supported way to reset or re-sync local state from a prop.
 *
 * The obvious-looking alternative — `useEffect(() => setX(prop), [prop])` — is
 * worse and is reported by `react-hooks/set-state-in-effect`: the effect only
 * runs *after* the component has already painted with the stale value, so the
 * user sees one frame of the old state and React has to render twice. Adjusting
 * during render lets React discard the in-progress output and re-run the
 * component body before anything reaches the DOM.
 */
export function useValueChange<T>(value: T, onChange: (next: T) => void): void {
  const [previous, setPrevious] = useState(value);
  if (!Object.is(previous, value)) {
    setPrevious(value);
    onChange(value);
  }
}
