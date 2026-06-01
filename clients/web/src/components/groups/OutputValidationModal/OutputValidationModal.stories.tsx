import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import {
  OutputValidationModal,
  type OutputValidationModalProps,
} from "./OutputValidationModal";

const SAMPLE_MESSAGE = [
  "data/samples/0 must NOT have additional properties",
  "data/samples/1 must NOT have additional properties",
  "data/samples/2 must NOT have additional properties",
  "data/samples/3 must NOT have additional properties",
  "data/samples/4 must NOT have additional properties",
].join(", ");

function InteractiveRender(args: OutputValidationModalProps) {
  return (
    <AppShell>
      <AppShell.Main>
        <OutputValidationModal {...args} />
      </AppShell.Main>
    </AppShell>
  );
}

const meta: Meta<typeof OutputValidationModal> = {
  title: "Groups/OutputValidationModal",
  component: OutputValidationModal,
  parameters: { layout: "fullscreen" },
  render: InteractiveRender,
  args: {
    opened: true,
    onClose: fn(),
    toolName: "open_pattern_editor",
    message: SAMPLE_MESSAGE,
  },
};

export default meta;
type Story = StoryObj<typeof OutputValidationModal>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    // Mantine renders the modal in a portal at document.body.
    const body = within(canvasElement.ownerDocument.body);
    await body.findByText("Output schema validation");
    expect(body.getByText(/open_pattern_editor/)).toBeInTheDocument();
    const details = body.getByLabelText(
      "Validation details",
    ) as HTMLTextAreaElement;
    expect(details.value).toContain(
      "data/samples/0 must NOT have additional properties",
    );
    expect(details.readOnly).toBe(true);
  },
};

export const WithoutToolName: Story = {
  args: { toolName: undefined },
};
