import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MetaDataTab from "../MetaDataTab";
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

describe("MetaDataTab", () => {
  const defaultProps = {
    metaData: {},
    onMetaDataChange: jest.fn(),
  };

  const renderMetaDataTab = (props = {}) => {
    return render(
      <Tabs defaultValue="metadata">
        <MetaDataTab {...defaultProps} {...props} />
      </Tabs>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Initial Rendering", () => {
    it("should render the metadata tab with title and description", () => {
      renderMetaDataTab();

      expect(screen.getByText("Meta Data")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Provide an object containing key-value pairs that will be included in all MCP requests.",
        ),
      ).toBeInTheDocument();
    });

    it("should render Pretty button", () => {
      renderMetaDataTab();

      const prettyButton = screen.getByRole("button", { name: /pretty/i });
      expect(prettyButton).toBeInTheDocument();
    });

    it("should render JSON editor", () => {
      renderMetaDataTab();

      expect(screen.getByTestId("json-editor")).toBeInTheDocument();
    });
  });

  describe("Initial Data Handling", () => {
    it("should initialize with existing metadata", () => {
      const initialMetaData = {
        API_KEY: "test-key",
        VERSION: "1.0.0",
      };

      renderMetaDataTab({ metaData: initialMetaData });

      const editor = screen.getByTestId("json-editor") as HTMLTextAreaElement;
      expect(editor.value).toContain("API_KEY");
      expect(editor.value).toContain("test-key");
      expect(editor.value).toContain("VERSION");
      expect(editor.value).toContain("1.0.0");
    });

    it("should pretty print metadata by default", () => {
      renderMetaDataTab({
        metaData: { firstKey: "value" },
      });

      const editor = screen.getByTestId("json-editor") as HTMLTextAreaElement;
      expect(editor.value).toBe(`{
  "firstKey": "value"
}`);
    });
  });

  describe("Editing JSON", () => {
    it("should call onMetaDataChange when valid JSON is entered", () => {
      const onMetaDataChange = jest.fn();
      renderMetaDataTab({ onMetaDataChange });

      const editor = screen.getByTestId("json-editor");
      fireEvent.change(editor, {
        target: { value: '{"key":"value"}' },
      });

      expect(onMetaDataChange).toHaveBeenCalledWith({ key: "value" });
    });

    it("should show error for invalid JSON", () => {
      renderMetaDataTab();

      const editor = screen.getByTestId("json-editor");
      fireEvent.change(editor, {
        target: { value: '{"key": }' },
      });

      expect(screen.getByText("Invalid JSON format")).toBeInTheDocument();
    });

    it("should not call onMetaDataChange when JSON is invalid", () => {
      const onMetaDataChange = jest.fn();
      renderMetaDataTab({ onMetaDataChange });

      const editor = screen.getByTestId("json-editor");
      fireEvent.change(editor, {
        target: { value: '{"key": }' },
      });

      expect(onMetaDataChange).not.toHaveBeenCalled();
    });

    it("should clear error when JSON becomes valid", () => {
      renderMetaDataTab();

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
      const onMetaDataChange = jest.fn();
      renderMetaDataTab({
        metaData: { key: "value" },
        onMetaDataChange,
      });

      const editor = screen.getByTestId("json-editor");

      fireEvent.change(editor, {
        target: { value: "" },
      });

      expect(onMetaDataChange).toHaveBeenCalledWith({});
    });

    it("should display object validation error when JSON is not an object", () => {
      renderMetaDataTab();

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
      const onMetaDataChange = jest.fn();
      renderMetaDataTab({ onMetaDataChange });

      const editor = screen.getByTestId("json-editor") as HTMLTextAreaElement;

      fireEvent.change(editor, {
        target: { value: '{"key":"value"}' },
      });

      const prettyButton = screen.getByRole("button", { name: /pretty/i });

      fireEvent.click(prettyButton);

      expect(editor.value).toBe(`{
  "key": "value"
}`);
      expect(onMetaDataChange).toHaveBeenLastCalledWith({ key: "value" });
    });

    it("should not do anything when editor is empty", () => {
      const onMetaDataChange = jest.fn();
      renderMetaDataTab({ onMetaDataChange });

      const editor = screen.getByTestId("json-editor") as HTMLTextAreaElement;
      const prettyButton = screen.getByRole("button", { name: /pretty/i });

      fireEvent.click(prettyButton);

      expect(editor.value).toBe("");
      expect(onMetaDataChange).not.toHaveBeenCalled();
    });

    it("should show error when JSON cannot be parsed on pretty click", () => {
      renderMetaDataTab();

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
      const { rerender } = renderMetaDataTab({});

      expect(screen.getByTestId("json-editor")).toHaveValue("");

      rerender(
        <Tabs defaultValue="metadata">
          <MetaDataTab {...defaultProps} metaData={{ nextKey: "nextValue" }} />
        </Tabs>,
      );

      const editor = screen.getByTestId("json-editor") as HTMLTextAreaElement;
      expect(editor.value).toBe(`{
  "nextKey": "nextValue"
}`);
    });
  });
});
