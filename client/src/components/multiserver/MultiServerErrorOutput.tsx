import React from "react";
import { Button } from "../ui/button";
import { StdErrNotification } from "../../lib/notificationTypes";

interface MultiServerErrorOutputProps {
  serverName: string;
  stdErrNotifications: StdErrNotification[];
  onClear: () => void;
}

export const MultiServerErrorOutput: React.FC<MultiServerErrorOutputProps> = ({
  serverName,
  stdErrNotifications,
  onClear,
}) => {
  if (stdErrNotifications.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 border-t border-gray-200 pt-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium">Error output from {serverName}</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={onClear}
          className="h-8 px-2"
        >
          Clear
        </Button>
      </div>
      <div className="mt-2 max-h-80 overflow-y-auto">
        {stdErrNotifications.map((notification, index) => (
          <div
            key={index}
            className="text-sm text-red-500 font-mono py-2 border-b border-gray-200 last:border-b-0"
          >
            {notification.params.content}
          </div>
        ))}
      </div>
    </div>
  );
};
