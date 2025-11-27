"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { X, Plus } from "lucide-react";

interface ChipInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  label?: string;
}

export default function ChipInput({
  values,
  onChange,
  placeholder = "Type and press Enter...",
  label,
}: ChipInputProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      const newValue = inputValue.trim();
      if (!values.includes(newValue)) {
        onChange([...values, newValue]);
      }
      setInputValue("");
    } else if (e.key === "Backspace" && !inputValue && values.length > 0) {
      // Remove last chip on backspace when input is empty
      onChange(values.slice(0, -1));
    }
  };

  const handleRemove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    if (inputValue.trim()) {
      const newValue = inputValue.trim();
      if (!values.includes(newValue)) {
        onChange([...values, newValue]);
      }
      setInputValue("");
      inputRef.current?.focus();
    }
  };

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
        </label>
      )}
      <div
        className="flex flex-wrap gap-2 p-3 border border-gray-200 rounded-lg bg-white min-h-[80px] cursor-text focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500"
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((value, index) => (
          <span
            key={`${value}-${index}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium"
          >
            {value}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(index);
              }}
              className="p-0.5 rounded-full hover:bg-blue-200 transition-colors"
              aria-label={`Remove ${value}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <div className="flex items-center gap-1 flex-grow min-w-[120px]">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={values.length === 0 ? placeholder : "Add more..."}
            className="flex-grow outline-none text-sm bg-transparent min-w-[80px]"
          />
          {inputValue && (
            <button
              type="button"
              onClick={handleAdd}
              className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
              aria-label="Add"
            >
              <Plus size={16} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Press Enter to add, click chip to remove
      </p>
    </div>
  );
}
