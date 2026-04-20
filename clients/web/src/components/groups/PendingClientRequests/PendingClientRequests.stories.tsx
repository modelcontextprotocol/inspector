import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ElicitRequest } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { PendingClientRequests } from "./PendingClientRequests";
import { InlineSamplingRequest } from "../InlineSamplingRequest/InlineSamplingRequest";
import { InlineElicitationRequest } from "../InlineElicitationRequest/InlineElicitationRequest";

const meta: Meta<typeof PendingClientRequests> = {
  title: "Groups/PendingClientRequests",
  component: PendingClientRequests,
};

export default meta;
type Story = StoryObj<typeof PendingClientRequests>;

const elicitFormRequest = {
  message: "Please provide your database connection details.",
  requestedSchema: {
    type: "object" as const,
    properties: {
      host: { type: "string" as const, title: "Host" },
      port: { type: "string" as const, title: "Port" },
    },
  },
} satisfies ElicitRequest["params"];

const elicitDeployRequest = {
  message: "Please confirm the deployment target.",
  requestedSchema: {
    type: "object" as const,
    properties: {
      environment: {
        type: "string" as const,
        title: "Environment",
        enum: ["staging", "production"],
      },
      confirm: { type: "boolean" as const, title: "Confirm deployment" },
    },
  },
} satisfies ElicitRequest["params"];

export const SingleSampling: Story = {
  args: {
    count: 1,
    children: (
      <InlineSamplingRequest
        request={{
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "Please analyze the following code and suggest improvements.",
              },
            },
          ],
          maxTokens: 1024,
        }}
        queuePosition="1 of 1"
        responseText=""
        onAutoRespond={fn()}
        onEditAndSend={fn()}
        onReject={fn()}
        onViewDetails={fn()}
      />
    ),
  },
};

export const SingleElicitation: Story = {
  args: {
    count: 1,
    children: (
      <InlineElicitationRequest
        request={elicitFormRequest}
        queuePosition="1 of 1"
        values={{}}
        onChange={fn()}
        onSubmit={fn()}
        onCancel={fn()}
      />
    ),
  },
};

export const MultipleMixed: Story = {
  args: {
    count: 2,
    children: (
      <>
        <InlineSamplingRequest
          request={{
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: "Please analyze the following code and suggest improvements.",
                },
              },
            ],
            maxTokens: 1024,
          }}
          queuePosition="1 of 2"
          responseText=""
          onAutoRespond={fn()}
          onEditAndSend={fn()}
          onReject={fn()}
          onViewDetails={fn()}
        />
        <InlineElicitationRequest
          request={elicitDeployRequest}
          queuePosition="2 of 2"
          values={{}}
          onChange={fn()}
          onSubmit={fn()}
          onCancel={fn()}
        />
      </>
    ),
  },
};
