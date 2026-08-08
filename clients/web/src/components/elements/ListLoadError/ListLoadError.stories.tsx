import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ListLoadError } from "./ListLoadError";

const meta: Meta<typeof ListLoadError> = {
  title: "Elements/ListLoadError",
  component: ListLoadError,
};

export default meta;
type Story = StoryObj<typeof ListLoadError>;

/** The failure this was built for: a modern server returning a list result the
 *  SDK codec rejects (#1953). */
export const CodecRejection: Story = {
  args: {
    what: "tools",
    error: new Error(
      'Invalid result for tools/list: [\n  {\n    "expected": "number",\n    "code": "invalid_type",\n    "path": [\n      "ttlMs"\n    ]\n  }\n]',
    ),
    onRetry: fn(),
  },
};

export const TransportFailure: Story = {
  args: {
    what: "prompts",
    error: new Error("fetch failed: ECONNREFUSED 127.0.0.1:3100"),
    onRetry: fn(),
  },
};

/** No retry handler — the alert renders without the affordance. */
export const WithoutRetry: Story = {
  args: {
    what: "resources",
    error: new Error("Request timed out"),
  },
};

/** The resting state: no error, nothing rendered. */
export const NoError: Story = {
  args: {
    what: "tools",
    error: null,
    onRetry: fn(),
  },
};
