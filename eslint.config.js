// ESLint flat config (eslint 9). Never run during the Dirty Mode construction run: see docs/DEFERRED-VALIDATION.md.
//
// Note on flat-config semantics: when two config objects both set the same rule for a file, the LATER object's
// options replace the earlier ones entirely (they are not merged). That is why the restricted-syntax and
// restricted-imports option lists are built from shared constants below, and why the M5 held-out block must
// re-include the core lists.
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// --- shared option lists ---------------------------------------------------------------------------------------

// Untrusted strings are rendered only as React text nodes (CL §2.8). react/no-danger covers JSX; these selectors
// also catch the prop when passed through createElement or an object spread.
const NO_DANGER_SYNTAX = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML is forbidden: render untrusted strings as text nodes.',
  },
  {
    selector: "Property[key.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML is forbidden: render untrusted strings as text nodes.',
  },
];

// Core determinism (PLAN §1 row 6, §4): no clock reads and no unseeded randomness in src/core/**.
const CORE_CLOCK_SYNTAX = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'src/core must not read the clock: pass asOf / timestamps in explicitly.',
  },
  {
    selector: "CallExpression[callee.name='Date']",
    message: 'Date() returns the current time; src/core must not read the clock.',
  },
  {
    selector: "CallExpression[callee.property.name='localeCompare']",
    message: 'Use the code-unit cmp() from src/core/stats/hash.ts; localeCompare is locale-dependent.',
  },
  {
    // no-restricted-properties only matches the literal object name `crypto`; this catches the same members reached
    // through any object, e.g. globalThis.crypto.getRandomValues() or self.crypto.randomUUID().
    selector: 'MemberExpression[property.name=/^(getRandomValues|randomUUID)$/]',
    message: 'src/core must not use unseeded randomness: use the seeded mulberry32 PRNG and ids derived from input data.',
  },
];

const CORE_RESTRICTED_IMPORTS = {
  paths: [
    ...['fs', 'path', 'os', 'crypto', 'child_process', 'worker_threads', 'url', 'util', 'buffer', 'stream', 'process', 'perf_hooks'].map(
      (name) => ({ name, message: 'src/core must stay Node-free and browser-safe; filesystem/OS access lives only in scripts/.' }),
    ),
    { name: 'react', message: 'src/core must not depend on React.' },
    { name: 'react-dom', message: 'src/core must not depend on React.' },
  ],
  patterns: [
    { group: ['node:*'], message: 'src/core must stay Node-free and browser-safe; node:* modules belong in scripts/.' },
    {
      group: ['**/ui', '**/ui/**', 'src/ui', 'src/ui/**'],
      message: 'src/core must never import from src/ui.',
    },
    {
      group: ['**/worker', '**/worker/**', 'src/worker', 'src/worker/**'],
      message: 'src/core must not import the worker; the worker imports core.',
    },
  ],
};

// --- config --------------------------------------------------------------------------------------------------------

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'data/**', 'results/**'],
  },

  ...tseslint.configs.recommended,

  // All app source: browser + worker globals, React rules, no dangerouslySetInnerHTML.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18.3' } },
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'react/no-danger': 'error',
      'react/jsx-no-target-blank': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-syntax': ['error', ...NO_DANGER_SYNTAX],
    },
  },

  // src/core/** purity: deterministic, DOM-free, Node-free (PLAN §1 row 6, §4; CL §2.4).
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/core must be DOM-free (it runs in the worker and in Node scripts).' },
        { name: 'document', message: 'src/core must be DOM-free.' },
        { name: 'localStorage', message: 'Persistence lives in src/ui/storage.ts, not in core.' },
        { name: 'sessionStorage', message: 'Persistence lives in src/ui/storage.ts, not in core.' },
        { name: 'navigator', message: 'src/core must not depend on the host environment.' },
        { name: 'process', message: 'src/core must stay Node-free.' },
        { name: 'Buffer', message: 'src/core must stay Node-free; use Uint8Array/TextEncoder.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'src/core must not read the clock: pass asOf in explicitly.' },
        { object: 'Math', property: 'random', message: 'Use the seeded mulberry32 PRNG from src/core/stats/prng.ts.' },
        { object: 'performance', property: 'now', message: 'Timing belongs in scripts/, never in core.' },
        { object: 'crypto', property: 'getRandomValues', message: 'Use the seeded mulberry32 PRNG.' },
        { object: 'crypto', property: 'randomUUID', message: 'Use deterministic ids derived from input data.' },
        { object: 'globalThis', property: 'window', message: 'src/core must be DOM-free.' },
        { object: 'globalThis', property: 'document', message: 'src/core must be DOM-free.' },
        { object: 'globalThis', property: 'localStorage', message: 'Persistence lives in src/ui/storage.ts.' },
        { object: 'globalThis', property: 'sessionStorage', message: 'Persistence lives in src/ui/storage.ts.' },
      ],
      'no-restricted-syntax': ['error', ...NO_DANGER_SYNTAX, ...CORE_CLOCK_SYNTAX],
      'no-restricted-imports': ['error', CORE_RESTRICTED_IMPORTS],
    },
  },

  // TODO(M5): held-out isolation (CL §7 F6c, PLAN M5 acceptance 2). Tuning modules must never import
  // src/core/eval/heldout.ts. The file globs below are a placeholder until M5 names its tuning modules; the rule
  // re-includes CORE_RESTRICTED_IMPORTS because a later block's options replace the core block's options.
  {
    files: ['src/core/eval/tune*.ts', 'src/core/eval/temporal.ts', 'src/core/eval/robustness.ts', 'src/core/eval/calibration.ts', 'src/core/eval/ablations.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: CORE_RESTRICTED_IMPORTS.paths,
          patterns: [
            ...CORE_RESTRICTED_IMPORTS.patterns,
            {
              group: ['**/heldout', '**/heldout.ts', '**/eval/heldout', 'src/core/eval/heldout'],
              message: 'Tuning/dev code must never load held-out data; only the final runner may import heldout.ts.',
            },
          ],
        },
      ],
    },
  },

  // Node-run code: scripts and config files.
  {
    files: ['scripts/**/*.ts', 'vite.config.ts', 'vitest.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Tests run under vitest in node.
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
