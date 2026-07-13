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
      // `'error'` fails the Storybook play-function tests (part of `npm run ci`)
      // on any axe violation, so the zero-violation state this PR reached is
      // enforced going forward rather than being a point-in-time result.
      test: 'error',
      // Stories render presentational components (and whole screens) in
      // isolation, outside the app's `AppShell` — which is what provides the
      // page landmarks (`<main>`, nav) in the real app. The `region` rule
      // ("all content must live inside a landmark") is therefore a page-level
      // concern that can't be satisfied in Storybook isolation and would fire on
      // essentially every story; it's covered by the app shell at runtime, not
      // by the components under test. Disable it here so the a11y panel surfaces
      // only rules the components can actually own.
      config: {
        rules: [{ id: 'region', enabled: false }],
      },
    },
    layout: 'centered',
  },
}

export default preview
