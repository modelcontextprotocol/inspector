import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { PendingClientRequests } from './PendingClientRequests'
import { InlineSamplingRequest } from '../InlineSamplingRequest/InlineSamplingRequest'
import { InlineElicitationRequest } from '../InlineElicitationRequest/InlineElicitationRequest'

const meta: Meta<typeof PendingClientRequests> = {
  title: 'Molecules/PendingClientRequests',
  component: PendingClientRequests,
}

export default meta
type Story = StoryObj<typeof PendingClientRequests>

export const SingleSampling: Story = {
  args: {
    count: 1,
    children: (
      <InlineSamplingRequest
        queuePosition="1 of 1"
        messagePreview="Please analyze the following code and suggest improvements."
        responseText=""
        onAutoRespond={fn()}
        onEditAndSend={fn()}
        onReject={fn()}
        onViewDetails={fn()}
      />
    ),
  },
}

export const SingleElicitation: Story = {
  args: {
    count: 1,
    children: (
      <InlineElicitationRequest
        mode="form"
        message="Please provide your database connection details."
        queuePosition="1 of 1"
        schema={{
          type: 'object',
          properties: {
            host: { type: 'string', title: 'Host' },
            port: { type: 'integer', title: 'Port' },
          },
          required: ['host'],
        }}
        values={{}}
        onChange={fn()}
        onSubmit={fn()}
        onCancel={fn()}
      />
    ),
  },
}

export const MultipleMixed: Story = {
  args: {
    count: 2,
    children: (
      <>
        <InlineSamplingRequest
          queuePosition="1 of 2"
          messagePreview="Please analyze the following code and suggest improvements."
          responseText=""
          onAutoRespond={fn()}
          onEditAndSend={fn()}
          onReject={fn()}
          onViewDetails={fn()}
        />
        <InlineElicitationRequest
          mode="form"
          message="Please confirm the deployment target."
          queuePosition="2 of 2"
          schema={{
            type: 'object',
            properties: {
              environment: {
                type: 'string',
                title: 'Environment',
                enum: ['staging', 'production'],
              },
              confirm: { type: 'boolean', title: 'Confirm deployment' },
            },
            required: ['environment', 'confirm'],
          }}
          values={{}}
          onChange={fn()}
          onSubmit={fn()}
          onCancel={fn()}
        />
      </>
    ),
  },
}
