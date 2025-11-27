"use client";

import { ReactNode } from "react";
import { ToastProvider, ToastStyles } from "./ui/Toast";

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <ToastProvider>
      <ToastStyles />
      {children}
    </ToastProvider>
  );
}
