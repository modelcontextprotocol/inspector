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
  /**
   * Names what is being copied, for the accessible label only ("Copy ID
   * Token"). Set it when more than one CopyButton can appear in the same
   * region, so button-by-button screen-reader navigation can tell them apart;
   * a lone control needs no qualifier. The visible tooltip stays "Copy" either
   * way, and the accessible name keeps "Copy"/"Copied" as its first word so it
   * still contains the visible text (WCAG 2.5.3).
   */
  label?: string;
}

const CopyActionIcon = ActionIcon.withProps({
  variant: "subtle",
  fz: 24,
});

export function CopyButton({ value, flush = false, label }: CopyButtonProps) {
  const qualifier = label ? ` ${label}` : "";
  return (
    <MantineCopyButton value={value}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? "Copied" : "Copy"}>
          <CopyActionIcon
            color={copied ? "green" : "var(--inspector-text-primary)"}
            onClick={copy}
            aria-label={(copied ? "Copied" : "Copy") + qualifier}
            {...(flush && { p: 0, h: "auto", w: "auto" })}
          >
            {copied ? "\u2713" : "\u2398"}
          </CopyActionIcon>
        </Tooltip>
      )}
    </MantineCopyButton>
  );
}
