"use client";

import { ReactNode } from "react";
import { ToastProvider, ToastStyles } from "./ui/Toast";
import { ThemeProvider } from "./ThemeProvider";
import { AuthProvider } from "./AuthProvider";

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <ToastStyles />
          {children}
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
