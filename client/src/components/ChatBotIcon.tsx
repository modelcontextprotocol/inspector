import React, { useState, useEffect } from "react";
import { MessageCircle } from "lucide-react";

interface ChatBotIconProps {
    onClick: () => void;
    isOpen: boolean;
}

const ROTATION_DURATION = 500; // 1 second

const ChatBotIcon: React.FC<ChatBotIconProps> = ({ onClick, isOpen }) => {
    const [imageError, setImageError] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);
    const [pendingAction, setPendingAction] = useState<null | (() => void)>(null);

    // Animation trigger
    const handleIconClick = () => {
        if (isAnimating) return;
        setIsAnimating(true);
        setPendingAction(() => onClick);
    };

    // After animation, call onClick
    useEffect(() => {
        if (isAnimating && pendingAction) {
            const timer = setTimeout(() => {
                setIsAnimating(false);
                pendingAction();
                setPendingAction(null);
            }, ROTATION_DURATION);
            return () => clearTimeout(timer);
        }
    }, [isAnimating, pendingAction]);

    // Animation class
    const rotationClass = isAnimating
        ? isOpen
            ? "rotate-anticlockwise"
            : "rotate-clockwise"
        : "";

    return (
        <div
            className={`
                fixed bottom-6 right-6 z-50 
                w-40 h-40 rounded-full flex items-center justify-center 
                shadow-lg transition-all duration-200 cursor-pointer 
                hover:scale-110 hover:shadow-xl 
                ${isOpen ? "bg-muted" : "bg-muted"}
            `}
            onClick={handleIconClick}
            aria-label="Open chatbot"
            style={{ pointerEvents: isAnimating ? "none" : "auto" }}
        >
            {!imageError ? (
                <img
                    src="/gato_malo.png"
                    alt="Chatbot Icon"
                    className={`w-40 h-40 object-contain ${rotationClass}`}
                    onError={() => setImageError(true)}
                    style={{ willChange: "transform" }}
                />
            ) : (
                <MessageCircle className="w-12 h-12 text-white" />
            )}
            {/* Animation keyframes */}
            <style>{`
                @keyframes rotate-clockwise {
                    0% { transform: rotate(0deg);}
                    100% { transform: rotate(720deg);}
                }
                @keyframes rotate-anticlockwise {
                    0% { transform: rotate(0deg);}
                    100% { transform: rotate(-720deg);}
                }
                .rotate-clockwise {
                    animation: rotate-clockwise ${ROTATION_DURATION}ms linear;
                }
                .rotate-anticlockwise {
                    animation: rotate-anticlockwise ${ROTATION_DURATION}ms linear;
                }
            `}</style>
        </div>
    );
};

export default ChatBotIcon;
