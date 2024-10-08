import { useState } from "react";
import { Copy } from "lucide-react";

const CommandHistory = ({
  commandHistory,
}: {
  commandHistory: Array<{ command: string; response: string | null }>;
}) => {
  const [expandedCommands, setExpandedCommands] = useState<{
    [key: number]: boolean;
  }>({});

  const toggleCommandExpansion = (index: number) => {
    setExpandedCommands((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="w-64 bg-white shadow-md p-4 overflow-y-auto">
      <h2 className="text-lg font-semibold mb-4">Command History</h2>
      <ul className="space-y-3">
        {commandHistory
          .slice()
          .reverse()
          .map((cmd, index) => (
            <li
              key={index}
              className="text-sm text-gray-600 bg-gray-100 p-2 rounded"
            >
              <div
                className="flex justify-between items-center cursor-pointer"
                onClick={() =>
                  toggleCommandExpansion(commandHistory.length - 1 - index)
                }
              >
                <span className="font-mono">
                  {commandHistory.length - index}.{" "}
                  {JSON.parse(cmd.command).type}
                </span>
                <span>
                  {expandedCommands[commandHistory.length - 1 - index]
                    ? "▼"
                    : "▶"}
                </span>
              </div>
              {expandedCommands[commandHistory.length - 1 - index] && (
                <>
                  <div className="mt-2">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-semibold text-blue-600">
                        Command:
                      </span>
                      <button
                        onClick={() => copyToClipboard(cmd.command)}
                        className="text-blue-500 hover:text-blue-700"
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap break-words bg-blue-50 p-2 rounded">
                      {JSON.stringify(JSON.parse(cmd.command), null, 2)}
                    </pre>
                  </div>
                  {cmd.response && (
                    <div className="mt-2">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-green-600">
                          Response:
                        </span>
                        <button
                          onClick={() => copyToClipboard(cmd.response!)}
                          className="text-blue-500 hover:text-blue-700"
                        >
                          <Copy size={16} />
                        </button>
                      </div>
                      <pre className="whitespace-pre-wrap break-words bg-green-50 p-2 rounded">
                        {JSON.stringify(JSON.parse(cmd.response), null, 2)}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
};

export default CommandHistory;
