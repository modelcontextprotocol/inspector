import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter } from 'react-router-dom';
import { McpProvider } from '@/context';
import App from './App';

// NOTE: Storage providers (ServerConfig, History, Logs, Execution) are not included
// pending storage decision per issue #983. Pages use mock data for now.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="auto">
      <Notifications position="top-right" />
      <McpProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </McpProvider>
    </MantineProvider>
  </StrictMode>
);
