import { useState } from "react";
import { Copy } from "lucide-react";

const History = ({
  requestHistory,
}: {
  requestHistory: Array<{ request: string; response: string | null }>;
}) => {
  const [expandedRequests, setExpandedRequests] = useState<{
    [key: number]: boolean;
  }>({});

  const toggleRequestExpansion = (index: number) => {
    setExpandedRequests((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="w-64 bg-white shadow-md p-4 overflow-y-auto">
      <h2 className="text-lg font-semibold mb-4">History</h2>
      <ul className="space-y-3">
        {requestHistory
          .slice()
          .reverse()
          .map((request, index) => (
            <li
              key={index}
              className="text-sm text-gray-600 bg-gray-100 p-2 rounded"
            >
              <div
                className="flex justify-between items-center cursor-pointer"
                onClick={() =>
                  toggleRequestExpansion(requestHistory.length - 1 - index)
                }
              >
                <span className="font-mono">
                  {requestHistory.length - index}.{" "}
                  {JSON.parse(request.request).type}
                </span>
                <span>
                  {expandedRequests[requestHistory.length - 1 - index]
                    ? "▼"
                    : "▶"}
                </span>
              </div>
              {expandedRequests[requestHistory.length - 1 - index] && (
                <>
                  <div className="mt-2">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-semibold text-blue-600">
                        Request:
                      </span>
                      <button
                        onClick={() => copyToClipboard(request.request)}
                        className="text-blue-500 hover:text-blue-700"
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap break-words bg-blue-50 p-2 rounded">
                      {JSON.stringify(JSON.parse(request.request), null, 2)}
                    </pre>
                  </div>
                  {request.response && (
                    <div className="mt-2">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-green-600">
                          Response:
                        </span>
                        <button
                          onClick={() => copyToClipboard(request.response!)}
                          className="text-blue-500 hover:text-blue-700"
                        >
                          <Copy size={16} />
                        </button>
                      </div>
                      <pre className="whitespace-pre-wrap break-words bg-green-50 p-2 rounded">
                        {JSON.stringify(JSON.parse(request.response), null, 2)}
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

export default History;
