import { Button } from "@mantine/core";

export interface SubscribeButtonProps {
  subscribed: boolean;
  onToggle: () => void;
}

const ToggleButton = Button.withProps({
  variant: "filled",
  size: "sm",
});

export function SubscribeButton({
  subscribed,
  onToggle,
}: SubscribeButtonProps) {
  return (
    <ToggleButton onClick={onToggle}>
      {subscribed ? "Unsubscribe" : "Subscribe"}
    </ToggleButton>
  );
}
