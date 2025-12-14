import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/ThemeToggle';

// Fallback server data for direct navigation
const fallbackServer = {
  name: 'Unknown Server',
  status: 'connected' as const,
  latency: 0,
};

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const server = location.state?.server || fallbackServer;

  const navItems = [
    { label: 'Tools', path: '/tools' },
    { label: 'Resources', path: '/resources' },
    { label: 'Prompts', path: '/prompts' },
    { label: 'Logs', path: '/logs' },
    { label: 'Tasks', path: '/tasks' },
    { label: 'History', path: '/history' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-full items-center justify-between px-4">
          {/* Left side: Server dropdown and status */}
          <div className="flex items-center gap-4">
            <button className="flex items-center gap-1 hover:bg-accent rounded px-2 py-1">
              <span className="font-semibold">{server.name}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>

            <div className="flex items-center gap-2">
              <Badge variant="success">Connected</Badge>
              <span className="text-sm text-muted-foreground">
                ({server.latency || 0}ms)
              </span>
            </div>
          </div>

          {/* Center: Navigation - hidden on mobile, visible on md+ */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    'px-3 py-2 text-sm font-medium rounded-md transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Mobile Navigation Dropdown - visible on mobile only */}
          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                {navItems.map((item) => (
                  <DropdownMenuItem key={item.path} asChild>
                    <NavLink
                      to={item.path}
                      className={({ isActive }) =>
                        cn(isActive && 'bg-accent')
                      }
                    >
                      {item.label}
                    </NavLink>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Right side: Theme toggle and Disconnect */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              className="text-red-400 border-red-400/50 hover:bg-red-400/10"
              onClick={() => navigate('/')}
            >
              Disconnect
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}
