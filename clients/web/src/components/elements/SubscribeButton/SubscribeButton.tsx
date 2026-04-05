import { Button } from "@mantine/core";

export interface SubscribeButtonProps {
  subscribed: boolean;
  onToggle: () => void;
}

export function SubscribeButton({
  subscribed,
  onToggle,
}: SubscribeButtonProps) {
  return (
    <Button variant="filled" size="sm" onClick={onToggle}>
      {subscribed ? "Unsubscribe" : "Subscribe"}
    </Button>
  );
}
