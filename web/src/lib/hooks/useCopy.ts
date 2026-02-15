"use client";

import { useEffect, useState } from "react";

type UseCopyProps = {
  timeout?: number;
};

function useCopy({ timeout = 500 }: UseCopyProps = {}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (copied) {
      timeoutId = setTimeout(() => {
        setCopied(false);
      }, timeout);
    }
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [copied, timeout]);

  return { copied, setCopied };
}

export default useCopy;
