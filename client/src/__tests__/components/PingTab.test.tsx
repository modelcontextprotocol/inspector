import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PingTab from "../../components/PingTab";
import { Tabs } from "@/components/ui/tabs";

describe("PingTab", () => {
  const renderWithTabs = (component: React.ReactElement) => {
    return render(<Tabs defaultValue="ping">{component}</Tabs>);
  };

  it("renders the MEGA PING button", () => {
    renderWithTabs(<PingTab onPingClick={() => {}} />);
    const button = screen.getByRole("button", { name: /mega ping/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass(
      "bg-gradient-to-r",
      "from-purple-500",
      "to-pink-500",
    );
  });

  it("includes rocket and explosion emojis", () => {
    renderWithTabs(<PingTab onPingClick={() => {}} />);
    expect(screen.getByText("🚀")).toBeInTheDocument();
    expect(screen.getByText("💥")).toBeInTheDocument();
  });

  it("calls onPingClick when button is clicked", () => {
    const onPingClick = vi.fn();
    renderWithTabs(<PingTab onPingClick={onPingClick} />);

    fireEvent.click(screen.getByRole("button", { name: /mega ping/i }));
    expect(onPingClick).toHaveBeenCalledTimes(1);
  });

  it("has animation classes for visual feedback", () => {
    renderWithTabs(<PingTab onPingClick={() => {}} />);
    const button = screen.getByRole("button", { name: /mega ping/i });
    expect(button).toHaveClass(
      "animate-pulse",
      "hover:scale-110",
      "transition",
    );
  });

  it("has focus styles for accessibility", () => {
    renderWithTabs(<PingTab onPingClick={() => {}} />);
    const button = screen.getByRole("button", { name: /mega ping/i });
    expect(button).toHaveClass("focus:outline-none", "focus:ring-4");
  });
});
