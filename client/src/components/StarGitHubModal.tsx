import React from "react";
import { Star, X, ExternalLink } from "lucide-react";

interface StarGitHubModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const StarGitHubModal: React.FC<StarGitHubModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const handleStarClick = () => {
    window.open("https://github.com/modelcontextprotocol/inspector", "_blank");
    onClose();
  };

  const handleDismiss = () => {
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 border border-slate-200 dark:border-slate-700">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center">
              <Star className="w-5 h-5 text-white fill-current" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Loving MCP Inspector?
            </h2>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-slate-600 dark:text-slate-300 text-center mb-6 leading-relaxed">
            If you're finding MCP Inspector helpful, we'd love your support! A
            GitHub star helps others discover this tool and motivates us to keep
            improving it.
          </p>

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleStarClick}
              className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg px-4 py-3 font-medium transition-all duration-200 flex items-center justify-center space-x-2 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              <Star className="w-4 h-4 fill-current" />
              <span>Star on GitHub</span>
              <ExternalLink className="w-4 h-4" />
            </button>
            <button
              onClick={handleDismiss}
              className="flex-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg px-4 py-3 font-medium transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
            This message won't appear again once dismissed
          </p>
        </div>
      </div>
    </div>
  );
};

export default StarGitHubModal;
