import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter } from 'react-router-dom';
import { McpProvider, ExecutionProvider } from '@/context';
import App from './App';

// NOTE: Storage providers (ServerConfig, History, Logs) are not included
// pending storage decision per issue #983. Pages use mock data for now.
// ExecutionProvider is included for inline sampling/elicitation queue.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="auto">
      <Notifications position="top-right" />
      <McpProvider>
        <ExecutionProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ExecutionProvider>
      </McpProvider>
    </MantineProvider>
  </StrictMode>
);
