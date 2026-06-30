// Type stub for the deep `react-syntax-highlighter` runtime import. Under
// bundler module resolution the real `.js` shadows the ambient declarations in
// `@types/react-syntax-highlighter`, so we redirect the specifier here via a
// `paths` entry in tsconfig.app.json (the same pattern the repo uses for
// `react`/`pino`). The default export is opaque; CodeHighlight casts it to its
// own runtime type.
declare const PrismLight: unknown;
export default PrismLight;
