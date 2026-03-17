import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProgressDisplay } from './ProgressDisplay';

const meta: Meta<typeof ProgressDisplay> = {
  title: 'Atoms/ProgressDisplay',
  component: ProgressDisplay,
};

export default meta;
type Story = StoryObj<typeof ProgressDisplay>;

export const ZeroPercent: Story = {
  args: {
    progress: 0,
  },
};

export const HalfComplete: Story = {
  args: {
    progress: 50,
    description: 'Processing...',
  },
};

export const NearComplete: Story = {
  args: {
    progress: 95,
    description: 'Almost done',
    elapsed: '1m 30s',
  },
};

export const Complete: Story = {
  args: {
    progress: 100,
    description: 'Done',
    elapsed: '2m 15s',
  },
};
