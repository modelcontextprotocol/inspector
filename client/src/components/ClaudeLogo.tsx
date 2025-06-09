import React from "react";

interface ClaudeLogoProps {
  className?: string;
  size?: number;
}

export const ClaudeLogo: React.FC<ClaudeLogoProps> = ({
  className = "",
  size = 32,
}) => {
  return (
    <img
      src="/claude_logo.png"
      alt="Claude Logo"
      width={size}
      height={size}
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
      }}
    />
  );
};
