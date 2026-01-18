import { Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { ServerList } from './pages/ServerList';
import { Tools } from './pages/Tools';
import { Resources } from './pages/Resources';
import { Prompts } from './pages/Prompts';
import { Logs } from './pages/Logs';
import { Tasks } from './pages/Tasks';
import { History } from './pages/History';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ServerList />} />
      <Route element={<AppLayout />}>
        <Route path="/tools" element={<Tools />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/prompts" element={<Prompts />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/history" element={<History />} />
      </Route>
    </Routes>
  );
}
