import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { useArgs } from "storybook/preview-api";
import {
  ClientSettingsModal,
  type ClientSettingsModalProps,
} from "./ClientSettingsModal";
import type { ClientSettingsFormValues } from "../ClientSettingsForm/clientSettingsValues";

const configuredSettings: ClientSettingsFormValues = {
  emaEnabled: true,
  issuer: "https://idp.example.com",
  clientId: "inspector-idp-client",
  clientSecret: "super-secret-idp-value",
};

function InteractiveRender(args: ClientSettingsModalProps) {
  const [, updateArgs] = useArgs<ClientSettingsModalProps>();

  return (
    <AppShell>
      <AppShell.Main>
        <ClientSettingsModal
          {...args}
          onSettingsChange={(settings) => {
            args.onSettingsChange(settings);
            updateArgs({ settings });
          }}
        />
      </AppShell.Main>
    </AppShell>
  );
}

const meta: Meta<typeof ClientSettingsModal> = {
  title: "Groups/ClientSettingsModal",
  component: ClientSettingsModal,
  parameters: { layout: "fullscreen" },
  render: InteractiveRender,
  args: {
    opened: true,
    onClose: fn(),
    onSettingsChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ClientSettingsModal>;

export const Configured: Story = {
  args: {
    settings: configuredSettings,
  },
};

export const Empty: Story = {
  args: {
    settings: {
      emaEnabled: false,
      issuer: "",
      clientId: "",
      clientSecret: "",
    },
  },
};

export const EnabledEmptyFields: Story = {
  args: {
    settings: {
      emaEnabled: true,
      issuer: "",
      clientId: "",
      clientSecret: "",
    },
  },
};
