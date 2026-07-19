import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ListPaginationControls } from "./ListPaginationControls";

const meta: Meta<typeof ListPaginationControls> = {
  title: "Elements/ListPaginationControls",
  component: ListPaginationControls,
  args: {
    onPaginatedChange: fn(),
    onLoadMore: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ListPaginationControls>;

export const AllPages: Story = {
  args: {
    paginated: false,
    canLoadMore: false,
    loadedPages: 0,
  },
};

export const SinglePageWithMore: Story = {
  args: {
    paginated: true,
    canLoadMore: true,
    loadedPages: 2,
  },
};

export const SinglePageAtEnd: Story = {
  args: {
    paginated: true,
    canLoadMore: false,
    loadedPages: 3,
  },
};

export const SinglePageFirstPage: Story = {
  args: {
    paginated: true,
    canLoadMore: true,
    loadedPages: 1,
  },
};
