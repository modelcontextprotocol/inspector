import type { Preview } from '@storybook/react-vite'
import { MantineProvider, useMantineColorScheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '../src/App.css'
import { theme } from '../src/theme/theme'
import { useEffect } from 'react'

function ColorSchemeWrapper({
  colorScheme,
  children,
}: {
  colorScheme: 'light' | 'dark'
  children: React.ReactNode
}) {
  const { setColorScheme } = useMantineColorScheme()

  useEffect(() => {
    setColorScheme(colorScheme)
  }, [colorScheme, setColorScheme])

  return <>{children}</>
}

const preview: Preview = {
  globalTypes: {
    colorScheme: {
      description: 'Mantine color scheme',
      toolbar: {
        title: 'Color Scheme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    colorScheme: 'light',
  },
  decorators: [
    (Story, context) => (
      <MantineProvider theme={theme} defaultColorScheme="light">
        <ColorSchemeWrapper colorScheme={context.globals.colorScheme ?? 'light'}>
          <Notifications position="top-right" />
          <Story />
        </ColorSchemeWrapper>
      </MantineProvider>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo',
    },
    layout: 'centered',
  },
}

export default preview
