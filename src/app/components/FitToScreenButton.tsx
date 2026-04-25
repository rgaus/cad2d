"use client";

type FitToScreenButtonProps = {
  onClick: () => void;
};

export default function FitToScreenButton({ onClick }: FitToScreenButtonProps) {
  return (
    <button
      onClick={onClick}
      title="Fit to screen"
      className="fixed bottom-6 right-6 w-10 h-10 bg-[#333] rounded-[4px] flex items-center justify-center hover:bg-[#444] transition-colors"
    >
      <FitToScreenIcon />
    </button>
  );
}

function FitToScreenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="w-5 h-5">
      <path d="M4 4h4v4H4zM16 4h4v4h-4zM4 16h4v4H4zM16 16h4v4h-4z" fill="none" />
    </svg>
  );
}
