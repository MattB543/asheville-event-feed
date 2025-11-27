"use client";

import { X } from "lucide-react";

interface FilterChipProps {
  label: string;
  onRemove?: () => void;
  variant?: "default" | "active" | "muted";
  className?: string;
}

const variantStyles = {
  default: "bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200",
  active: "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200",
  muted: "bg-gray-50 text-gray-500 border-gray-100",
};

export default function FilterChip({
  label,
  onRemove,
  variant = "active",
  className = "",
}: FilterChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${variantStyles[variant]} ${className}`}
    >
      {label}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 p-0.5 rounded-full hover:bg-black/10 transition-colors"
          aria-label={`Remove ${label} filter`}
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}
