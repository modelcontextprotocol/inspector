import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ServerAddMenu } from "./ServerAddMenu";

describe("ServerAddMenu", () => {
  it("renders the trigger button", () => {
    renderWithMantine(
      <ServerAddMenu
        onAddManually={() => {}}
        onImportConfig={() => {}}
        onImportServerJson={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Add Servers/ }),
    ).toBeInTheDocument();
  });

  it("invokes onAddManually when 'Add manually' is clicked", async () => {
    const user = userEvent.setup();
    const onAddManually = vi.fn();
    renderWithMantine(
      <ServerAddMenu
        onAddManually={onAddManually}
        onImportConfig={() => {}}
        onImportServerJson={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Add Servers/ }));
    const item = screen.getByRole("menuitem", {
      name: /Add manually/,
      hidden: true,
    });
    await user.click(item);
    expect(onAddManually).toHaveBeenCalledTimes(1);
  });

  it("invokes onImportConfig when 'Import config' is clicked", async () => {
    const user = userEvent.setup();
    const onImportConfig = vi.fn();
    renderWithMantine(
      <ServerAddMenu
        onAddManually={() => {}}
        onImportConfig={onImportConfig}
        onImportServerJson={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Add Servers/ }));
    const item = screen.getByRole("menuitem", {
      name: /Import config/,
      hidden: true,
    });
    await user.click(item);
    expect(onImportConfig).toHaveBeenCalledTimes(1);
  });

  it("invokes onImportServerJson when 'Import server.json' is clicked", async () => {
    const user = userEvent.setup();
    const onImportServerJson = vi.fn();
    renderWithMantine(
      <ServerAddMenu
        onAddManually={() => {}}
        onImportConfig={() => {}}
        onImportServerJson={onImportServerJson}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Add Servers/ }));
    const item = screen.getByRole("menuitem", {
      name: /Import server\.json/,
      hidden: true,
    });
    await user.click(item);
    expect(onImportServerJson).toHaveBeenCalledTimes(1);
  });
});
