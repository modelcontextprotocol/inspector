import { useState } from 'react';
import { Copy, Check, Image, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { mockSamplingRequest, type SamplingMessage } from '@/mocks';

interface SamplingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function PriorityBar({ value, label }: { value: number; label: string }) {
  const percentage = Math.round(value * 100);
  let priorityLabel = 'low';
  if (value > 0.6) priorityLabel = 'high';
  else if (value > 0.3) priorityLabel = 'medium';

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-28 text-muted-foreground">{label}:</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="w-16 text-xs">
        {priorityLabel} ({value})
      </span>
    </div>
  );
}

function MessageDisplay({ message }: { message: SamplingMessage }) {
  return (
    <div className="border-b border-border pb-3 last:border-0 last:pb-0">
      <div className="flex items-center gap-2 mb-1">
        <Badge variant="outline" className="text-xs">
          {message.role}
        </Badge>
      </div>
      {message.content.type === 'text' ? (
        <p className="text-sm">{message.content.text}</p>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Image className="h-4 w-4" />
          <span>[Image: {message.content.mimeType} - Click to preview]</span>
        </div>
      )}
    </div>
  );
}

export function SamplingModal({ open, onOpenChange }: SamplingModalProps) {
  const [response, setResponse] = useState(
    'Based on the data chart, I can see several key trends:\n\n1. Revenue has increased 25% quarter-over-quarter\n2. User engagement peaks on Tuesdays\n3. Mobile usage continues to grow at 15% monthly'
  );
  const [modelUsed, setModelUsed] = useState('claude-3-sonnet-20241022');
  const [stopReason, setStopReason] = useState('endTurn');
  const [copied, setCopied] = useState(false);

  const request = mockSamplingRequest;

  const handleCopyResponse = async () => {
    await navigator.clipboard.writeText(response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReject = () => {
    console.log('Sampling request rejected');
    onOpenChange(false);
  };

  const handleSendResponse = () => {
    console.log('Sending sampling response:', {
      content: { type: 'text', text: response },
      model: modelUsed,
      stopReason,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sampling Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Description */}
          <p className="text-sm text-muted-foreground">
            The server is requesting an LLM completion.
          </p>

          {/* Messages */}
          <div>
            <h4 className="font-medium mb-2">Messages:</h4>
            <Card>
              <CardContent className="p-4 space-y-3 max-h-48 overflow-y-auto">
                {request.messages.map((msg, idx) => (
                  <MessageDisplay key={idx} message={msg} />
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Model Preferences */}
          {request.modelPreferences && (
            <div>
              <h4 className="font-medium mb-2">Model Preferences:</h4>
              <Card>
                <CardContent className="p-4 space-y-2">
                  {request.modelPreferences.hints &&
                    request.modelPreferences.hints.length > 0 && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Hints:</span>
                        <div className="flex gap-1">
                          {request.modelPreferences.hints.map((hint) => (
                            <Badge key={hint} variant="secondary">
                              {hint}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  {request.modelPreferences.costPriority !== undefined && (
                    <PriorityBar
                      value={request.modelPreferences.costPriority}
                      label="Cost Priority"
                    />
                  )}
                  {request.modelPreferences.speedPriority !== undefined && (
                    <PriorityBar
                      value={request.modelPreferences.speedPriority}
                      label="Speed Priority"
                    />
                  )}
                  {request.modelPreferences.intelligencePriority !==
                    undefined && (
                    <PriorityBar
                      value={request.modelPreferences.intelligencePriority}
                      label="Intelligence Priority"
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Parameters */}
          <div>
            <h4 className="font-medium mb-2">Parameters:</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Max Tokens:</span>
                <span className="ml-2">{request.maxTokens}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Temperature:</span>
                <span className="ml-2">
                  {request.temperature ?? '(not specified)'}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Stop Sequences:</span>
                <span className="ml-2">
                  {request.stopSequences && request.stopSequences.length > 0
                    ? `[${request.stopSequences.map((s) => `"${s}"`).join(', ')}]`
                    : '(none)'}
                </span>
              </div>
            </div>
          </div>

          {/* Include Context */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="includeContext"
              checked={request.includeContext === 'thisServer'}
              disabled
            />
            <Label htmlFor="includeContext" className="text-sm">
              Include Context: {request.includeContext ?? 'none'}
            </Label>
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Response Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">
                Response (enter mock response or connect to LLM):
              </h4>
              <Button variant="ghost" size="sm" onClick={handleCopyResponse}>
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              className="min-h-32 font-mono text-sm"
              placeholder="Enter the mock LLM response..."
            />
          </div>

          {/* Model and Stop Reason */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="modelUsed" className="text-sm">
                Model Used:
              </Label>
              <Input
                id="modelUsed"
                value={modelUsed}
                onChange={(e) => setModelUsed(e.target.value)}
                className="mt-1"
                placeholder="e.g., claude-3-sonnet"
              />
            </div>
            <div>
              <Label htmlFor="stopReason" className="text-sm">
                Stop Reason:
              </Label>
              <Select value={stopReason} onValueChange={setStopReason}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="endTurn">endTurn</SelectItem>
                  <SelectItem value="stopSequence">stopSequence</SelectItem>
                  <SelectItem value="maxTokens">maxTokens</SelectItem>
                  <SelectItem value="toolUse">toolUse</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleReject}>
              <AlertTriangle className="h-4 w-4 mr-2" />
              Reject Request
            </Button>
            <Button onClick={handleSendResponse}>Send Response</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
