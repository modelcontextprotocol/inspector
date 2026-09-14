import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { FetchBodyDroppedToastMessage } from "./FetchBodyDroppedToastMessage";
import { OutputValidationToastMessage } from "./OutputValidationToastMessage";
import { UrlElicitationErrorToastMessage } from "./UrlElicitationErrorToastMessage";

// The bodies rendered inside a Mantine notification. They are shown here on
// their own so the copy and the affordance can be reviewed without provoking
// the failure that raises each one.
const meta: Meta = {
  title: "Elements/Toasts",
};

export default meta;

/** #1390 — a response body arrived after its Network log entry rotated out. */
export const FetchBodyDropped: StoryObj<typeof FetchBodyDroppedToastMessage> = {
  render: (args) => <FetchBodyDroppedToastMessage {...args} />,
  args: { maxFetchRequests: 250, onAdjust: fn() },
};

/** A tool result whose `structuredContent` doesn't match its `outputSchema`. */
export const OutputValidation: StoryObj<typeof OutputValidationToastMessage> = {
  render: (args) => <OutputValidationToastMessage {...args} />,
  args: { onViewDetails: fn() },
};

/** A non-spec `-32042` carrying no `elicitations`, so there is no URL to open. */
export const UrlElicitationError: StoryObj<
  typeof UrlElicitationErrorToastMessage
> = {
  render: (args) => <UrlElicitationErrorToastMessage {...args} />,
  args: { onViewDetails: fn() },
};
