/**
 * Vitest/Vite resolve aliases shared between clients/web and node clients
 * (cli, tui). Pass each client's directory so bare-module pins resolve against
 * that client's node_modules.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function vitestSharedPaths(clientDir: string) {
  const dirname = path.resolve(clientDir);
  const repoRoot = path.resolve(dirname, '../..');

  const sharedAliases = {
    '@inspector/core': path.resolve(repoRoot, 'core'),
    '@modelcontextprotocol/inspector-test-server': path.resolve(
      repoRoot,
      'test-servers/build/index.js',
    ),
  };

  const sharedDedupe = [
    'react',
    'react-dom',
    '@modelcontextprotocol/client',
    '@modelcontextprotocol/core',
  ];

  const nodeModulesAliases = [
    { find: /^react$/, replacement: path.resolve(dirname, 'node_modules/react') },
    {
      find: /^react\/jsx-runtime$/,
      replacement: path.resolve(dirname, 'node_modules/react/jsx-runtime.js'),
    },
    {
      find: /^react\/jsx-dev-runtime$/,
      replacement: path.resolve(dirname, 'node_modules/react/jsx-dev-runtime.js'),
    },
    {
      find: /^react-dom$/,
      replacement: path.resolve(dirname, 'node_modules/react-dom'),
    },
    {
      find: /^react-dom\/client$/,
      replacement: path.resolve(dirname, 'node_modules/react-dom/client.js'),
    },
    { find: /^pino$/, replacement: path.resolve(dirname, 'node_modules/pino') },
    {
      find: /^pino\/browser\.js$/,
      replacement: path.resolve(dirname, 'node_modules/pino/browser.js'),
    },
    {
      find: /^hono$/,
      replacement: path.resolve(dirname, 'node_modules/hono/dist/index.js'),
    },
    {
      find: /^hono\/streaming$/,
      replacement: path.resolve(dirname, 'node_modules/hono/dist/helper/streaming/index.js'),
    },
    {
      find: /^@hono\/node-server$/,
      replacement: path.resolve(dirname, 'node_modules/@hono/node-server'),
    },
    { find: /^atomically$/, replacement: path.resolve(dirname, 'node_modules/atomically') },
    { find: /^chokidar$/, replacement: path.resolve(dirname, 'node_modules/chokidar') },
    {
      find: /^@napi-rs\/keyring$/,
      replacement: path.resolve(dirname, 'node_modules/@napi-rs/keyring'),
    },
    { find: /^express$/, replacement: path.resolve(dirname, 'node_modules/express') },
    { find: /^yaml$/, replacement: path.resolve(repoRoot, 'node_modules/yaml') },
  ];

  const projectResolve = {
    alias: [
      ...Object.entries(sharedAliases).map(([find, replacement]) => ({ find, replacement })),
      ...nodeModulesAliases,
    ],
    dedupe: sharedDedupe,
  };

  return { repoRoot, sharedAliases, sharedDedupe, nodeModulesAliases, projectResolve };
}

/** Convenience for importers that only have import.meta.url. */
export function vitestSharedPathsFromMetaUrl(metaUrl: string) {
  const clientDir = path.dirname(fileURLToPath(metaUrl));
  return vitestSharedPaths(clientDir);
}
