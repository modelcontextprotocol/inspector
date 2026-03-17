import { Paper } from '@mantine/core';

export const ThemePaper = Paper.extend({
  classNames: (_theme, props) => {
    if (props.variant === 'code') return { root: 'paper-code' };
    return {};
  },
  styles: (_theme, props) => {
    if (props.variant === 'code') {
      return {
        root: {
          padding: 'var(--mantine-spacing-md)',
          backgroundColor: 'var(--inspector-surface-code)',
          fontFamily: 'var(--mantine-font-family-monospace)',
          fontSize: 'var(--mantine-font-size-sm)',
          overflow: 'auto',
        },
      };
    }
    return { root: {} };
  },
});
