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
 * ⚠️ **`onChange` runs during render, so it must be pure** — `setState` calls
 * and nothing else. No fetches, no DOM writes, no logging, no ref mutation, no
 * parent callbacks. A render can be replayed or thrown away (StrictMode
 * double-renders in development; concurrent React can abandon an in-progress
 * render at any time), so anything external would run an unpredictable number
 * of times. Real external work belongs in a `useEffect`, which is exactly the
 * split `NetworkEntry` uses: the reveal's force-open is a state update and
 * lives here, while its `requestAnimationFrame` scroll stays an effect.
 *
 * The obvious-looking alternative — `useEffect(() => setX(prop), [prop])` — is
 * worse and is reported by `react-hooks/set-state-in-effect`: the effect only
 * runs *after* the component has already painted with the stale value, so the
 * user sees one frame of the old state and React has to render twice. Adjusting
 * during render lets React discard the in-progress output and re-run the
 * component body before anything reaches the DOM.
 *
 * ⚠️ **`value` must be referentially stable across renders that mean "no
 * change".** The comparison is `Object.is`, so an object or array literal built
 * fresh in the component body looks different on every render — `onChange`
 * would fire every render, and because it is what updates state, that is an
 * infinite render loop rather than a merely wasteful one. Pass a **primitive
 * key** derived from the data (an id, a name, a URI) wherever one exists, and
 * otherwise a value that is already memoized or owned by the parent. This is
 * the same stability requirement a `useEffect` dependency array carries; the
 * difference is only that here the failure is loud and immediate.
 */
export function useValueChange<T>(value: T, onChange: (next: T) => void): void {
  const [previous, setPrevious] = useState(value);
  if (!Object.is(previous, value)) {
    setPrevious(value);
    onChange(value);
  }
}
