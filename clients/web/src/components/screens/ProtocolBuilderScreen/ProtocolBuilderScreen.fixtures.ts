import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const flightBookingTools: Tool[] = [
  {
    name: "search_flights",
    title: "Search Flights",
    description: "Search available flights matching the given criteria",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string" },
        destination: { type: "string" },
        date: { type: "string", format: "date" },
      },
      required: ["origin", "destination", "date"],
    },
  },
  {
    name: "book_flight",
    title: "Book Flight",
    description: "Reserve a seat on the chosen flight",
    inputSchema: {
      type: "object",
      properties: {
        flightId: { type: "string" },
        passenger: { type: "string" },
      },
      required: ["flightId", "passenger"],
    },
  },
  {
    name: "cancel_booking",
    title: "Cancel Booking",
    description: "Cancel a confirmed booking",
    inputSchema: {
      type: "object",
      properties: { bookingId: { type: "string" } },
      required: ["bookingId"],
    },
  },
];
