// Shared vitest setup for the TUI renderer tests.
//
// Each ink-testing-library mount of a component that listens for terminal
// resizes (App.tsx and the test modals) registers a `process.stdout` "resize"
// listener for its lifetime. Across a file's many mount/unmount cycles the
// transient count briefly exceeds Node's default warning threshold of 10,
// printing a misleading "MaxListenersExceededWarning" (the listeners are
// removed on unmount — there is no real leak). Raising the cap here, in a
// setupFile that every test file inherits, silences the noise everywhere
// rather than per-file.
process.stdout.setMaxListeners(100);
process.stdin.setMaxListeners(100);
