import type { Preview } from '@storybook/react-vite'
import { MantineProvider, useMantineColorScheme, type CSSVariablesResolver } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '../src/App.css'
import { theme } from '../src/theme/theme'
import { useEffect } from 'react'

// eslint-disable-next-line react-refresh/only-export-components
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

const resolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {},
  dark: {
    '--mantine-color-body': 'var(--mantine-color-dark-9)',
  },
})

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
    (Story, context) => {
      const isFullscreen = context.parameters?.layout === 'fullscreen'
      return (
        <MantineProvider theme={theme} defaultColorScheme="light" cssVariablesResolver={resolver}>
          <ColorSchemeWrapper colorScheme={context.globals.colorScheme ?? 'light'}>
            <Notifications position="top-right" />
            {isFullscreen ? (
              <div style={{ height: '100vh', overflow: 'hidden' }}>
                <Story />
              </div>
            ) : (
              <Story />
            )}
          </ColorSchemeWrapper>
        </MantineProvider>
      )
    },
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
