import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MetadataTab from "../MetadataTab";
import { Tabs } from "@/components/ui/tabs";

jest.mock("react-simple-code-editor", () => {
  return function MockCodeEditor({
    value,
    onValueChange: onValueChange,
  }: {
    value: string;
    onValueChange: (value: string) => void;
  }) {
    return (
      <textarea
        data-testid="json-editor"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
    );
  };
});

jest.mock("prismjs", () => ({
  highlight: (code: string) => code,
  languages: { json: {} },
}));

jest.mock("prismjs/components/prism-json", () => {});
jest.mock("prismjs/themes/prism.css", () => {});

describe("MetadataTab", () => {
  const defaultProps = {
    metadata: {},
    onMetadataChange: jest.fn(),
  };

  const renderMetadataTab = (props = {}) => {
    return render(
      <Tabs defaultValue="metadata">
        <MetadataTab {...defaultProps} {...props} />
      </Tabs>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Initial Rendering", () => {
    it("should render the metadata tab with title and description", () => {
      renderMetadataTab();

      expect(screen.getByText("Meta Data")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Provide an object containing key-value pairs that will be included in all MCP requests.",
        ),
      ).toBeInTheDocument();
    });

    it("should render Pretty button", () => {
      renderMetadataTab();

      const prettyButton = screen.getByRole("button", { name: /pretty/i });
      expect(prettyButton).toBeInTheDocument();
    });

    it("should render JSON editor", () => {
      renderMetadataTab();

      expect(screen.getByTestId("json-editor")).toBeInTheDocument();
    });
  });

  describe("Initial Data Handling", () => {
    it("should initialize with existing metadata", () => {
      const initialMetadata = {
        API_KEY: "test-key",
        VERSION: "1.0.0",
      };

      renderMetadataTab({ metadata: initialMetadata });

      const editor = screen.getByTestId("json-editor") as HTMLTextAreaElement;
      expect(editor.value).toContain("API_KEY");
      expect(editor.value).toContain("test-key");
      expect(editor.value).toContain("VERSION");
      expect(editor.value).toContain("1.0.0");
    });

    it("should pretty print metadata by default", () => {
      renderMetadataTab({
        metadata: { firstKey: "value" },
      });

      const editor = screen.getByTestId("json-editor") as HTMLTextAreaElement;
      expect(editor.value).toBe(`{
  "firstKey": "value"
}`);
    });
  });

  describe("Editing JSON", () => {
    it("should call onMetadataChange when valid JSON is entered", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({ onMetadataChange });

      const editor = screen.getByTestId("json-editor");
      fireEvent.change(editor, {
        target: { value: '{"key":"value"}' },
      });

      expect(onMetadataChange).toHaveBeenCalledWith({ key: "value" });
    });

    it("should show error for invalid JSON", () => {
      renderMetadataTab();

      const editor = screen.getByTestId("json-editor");
      fireEvent.change(editor, {
        target: { value: '{"key": }' },
      });

      expect(screen.getByText("Invalid JSON format")).toBeInTheDocument();
    });

    it("should not call onMetadataChange when JSON is invalid", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({ onMetadataChange });

      const editor = screen.getByTestId("json-editor");
      fireEvent.change(editor, {
        target: { value: '{"key": }' },
      });

      expect(onMetadataChange).not.toHaveBeenCalled();
    });

    it("should clear error when JSON becomes valid", () => {
      renderMetadataTab();

      const editor = screen.getByTestId("json-editor");
      fireEvent.change(editor, {
        target: { value: '{"key": }' },
      });

      expect(screen.getByText("Invalid JSON format")).toBeInTheDocument();

      fireEvent.change(editor, {
        target: { value: '{"key": "value"}' },
      });

      expect(screen.queryByText("Invalid JSON format")).not.toBeInTheDocument();
    });

    it("should clear metadata when input is emptied", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({
        metadata: { key: "value" },
        onMetadataChange,
      });

      const editor = screen.getByTestId("json-editor");

      fireEvent.change(editor, {
        target: { value: "" },
      });

      expect(onMetadataChange).toHaveBeenCalledWith({});
    });

    it("should display object validation error when JSON is not an object", () => {
      renderMetadataTab();

      const editor = screen.getByTestId("json-editor");
      fireEvent.change(editor, {
        target: { value: "[]" },
      });

      expect(
        screen.getByText("Meta data must be a JSON object"),
      ).toBeInTheDocument();
    });
  });

  describe("Pretty Button", () => {
    it("should format the JSON when clicked", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({ onMetadataChange });

      const editor = screen.getByTestId("json-editor") as HTMLTextAreaElement;

      fireEvent.change(editor, {
        target: { value: '{"key":"value"}' },
      });

      const prettyButton = screen.getByRole("button", { name: /pretty/i });

      fireEvent.click(prettyButton);

      expect(editor.value).toBe(`{
  "key": "value"
}`);
      expect(onMetadataChange).toHaveBeenLastCalledWith({ key: "value" });
    });

    it("should not do anything when editor is empty", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({ onMetadataChange });

      const editor = screen.getByTestId("json-editor") as HTMLTextAreaElement;
      const prettyButton = screen.getByRole("button", { name: /pretty/i });

      fireEvent.click(prettyButton);

      expect(editor.value).toBe("");
      expect(onMetadataChange).not.toHaveBeenCalled();
    });

    it("should show error when JSON cannot be parsed on pretty click", () => {
      renderMetadataTab();

      const editor = screen.getByTestId("json-editor");
      fireEvent.change(editor, {
        target: { value: '{"key": }' },
      });

      const prettyButton = screen.getByRole("button", { name: /pretty/i });

      fireEvent.click(prettyButton);

      expect(screen.getByText("Invalid JSON format")).toBeInTheDocument();
    });
  });

  describe("Props Synchronization", () => {
    it("should update editor contents when props change", () => {
      const { rerender } = renderMetadataTab({});

      expect(screen.getByTestId("json-editor")).toHaveValue("");

      rerender(
        <Tabs defaultValue="metadata">
          <MetadataTab {...defaultProps} metadata={{ nextKey: "nextValue" }} />
        </Tabs>,
      );

      const editor = screen.getByTestId("json-editor") as HTMLTextAreaElement;
      expect(editor.value).toBe(`{
  "nextKey": "nextValue"
}`);
    });
  });
});
