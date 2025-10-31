// Define Icon type locally since it might not be exported yet
interface Icon {
  src: string;
  mimeType?: string;
  sizes?: string[];
}

// Helper type for objects that may have icons
export interface WithIcons {
  icons?: Icon[];
}

interface IconDisplayProps {
  icons?: Icon[];
  className?: string;
  size?: "sm" | "md" | "lg";
}

const IconDisplay = ({
  icons,
  className = "",
  size = "md",
}: IconDisplayProps) => {
  if (!icons || icons.length === 0) {
    return null;
  }

  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  };

  const sizeClass = sizeClasses[size];

  return (
    <div className={`flex gap-1 ${className}`}>
      {icons.map((icon, index) => (
        <img
          key={index}
          src={icon.src}
          alt=""
          className={`${sizeClass} object-contain flex-shrink-0`}
          style={{
            imageRendering: "auto",
          }}
          onError={(e) => {
            // Hide broken images
            e.currentTarget.style.display = "none";
          }}
        />
      ))}
    </div>
  );
};

export default IconDisplay;
