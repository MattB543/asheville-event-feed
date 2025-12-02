"use client";

import { Check, X } from "lucide-react";

export type TriState = "off" | "include" | "exclude";

interface TriStateCheckboxProps {
  state: TriState;
  onChange: () => void;
  label?: string;
  className?: string;
}

export default function TriStateCheckbox({
  state,
  onChange,
  label,
  className = "",
}: TriStateCheckboxProps) {
  return (
    <label
      className={`flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer ${className}`}
      onClick={(e) => {
        e.preventDefault();
        onChange();
      }}
    >
      <div
        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
          state === "off"
            ? "border-gray-300 bg-white"
            : state === "include"
              ? "border-green-500 bg-green-500"
              : "border-red-500 bg-red-500"
        }`}
      >
        {state === "include" && <Check size={12} className="text-white" strokeWidth={3} />}
        {state === "exclude" && <X size={12} className="text-white" strokeWidth={3} />}
      </div>
      {label && <span className="text-sm text-gray-700">{label}</span>}
    </label>
  );
}
