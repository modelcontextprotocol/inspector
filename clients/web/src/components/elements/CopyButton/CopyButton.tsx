import {
  ActionIcon,
  CopyButton as MantineCopyButton,
  Tooltip,
} from "@mantine/core";

export interface CopyButtonProps {
  value: string;
}

export function CopyButton({ value }: CopyButtonProps) {
  return (
    <MantineCopyButton value={value}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? "Copied" : "Copy"}>
          <ActionIcon
            variant="subtle"
            color={copied ? "green" : "gray"}
            onClick={copy}
          >
            {copied ? "\u2713" : "\u2398"}
          </ActionIcon>
        </Tooltip>
      )}
    </MantineCopyButton>
  );
}
