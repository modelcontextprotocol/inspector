import { useState } from 'react';
import { Trash2, Plus, FolderOpen, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { initialRoots, type Root } from '@/mocks';

interface RootsConfigurationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RootsConfigurationModal({
  open,
  onOpenChange,
}: RootsConfigurationModalProps) {
  const [roots, setRoots] = useState<Root[]>(initialRoots);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');

  const handleRemove = (uri: string) => {
    setRoots((prev) => prev.filter((r) => r.uri !== uri));
    console.log('Roots updated - would send notifications/roots/listChanged');
  };

  const handleAdd = () => {
    if (!newName.trim() || !newPath.trim()) return;

    // Convert path to file URI
    const uri = newPath.startsWith('file:///')
      ? newPath
      : `file:///${newPath.replace(/\\/g, '/')}`;

    setRoots((prev) => [...prev, { name: newName.trim(), uri }]);
    setNewName('');
    setNewPath('');
    setShowAddForm(false);
    console.log('Roots updated - would send notifications/roots/listChanged');
  };

  const handleBrowse = () => {
    // In a real implementation, this would open a file picker
    console.log('Browse button clicked - file picker not available in mock');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Roots Configuration</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Description */}
          <p className="text-sm text-muted-foreground">
            Filesystem roots exposed to the connected server:
          </p>

          {/* Roots List */}
          <Card>
            <CardContent className="p-0">
              {roots.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  No roots configured. Add a root to allow the server to access
                  filesystem directories.
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-3 text-sm font-medium">
                        Name
                      </th>
                      <th className="text-left p-3 text-sm font-medium">URI</th>
                      <th className="text-right p-3 text-sm font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {roots.map((root) => (
                      <tr
                        key={root.uri}
                        className="border-b border-border last:border-0"
                      >
                        <td className="p-3 text-sm font-medium">{root.name}</td>
                        <td className="p-3 text-sm text-muted-foreground font-mono text-xs">
                          {root.uri}
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                            onClick={() => handleRemove(root.uri)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* Add Root Button */}
          {!showAddForm && (
            <Button
              variant="outline"
              onClick={() => setShowAddForm(true)}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Root
            </Button>
          )}

          {/* Add Form */}
          {showAddForm && (
            <>
              {/* Divider */}
              <div className="border-t border-border" />

              <div className="space-y-4">
                <h4 className="font-medium text-sm">Add New Root:</h4>

                <div>
                  <Label htmlFor="rootName" className="text-sm">
                    Name:
                  </Label>
                  <Input
                    id="rootName"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="mt-1"
                    placeholder="e.g., Downloads"
                  />
                </div>

                <div>
                  <Label htmlFor="rootPath" className="text-sm">
                    Path:
                  </Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      id="rootPath"
                      value={newPath}
                      onChange={(e) => setNewPath(e.target.value)}
                      className="flex-1"
                      placeholder="e.g., /home/user/Downloads"
                    />
                    <Button variant="outline" onClick={handleBrowse}>
                      <FolderOpen className="h-4 w-4 mr-2" />
                      Browse
                    </Button>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowAddForm(false);
                      setNewName('');
                      setNewPath('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAdd}
                    disabled={!newName.trim() || !newPath.trim()}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Security Warning */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-500">Warning</p>
                <p className="text-muted-foreground">
                  Roots give the server access to these directories. Only add
                  directories you trust the server to access.
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
