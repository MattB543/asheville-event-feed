"use client";

import * as React from "react";
import { DayPicker, DateRange as DayPickerDateRange } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

// Error boundary wrapper for Calendar to catch invalid date errors
class CalendarErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("Calendar error:", error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-3 text-sm text-gray-500 dark:text-gray-400">
          Unable to display calendar
        </div>
      );
    }
    return this.props.children;
  }
}

function CalendarInner({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={`p-3 rdp-custom ${className || ""}`}
      classNames={{
        months: "relative flex flex-col gap-4",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center items-center h-7",
        caption_label: "text-sm font-medium text-gray-900 dark:text-gray-100",
        nav: "absolute top-3 left-3 right-3 flex justify-between items-center pointer-events-none",
        button_previous:
          "pointer-events-auto h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 inline-flex items-center justify-center rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer text-gray-600 dark:text-gray-300",
        button_next:
          "pointer-events-auto h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 inline-flex items-center justify-center rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer text-gray-600 dark:text-gray-300",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "text-gray-500 dark:text-gray-400 rounded-md w-9 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: "h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20 text-gray-900 dark:text-gray-100",
        day_button:
          "h-9 w-9 p-0 font-normal inline-flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer",
        range_end: "rounded-r-md",
        range_start: "rounded-l-md",
        selected:
          "bg-brand-500 text-white hover:bg-brand-600 hover:text-white focus:bg-brand-500 focus:text-white rounded-md",
        today: "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md",
        outside: "text-gray-400 dark:text-gray-600 opacity-50",
        disabled: "text-gray-400 dark:text-gray-600 opacity-50 cursor-not-allowed",
        range_middle: "rounded-none bg-brand-50 dark:bg-brand-900/30",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  );
}

CalendarInner.displayName = "CalendarInner";

// Wrap Calendar with error boundary to catch invalid date errors
function Calendar(props: CalendarProps) {
  return (
    <CalendarErrorBoundary>
      <CalendarInner {...props} />
    </CalendarErrorBoundary>
  );
}

Calendar.displayName = "Calendar";

export { Calendar };
export type { DayPickerDateRange };
