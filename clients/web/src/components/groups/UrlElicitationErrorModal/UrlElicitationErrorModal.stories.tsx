import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import {
  UrlElicitationErrorModal,
  type UrlElicitationErrorModalProps,
} from "./UrlElicitationErrorModal";

const SAMPLE_DETAILS = JSON.stringify(
  {
    code: -32042,
    message: "This request requires browser-based authorization.",
    data: {},
  },
  null,
  2,
);

function InteractiveRender(args: UrlElicitationErrorModalProps) {
  return (
    <AppShell>
      <AppShell.Main>
        <UrlElicitationErrorModal {...args} />
      </AppShell.Main>
    </AppShell>
  );
}

const meta: Meta<typeof UrlElicitationErrorModal> = {
  title: "Groups/UrlElicitationErrorModal",
  component: UrlElicitationErrorModal,
  parameters: { layout: "fullscreen" },
  render: InteractiveRender,
  args: {
    opened: true,
    onClose: fn(),
    toolName: "trigger-url-elicitation",
    details: SAMPLE_DETAILS,
  },
};

export default meta;
type Story = StoryObj<typeof UrlElicitationErrorModal>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    // Mantine renders the modal in a portal at document.body.
    const body = within(canvasElement.ownerDocument.body);
    await body.findByText("URL elicitation required");
    expect(body.getByText(/trigger-url-elicitation/)).toBeInTheDocument();
    const details = body.getByLabelText("Error details") as HTMLTextAreaElement;
    expect(details.value).toContain("-32042");
    expect(details.readOnly).toBe(true);
  },
};

export const WithoutToolName: Story = {
  args: { toolName: undefined },
};
