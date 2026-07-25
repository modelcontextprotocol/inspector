import {
  ActionIcon,
  CopyButton as MantineCopyButton,
  Tooltip,
} from "@mantine/core";

export interface CopyButtonProps {
  value: string;
  /**
   * Drop ActionIcon padding/height so the glyph top-aligns in tight aside
   * rows (e.g. beside a Code block). Icon size is unchanged.
   */
  flush?: boolean;
}

const CopyActionIcon = ActionIcon.withProps({
  variant: "subtle",
  fz: 24,
});

export function CopyButton({ value, flush = false }: CopyButtonProps) {
  return (
    <MantineCopyButton value={value}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? "Copied" : "Copy"}>
          <CopyActionIcon
            color={copied ? "green" : "var(--inspector-text-primary)"}
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy"}
            {...(flush && { p: 0, h: "auto", w: "auto" })}
          >
            {copied ? "\u2713" : "\u2398"}
          </CopyActionIcon>
        </Tooltip>
      )}
    </MantineCopyButton>
  );
}
