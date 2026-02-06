import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Tabs } from "@/components/ui/tabs";
import ResourcesTab from "../ResourcesTab";
import { ResourceTemplate, Resource } from "@modelcontextprotocol/sdk/types.js";

// Mock the hooks and components
jest.mock("@/lib/hooks/useCompletionState", () => ({
  useCompletionState: () => ({
    completions: {},
    clearCompletions: jest.fn(),
    requestCompletions: jest.fn(),
  }),
}));

jest.mock("../JsonView", () => {
  return function MockJsonView({ data }: { data: string }) {
    return <div data-testid="json-view">{data}</div>;
  };
});

jest.mock("@/components/ui/combobox", () => ({
  Combobox: ({
    id,
    value,
    onChange,
    placeholder,
  }: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  }) => (
    <input
      id={id}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={`combobox-${id}`}
    />
  ),
}));

jest.mock("@/components/ui/label", () => ({
  Label: ({
    htmlFor,
    children,
  }: {
    htmlFor: string;
    children: React.ReactNode;
  }) => (
    <label htmlFor={htmlFor} data-testid={`label-${htmlFor}`}>
      {children}
    </label>
  ),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid="button"
      {...props}
    >
      {children}
    </button>
  ),
}));

describe("ResourcesTab - Template Query Parameters", () => {
  const mockListResources = jest.fn();
  const mockClearResources = jest.fn();
  const mockListResourceTemplates = jest.fn();
  const mockClearResourceTemplates = jest.fn();
  const mockReadResource = jest.fn();
  const mockSetSelectedResource = jest.fn();
  const mockHandleCompletion = jest.fn();
  const mockSubscribeToResource = jest.fn();
  const mockUnsubscribeFromResource = jest.fn();

  const mockResourceTemplate: ResourceTemplate = {
    name: "Users API",
    uriTemplate: "test://users{?name,limit,offset}",
    description: "Fetch users with optional filtering and pagination",
  };

  const mockResource: Resource = {
    uri: "test://users?name=john&limit=10&offset=0",
    name: "Users Resource",
    description: "Expanded users resource",
  };

  const defaultProps = {
    resources: [],
    resourceTemplates: [mockResourceTemplate],
    listResources: mockListResources,
    clearResources: mockClearResources,
    listResourceTemplates: mockListResourceTemplates,
    clearResourceTemplates: mockClearResourceTemplates,
    readResource: mockReadResource,
    selectedResource: null,
    setSelectedResource: mockSetSelectedResource,
    handleCompletion: mockHandleCompletion,
    completionsSupported: true,
    resourceContent: "",
    nextCursor: undefined,
    nextTemplateCursor: undefined,
    error: null,
    resourceSubscriptionsSupported: false,
    resourceSubscriptions: new Set<string>(),
    subscribeToResource: mockSubscribeToResource,
    unsubscribeFromResource: mockUnsubscribeFromResource,
  };

  const renderResourcesTab = (props = {}) =>
    render(
      <Tabs defaultValue="resources">
        <ResourcesTab {...defaultProps} {...props} />
      </Tabs>,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should parse and display template variables from URI template", () => {
    renderResourcesTab();

    // Click on the resource template to select it
    fireEvent.click(screen.getByText("Users API"));

    // Check that input fields are rendered for each template variable
    expect(screen.getByTestId("combobox-name")).toBeInTheDocument();
    expect(screen.getByTestId("combobox-limit")).toBeInTheDocument();
    expect(screen.getByTestId("combobox-offset")).toBeInTheDocument();
  });

  it("should display template description when template is selected", () => {
    renderResourcesTab();

    // Click on the resource template to select it
    fireEvent.click(screen.getByText("Users API"));

    expect(
      screen.getByText("Fetch users with optional filtering and pagination"),
    ).toBeInTheDocument();
  });

  it("should handle template value changes", () => {
    renderResourcesTab();

    // Click on the resource template to select it
    fireEvent.click(screen.getByText("Users API"));

    // Find and fill template value inputs
    const nameInput = screen.getByTestId("combobox-name");
    const limitInput = screen.getByTestId("combobox-limit");
    const offsetInput = screen.getByTestId("combobox-offset");

    fireEvent.change(nameInput, { target: { value: "john" } });
    fireEvent.change(limitInput, { target: { value: "10" } });
    fireEvent.change(offsetInput, { target: { value: "0" } });

    expect(nameInput).toHaveValue("john");
    expect(limitInput).toHaveValue("10");
    expect(offsetInput).toHaveValue("0");
  });

  it("should expand template and read resource when Read Resource button is clicked", async () => {
    renderResourcesTab();

    // Click on the resource template to select it
    fireEvent.click(screen.getByText("Users API"));

    // Fill template values
    const nameInput = screen.getByTestId("combobox-name");
    const limitInput = screen.getByTestId("combobox-limit");
    const offsetInput = screen.getByTestId("combobox-offset");

    fireEvent.change(nameInput, { target: { value: "john" } });
    fireEvent.change(limitInput, { target: { value: "10" } });
    fireEvent.change(offsetInput, { target: { value: "0" } });

    // Click Read Resource button
    const readResourceButton = screen.getByText("Read Resource");
    expect(readResourceButton).not.toBeDisabled();

    fireEvent.click(readResourceButton);

    // Verify that readResource was called with the expanded URI
    expect(mockReadResource).toHaveBeenCalledWith(
      "test://users?name=john&limit=10&offset=0",
    );

    // Verify that setSelectedResource was called with the expanded resource
    expect(mockSetSelectedResource).toHaveBeenCalledWith({
      uri: "test://users?name=john&limit=10&offset=0",
      name: "test://users?name=john&limit=10&offset=0",
    });
  });

  it("should disable Read Resource button when no template values are provided", () => {
    renderResourcesTab();

    // Click on the resource template to select it
    fireEvent.click(screen.getByText("Users API"));

    // Read Resource button should be disabled when no values are provided
    const readResourceButton = screen.getByText("Read Resource");
    expect(readResourceButton).toBeDisabled();
  });

  it("should handle partial template values correctly", () => {
    renderResourcesTab();

    // Click on the resource template to select it
    fireEvent.click(screen.getByText("Users API"));

    // Fill only some template values
    const nameInput = screen.getByTestId("combobox-name");
    fireEvent.change(nameInput, { target: { value: "john" } });

    // Read Resource button should be enabled with partial values
    const readResourceButton = screen.getByText("Read Resource");
    expect(readResourceButton).not.toBeDisabled();

    fireEvent.click(readResourceButton);

    // Should expand with only the provided values
    expect(mockReadResource).toHaveBeenCalledWith("test://users?name=john");
  });

  it("should handle special characters in template values", () => {
    renderResourcesTab();

    // Click on the resource template to select it
    fireEvent.click(screen.getByText("Users API"));

    // Fill template values with special characters
    const nameInput = screen.getByTestId("combobox-name");
    fireEvent.change(nameInput, { target: { value: "john doe" } });

    fireEvent.click(screen.getByText("Read Resource"));

    // Should properly encode special characters
    expect(mockReadResource).toHaveBeenCalledWith(
      "test://users?name=john%20doe",
    );
  });

  it("should clear template values when switching between templates", () => {
    const anotherTemplate: ResourceTemplate = {
      name: "Posts API",
      uriTemplate: "test://posts{?author,category}",
      description: "Fetch posts by author and category",
    };

    renderResourcesTab({
      resourceTemplates: [mockResourceTemplate, anotherTemplate],
    });

    // Select first template and fill values
    fireEvent.click(screen.getByText("Users API"));
    const nameInput = screen.getByTestId("combobox-name");
    fireEvent.change(nameInput, { target: { value: "john" } });

    // Switch to second template
    fireEvent.click(screen.getByText("Posts API"));

    // Should show new template fields and clear previous values
    expect(screen.getByTestId("combobox-author")).toBeInTheDocument();
    expect(screen.getByTestId("combobox-category")).toBeInTheDocument();
    expect(screen.queryByTestId("combobox-name")).not.toBeInTheDocument();
  });

  it("should display resource content when a resource is selected", () => {
    const resourceContent = '{"users": [{"id": 1, "name": "John"}]}';

    renderResourcesTab({
      selectedResource: mockResource,
      resourceContent: resourceContent,
    });

    expect(screen.getByTestId("json-view")).toBeInTheDocument();
    expect(screen.getByText(resourceContent)).toBeInTheDocument();
  });

  it("should show alert when no resource or template is selected", () => {
    renderResourcesTab();

    expect(
      screen.getByText(
        "Select a resource or template from the list to view its contents",
      ),
    ).toBeInTheDocument();
  });
});
