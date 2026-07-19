import type { Meta, StoryObj } from "@storybook/react-vite";
import type { LoggingLevel } from "@modelcontextprotocol/client";
import { fn } from "storybook/test";
import { LogControls } from "./LogControls";

const allLevelsVisible: Record<LoggingLevel, boolean> = {
  debug: true,
  info: true,
  notice: true,
  warning: true,
  error: true,
  critical: true,
  alert: true,
  emergency: true,
};

const meta: Meta<typeof LogControls> = {
  title: "Groups/LogControls",
  component: LogControls,
  args: {
    onSetLevel: fn(),
    onFilterChange: fn(),
    onToggleLevel: fn(),
    onToggleAllLevels: fn(),
    onSetModernLogLevel: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof LogControls>;

export const AllLevelsVisible: Story = {
  args: {
    currentLevel: "info",
    filterText: "",
    visibleLevels: allLevelsVisible,
  },
};

export const FilteredLevels: Story = {
  args: {
    currentLevel: "warning",
    filterText: "",
    visibleLevels: {
      debug: false,
      info: false,
      notice: false,
      warning: true,
      error: true,
      critical: true,
      alert: true,
      emergency: true,
    },
  },
};

export const WithFilterText: Story = {
  args: {
    currentLevel: "info",
    filterText: "connection timeout",
    visibleLevels: allLevelsVisible,
  },
};

export const DebugLevel: Story = {
  args: {
    currentLevel: "debug",
    filterText: "",
    visibleLevels: allLevelsVisible,
  },
};

// Modern era (#1629): the session-scoped `Set` selector is replaced by the
// per-request opt-in control. Not opted in yet, so the level reads "Off".
export const ModernNotOptedIn: Story = {
  args: {
    currentLevel: "info",
    filterText: "",
    visibleLevels: allLevelsVisible,
    protocolEra: "modern",
    modernLogLevel: null,
  },
};

// Modern era with a level chosen — stamped on every request's `_meta`.
export const ModernOptedIn: Story = {
  args: {
    currentLevel: "info",
    filterText: "",
    visibleLevels: allLevelsVisible,
    protocolEra: "modern",
    modernLogLevel: "debug",
  },
};
