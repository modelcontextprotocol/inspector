import { useState, useRef, useCallback } from 'react';
import { Check, AlertTriangle, Info, Upload, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// server.json schema types
interface EnvVar {
  name: string;
  description?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  choices?: string[];
}

interface Argument {
  type: 'positional' | 'named';
  name?: string;
  value?: string;
  valueHint?: string;
  description?: string;
  default?: string;
  isRequired?: boolean;
  choices?: string[];
}

interface Package {
  registryType: string;
  identifier: string;
  version: string;
  runtimeHint?: string;
  transport: { type: string };
  packageArguments?: Argument[];
  runtimeArguments?: Argument[];
  environmentVariables?: EnvVar[];
}

interface Remote {
  type: 'streamable-http' | 'sse';
  url: string;
  headers?: EnvVar[];
}

interface ServerJson {
  $schema?: string;
  name: string;
  description: string;
  title?: string;
  version: string;
  packages?: Package[];
  remotes?: Remote[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
}

interface ImportServerJsonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (config: {
    name: string;
    transport: string;
    command?: string;
    url?: string;
    env: Record<string, string>;
  }) => void;
}

function validateServerJson(jsonText: string): {
  result: ValidationResult;
  parsed: ServerJson | null;
} {
  const result: ValidationResult = {
    valid: false,
    errors: [],
    warnings: [],
    info: [],
  };

  if (!jsonText.trim()) {
    return { result, parsed: null };
  }

  let parsed: ServerJson;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    result.errors.push('Invalid JSON syntax');
    return { result, parsed: null };
  }

  // Basic schema validation
  if (!parsed.name) {
    result.errors.push('Missing required field: name');
  }
  if (!parsed.description) {
    result.errors.push('Missing required field: description');
  }
  if (!parsed.version) {
    result.errors.push('Missing required field: version');
  }

  if (!parsed.packages?.length && !parsed.remotes?.length) {
    result.errors.push('Must have at least one package or remote');
  }

  if (result.errors.length === 0) {
    result.valid = true;
    result.info.push('Schema validation passed');

    if (parsed.packages?.length) {
      const pkg = parsed.packages[0];
      result.info.push(
        `Package found: ${pkg.identifier} (${pkg.registryType})`
      );
      if (pkg.runtimeHint) {
        result.info.push(`Runtime hint: ${pkg.runtimeHint}`);
      }
      result.info.push(`Transport: ${pkg.transport?.type || 'stdio'}`);
    }

    if (parsed.remotes?.length) {
      const remote = parsed.remotes[0];
      result.info.push(`Remote found: ${remote.url} (${remote.type})`);
    }

    // Check for required env vars
    const pkg = parsed.packages?.[0];
    const requiredEnvVars = pkg?.environmentVariables?.filter(
      (v) => v.isRequired
    );
    if (requiredEnvVars?.length) {
      requiredEnvVars.forEach((v) => {
        result.warnings.push(`Environment variable ${v.name} is required`);
      });
    }
  }

  return { result, parsed };
}

export function ImportServerJsonModal({
  open,
  onOpenChange,
  onImport,
}: ImportServerJsonModalProps) {
  const [jsonText, setJsonText] = useState('');
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);
  const [parsedJson, setParsedJson] = useState<ServerJson | null>(null);
  const [sourceType, setSourceType] = useState<'package' | 'remote'>('package');
  const [selectedPackageIndex, setSelectedPackageIndex] = useState(0);
  const [selectedRemoteIndex, setSelectedRemoteIndex] = useState(0);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [serverNameOverride, setServerNameOverride] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleValidate = useCallback(() => {
    const { result, parsed } = validateServerJson(jsonText);
    setValidationResult(result);
    setParsedJson(parsed);

    if (parsed) {
      // Determine source type
      if (parsed.packages?.length && !parsed.remotes?.length) {
        setSourceType('package');
      } else if (parsed.remotes?.length && !parsed.packages?.length) {
        setSourceType('remote');
      }

      // Initialize env vars with defaults
      const pkg = parsed.packages?.[selectedPackageIndex];
      if (pkg?.environmentVariables) {
        const defaults: Record<string, string> = {};
        pkg.environmentVariables.forEach((v) => {
          if (v.default) {
            defaults[v.name] = v.default;
          }
        });
        setEnvVars(defaults);
      }

      // Initialize headers with defaults
      const remote = parsed.remotes?.[selectedRemoteIndex];
      if (remote?.headers) {
        const defaults: Record<string, string> = {};
        remote.headers.forEach((h) => {
          if (h.default) {
            defaults[h.name] = h.default;
          }
        });
        setHeaders(defaults);
      }
    }
  }, [jsonText, selectedPackageIndex, selectedRemoteIndex]);

  const handleClear = () => {
    setJsonText('');
    setValidationResult(null);
    setParsedJson(null);
    setEnvVars({});
    setHeaders({});
    setServerNameOverride('');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setJsonText(text);
      };
      reader.readAsText(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setJsonText(text);
      };
      reader.readAsText(file);
    }
  };

  const handleImport = () => {
    if (!parsedJson) return;

    const name =
      serverNameOverride.trim() || parsedJson.title || parsedJson.name;

    if (sourceType === 'package' && parsedJson.packages?.length) {
      const pkg = parsedJson.packages[selectedPackageIndex];
      const runtimeHint = pkg.runtimeHint || 'npx';
      const command = `${runtimeHint} -y ${pkg.identifier}`;

      onImport({
        name,
        transport: 'stdio',
        command,
        env: envVars,
      });
    } else if (sourceType === 'remote' && parsedJson.remotes?.length) {
      const remote = parsedJson.remotes[selectedRemoteIndex];

      onImport({
        name,
        transport: remote.type === 'sse' ? 'sse' : 'http',
        url: remote.url,
        env: headers,
      });
    }

    onOpenChange(false);
  };

  const canImport = () => {
    if (!validationResult?.valid || !parsedJson) return false;

    // Check required env vars are filled
    if (sourceType === 'package') {
      const pkg = parsedJson.packages?.[selectedPackageIndex];
      const requiredVars =
        pkg?.environmentVariables?.filter((v) => v.isRequired) || [];
      for (const v of requiredVars) {
        if (!envVars[v.name]?.trim()) return false;
      }
    }

    // Check required headers are filled
    if (sourceType === 'remote') {
      const remote = parsedJson.remotes?.[selectedRemoteIndex];
      const requiredHeaders =
        remote?.headers?.filter((h) => h.isRequired) || [];
      for (const h of requiredHeaders) {
        if (!headers[h.name]?.trim()) return false;
      }
    }

    return true;
  };

  const selectedPackage = parsedJson?.packages?.[selectedPackageIndex];
  const selectedRemote = parsedJson?.remotes?.[selectedRemoteIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import MCP Registry server.json</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* JSON Input */}
          <div className="space-y-2">
            <Label>Paste server.json content or drag and drop a file:</Label>
            <div
              className="relative"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <Textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder={`{
  "$schema": "https://static.modelcontextprotocol.io/schemas/...",
  "name": "io.github.user/my-server",
  "description": "A sample MCP server",
  "version": "1.0.0",
  "packages": [{
    "registryType": "npm",
    "identifier": "my-mcp-server",
    ...
  }]
}`}
                className="min-h-[200px] font-mono text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <input
                type="file"
                ref={fileInputRef}
                accept=".json"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1" />
                Browse...
              </Button>
              <Button variant="outline" size="sm" onClick={handleClear}>
                Clear
              </Button>
              <Button size="sm" onClick={handleValidate}>
                Validate
              </Button>
            </div>
          </div>

          {/* Validation Results */}
          {validationResult && (
            <div className="space-y-2">
              <Label>Validation Results:</Label>
              <div className="p-3 rounded-md border bg-muted/50 space-y-1">
                {validationResult.errors.map((error, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <X className="h-4 w-4 text-red-500" />
                    <span className="text-red-500">{error}</span>
                  </div>
                ))}
                {validationResult.warnings.map((warning, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    <span className="text-yellow-500">{warning}</span>
                  </div>
                ))}
                {validationResult.info.map((info, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {i === 0 ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Info className="h-4 w-4 text-blue-500" />
                    )}
                    <span
                      className={i === 0 ? 'text-green-500' : 'text-blue-500'}
                    >
                      {info}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Source Type Selection */}
          {parsedJson &&
            parsedJson.packages?.length &&
            parsedJson.remotes?.length && (
              <div className="space-y-2">
                <Label>Source Type:</Label>
                <RadioGroup
                  value={sourceType}
                  onValueChange={(v) => setSourceType(v as 'package' | 'remote')}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="package" id="package" />
                    <Label htmlFor="package">Package (local execution)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="remote" id="remote" />
                    <Label htmlFor="remote">Remote (HTTP endpoint)</Label>
                  </div>
                </RadioGroup>
              </div>
            )}

          {/* Package Selection */}
          {sourceType === 'package' &&
            parsedJson?.packages &&
            parsedJson.packages.length > 1 && (
              <div className="space-y-2">
                <Label>Package Selection:</Label>
                <RadioGroup
                  value={String(selectedPackageIndex)}
                  onValueChange={(v) => setSelectedPackageIndex(Number(v))}
                  className="space-y-2"
                >
                  {parsedJson.packages.map((pkg, i) => (
                    <div
                      key={i}
                      className="flex items-center space-x-2 p-2 rounded border"
                    >
                      <RadioGroupItem value={String(i)} id={`pkg-${i}`} />
                      <Label htmlFor={`pkg-${i}`} className="flex-1">
                        <span className="font-medium">{pkg.registryType}:</span>{' '}
                        {pkg.identifier}
                        {pkg.runtimeHint && (
                          <Badge variant="secondary" className="ml-2">
                            {pkg.runtimeHint}
                          </Badge>
                        )}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            )}

          {/* Remote Selection */}
          {sourceType === 'remote' &&
            parsedJson?.remotes &&
            parsedJson.remotes.length > 1 && (
              <div className="space-y-2">
                <Label>Remote Selection:</Label>
                <RadioGroup
                  value={String(selectedRemoteIndex)}
                  onValueChange={(v) => setSelectedRemoteIndex(Number(v))}
                  className="space-y-2"
                >
                  {parsedJson.remotes.map((remote, i) => (
                    <div
                      key={i}
                      className="flex items-center space-x-2 p-2 rounded border"
                    >
                      <RadioGroupItem value={String(i)} id={`remote-${i}`} />
                      <Label htmlFor={`remote-${i}`} className="flex-1">
                        <Badge variant="secondary" className="mr-2">
                          {remote.type}
                        </Badge>
                        {remote.url}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            )}

          {/* Environment Variables (for packages) */}
          {sourceType === 'package' &&
            selectedPackage?.environmentVariables?.length && (
              <div className="space-y-2">
                <Label>Environment Variables:</Label>
                <div className="space-y-3 p-3 rounded-md border">
                  {selectedPackage.environmentVariables.map((envVar) => (
                    <div key={envVar.name} className="space-y-1">
                      <Label htmlFor={envVar.name}>
                        {envVar.name}
                        {envVar.isRequired && (
                          <span className="text-red-500 ml-1">*</span>
                        )}
                      </Label>
                      {envVar.choices?.length ? (
                        <Select
                          value={envVars[envVar.name] || ''}
                          onValueChange={(v) =>
                            setEnvVars({ ...envVars, [envVar.name]: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            {envVar.choices.map((choice) => (
                              <SelectItem key={choice} value={choice}>
                                {choice}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={envVar.name}
                          type={envVar.isSecret ? 'password' : 'text'}
                          placeholder={envVar.default || ''}
                          value={envVars[envVar.name] || ''}
                          onChange={(e) =>
                            setEnvVars({
                              ...envVars,
                              [envVar.name]: e.target.value,
                            })
                          }
                        />
                      )}
                      {envVar.description && (
                        <p className="text-xs text-muted-foreground">
                          {envVar.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Headers (for remotes) */}
          {sourceType === 'remote' && selectedRemote?.headers?.length && (
            <div className="space-y-2">
              <Label>Headers:</Label>
              <div className="space-y-3 p-3 rounded-md border">
                {selectedRemote.headers.map((header) => (
                  <div key={header.name} className="space-y-1">
                    <Label htmlFor={header.name}>
                      {header.name}
                      {header.isRequired && (
                        <span className="text-red-500 ml-1">*</span>
                      )}
                    </Label>
                    {header.choices?.length ? (
                      <Select
                        value={headers[header.name] || ''}
                        onValueChange={(v) =>
                          setHeaders({ ...headers, [header.name]: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          {header.choices.map((choice) => (
                            <SelectItem key={choice} value={choice}>
                              {choice}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={header.name}
                        type={header.isSecret ? 'password' : 'text'}
                        placeholder={header.default || ''}
                        value={headers[header.name] || ''}
                        onChange={(e) =>
                          setHeaders({
                            ...headers,
                            [header.name]: e.target.value,
                          })
                        }
                      />
                    )}
                    {header.description && (
                      <p className="text-xs text-muted-foreground">
                        {header.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Server Name Override */}
          {parsedJson && (
            <div className="space-y-2">
              <Label htmlFor="nameOverride">
                Server Name (optional override):
              </Label>
              <Input
                id="nameOverride"
                placeholder={parsedJson.title || parsedJson.name}
                value={serverNameOverride}
                onChange={(e) => setServerNameOverride(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleValidate}>
            Validate Again
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!canImport()}>
            Add Server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
