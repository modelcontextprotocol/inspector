import { Code } from '@mantine/core';

export const ThemeCode = Code.extend({
  styles: () => ({
    root: {
      backgroundColor: 'var(--inspector-surface-code)',
    },
  }),
});
