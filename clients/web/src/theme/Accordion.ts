import { Accordion } from "@mantine/core";

export const ThemeAccordion = Accordion.extend({
  // The `disclosure` variant tags the chevron slot so App.css can rotate it
  // 90° (right → down) when a section opens, instead of Mantine's default 180°
  // flip. Pair it with `chevron={<RiArrowRightSLine />}` so closed sections
  // point right and open sections point down (see #1462).
  classNames: (_theme, props) => {
    if (props.variant === "disclosure")
      return { chevron: "disclosure-chevron" };
    return {};
  },
});
