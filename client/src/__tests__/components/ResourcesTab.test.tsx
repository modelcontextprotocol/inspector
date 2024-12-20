import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ResourcesTab from "../../components/ResourcesTab";
import { Tabs } from "@/components/ui/tabs";
import type {
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";

describe("ResourcesTab", () => {
  const mockResources: Resource[] = [
    { uri: "file:///test1.txt", name: "Test 1" },
    { uri: "file:///test2.txt", name: "Test 2" },
  ];

  const mockTemplates: ResourceTemplate[] = [
    {
      name: "Template 1",
      description: "Test template 1",
      uriTemplate: "file:///test/{param1}/{param2}.txt",
    },
    {
      name: "Template 2",
      description: "Test template 2",
      uriTemplate: "file:///other/{name}.txt",
    },
  ];

  const defaultProps = {
    resources: mockResources,
    resourceTemplates: mockTemplates,
    listResources: vi.fn(),
    clearResources: vi.fn(),
    listResourceTemplates: vi.fn(),
    clearResourceTemplates: vi.fn(),
    readResource: vi.fn(),
    selectedResource: null,
    setSelectedResource: vi.fn(),
    resourceContent: "",
    nextCursor: null,
    nextTemplateCursor: null,
    error: null,
  };

  const renderWithTabs = (component: React.ReactElement) => {
    return render(<Tabs defaultValue="resources">{component}</Tabs>);
  };

  it("renders resources list", () => {
    renderWithTabs(<ResourcesTab {...defaultProps} />);
    expect(screen.getByText("Test 1")).toBeInTheDocument();
    expect(screen.getByText("Test 2")).toBeInTheDocument();
  });

  it("renders templates list", () => {
    renderWithTabs(<ResourcesTab {...defaultProps} />);
    expect(screen.getByText("Template 1")).toBeInTheDocument();
    expect(screen.getByText("Template 2")).toBeInTheDocument();
  });

  it("shows resource content when resource is selected", () => {
    const props = {
      ...defaultProps,
      selectedResource: mockResources[0],
      resourceContent: "Test content",
    };
    renderWithTabs(<ResourcesTab {...props} />);
    expect(screen.getByText("Test content")).toBeInTheDocument();
  });

  it("shows template form when template is selected", () => {
    renderWithTabs(<ResourcesTab {...defaultProps} />);

    fireEvent.click(screen.getByText("Template 1"));
    expect(screen.getByText("Test template 1")).toBeInTheDocument();
    expect(screen.getByLabelText("param1")).toBeInTheDocument();
    expect(screen.getByLabelText("param2")).toBeInTheDocument();
  });

  it("fills template and reads resource", () => {
    const readResource = vi.fn();
    const setSelectedResource = vi.fn();
    renderWithTabs(
      <ResourcesTab
        {...defaultProps}
        readResource={readResource}
        setSelectedResource={setSelectedResource}
      />,
    );

    // Select template
    fireEvent.click(screen.getByText("Template 1"));

    // Fill in template parameters
    fireEvent.change(screen.getByLabelText("param1"), {
      target: { value: "value1" },
    });
    fireEvent.change(screen.getByLabelText("param2"), {
      target: { value: "value2" },
    });

    // Submit form
    fireEvent.click(screen.getByText("Read Resource"));

    expect(readResource).toHaveBeenCalledWith("file:///test/value1/value2.txt");
    expect(setSelectedResource).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: "file:///test/value1/value2.txt",
        name: "file:///test/value1/value2.txt",
      }),
    );
  });

  it("shows error message when error prop is provided", () => {
    const props = {
      ...defaultProps,
      error: "Test error message",
    };
    renderWithTabs(<ResourcesTab {...props} />);
    expect(screen.getByText("Test error message")).toBeInTheDocument();
  });

  it("refreshes resource content when refresh button is clicked", () => {
    const readResource = vi.fn();
    const props = {
      ...defaultProps,
      selectedResource: mockResources[0],
      readResource,
    };
    renderWithTabs(<ResourcesTab {...props} />);

    fireEvent.click(screen.getByText("Refresh"));
    expect(readResource).toHaveBeenCalledWith(mockResources[0].uri);
  });
});
