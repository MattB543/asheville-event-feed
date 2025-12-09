"use client";

import { ReactNode } from "react";
import { ToastProvider, ToastStyles } from "./ui/Toast";
import { ThemeProvider } from "./ThemeProvider";

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ToastStyles />
        {children}
      </ToastProvider>
    </ThemeProvider>
  );
}
