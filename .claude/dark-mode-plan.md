# Dark Mode Implementation Plan

## Overview

This plan implements a robust, user-friendly dark mode system for AVL GO following 2025 best practices with Tailwind CSS v4 and Next.js 16.

## Research Summary

Based on comprehensive research of the codebase and [2025 dark mode best practices](https://tailwindcss.com/docs/dark-mode), the recommended approach is:

1. **[next-themes library](https://github.com/pacocoursey/next-themes)** - Handles theme state, localStorage persistence, system preference detection, and hydration issues
2. **Class-based dark mode** - Using Tailwind v4's `@custom-variant dark` for full control
3. **CSS variables for semantic colors** - Define color tokens that adapt to light/dark themes
4. **Theme toggle in header** - Accessible toggle with system/light/dark options

---

## Implementation Steps

### Phase 1: Foundation Setup

#### 1.1 Install next-themes

```bash
npm install next-themes
```

#### 1.2 Update `app/globals.css`

Add dark mode configuration and semantic color variables:

```css
@import "tailwindcss";

/* Enable class-based dark mode for Tailwind v4 */
@custom-variant dark (&:where(.dark, .dark *));

:root {
  /* Light mode semantic colors */
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f9fafb;    /* gray-50 */
  --color-bg-tertiary: #f3f4f6;     /* gray-100 */
  --color-bg-hover: #f3f4f6;        /* gray-100 */

  --color-text-primary: #111827;    /* gray-900 */
  --color-text-secondary: #374151;  /* gray-700 */
  --color-text-tertiary: #6b7280;   /* gray-500 */
  --color-text-muted: #9ca3af;      /* gray-400 */

  --color-border-primary: #e5e7eb;  /* gray-200 */
  --color-border-secondary: #f3f4f6; /* gray-100 */

  --color-surface: #ffffff;
  --color-surface-elevated: #ffffff;

  /* Keep existing brand colors */
  --background: #ffffff;
  --foreground: #171717;
}

.dark {
  /* Dark mode semantic colors */
  --color-bg-primary: #0f0f0f;
  --color-bg-secondary: #171717;
  --color-bg-tertiary: #1f1f1f;
  --color-bg-hover: #262626;

  --color-text-primary: #f9fafb;    /* gray-50 */
  --color-text-secondary: #e5e7eb;  /* gray-200 */
  --color-text-tertiary: #9ca3af;   /* gray-400 */
  --color-text-muted: #6b7280;      /* gray-500 */

  --color-border-primary: #374151;  /* gray-700 */
  --color-border-secondary: #262626; /* gray-800 */

  --color-surface: #171717;
  --color-surface-elevated: #1f1f1f;

  --background: #0a0a0a;
  --foreground: #ededed;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);

  /* Expose semantic colors to Tailwind */
  --color-bg-primary: var(--color-bg-primary);
  --color-bg-secondary: var(--color-bg-secondary);
  --color-bg-tertiary: var(--color-bg-tertiary);
  --color-bg-hover: var(--color-bg-hover);

  --color-text-primary: var(--color-text-primary);
  --color-text-secondary: var(--color-text-secondary);
  --color-text-tertiary: var(--color-text-tertiary);
  --color-text-muted: var(--color-text-muted);

  --color-border-primary: var(--color-border-primary);
  --color-border-secondary: var(--color-border-secondary);

  --color-surface: var(--color-surface);
  --color-surface-elevated: var(--color-surface-elevated);

  /* Brand colors remain the same */
  --color-brand-50: #e8f4f8;
  --color-brand-100: #c5e3ed;
  --color-brand-200: #9fd0e1;
  --color-brand-500: #0a8bbf;
  --color-brand-600: #0871aa;
  --color-brand-700: #065c8a;
  --color-brand-800: #044869;

  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: Arial, Helvetica, sans-serif;
}
```

#### 1.3 Create ThemeProvider Component

Create `components/ThemeProvider.tsx`:

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { ReactNode } from "react";

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
```

#### 1.4 Update Providers Component

Update `components/Providers.tsx` to include ThemeProvider:

```tsx
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
```

#### 1.5 Update Layout

Update `app/layout.tsx` to add `suppressHydrationWarning`:

```tsx
<html lang="en" suppressHydrationWarning>
```

---

### Phase 2: Theme Toggle Component

#### 2.1 Create ThemeToggle Component

Create `components/ThemeToggle.tsx`:

```tsx
"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";
import { useState, useEffect, useRef } from "react";

export default function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Prevent hydration mismatch
  useEffect(() => setMounted(true), []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!mounted) {
    return (
      <button className="p-2 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="w-5 h-5" />
      </button>
    );
  }

  const options = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  const currentIcon = resolvedTheme === "dark" ? Moon : Sun;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="Toggle theme"
      >
        <currentIcon size={20} className="text-gray-600 dark:text-gray-300" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-36 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          {options.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => {
                setTheme(value);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 first:rounded-t-lg last:rounded-b-lg ${
                theme === value
                  ? "text-brand-600 dark:text-brand-400 font-medium"
                  : "text-gray-700 dark:text-gray-300"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

#### 2.2 Add ThemeToggle to Header

Update `app/page.tsx` header section to include the toggle.

---

### Phase 3: Component Updates (Systematic Dark Mode Classes)

The strategy is to add `dark:` variants to all existing Tailwind classes. Below is the mapping approach:

#### Color Mapping Strategy

| Light Mode | Dark Mode |
|------------|-----------|
| `bg-white` | `dark:bg-gray-900` |
| `bg-gray-50` | `dark:bg-gray-950` |
| `bg-gray-100` | `dark:bg-gray-800` |
| `bg-gray-200` | `dark:bg-gray-700` |
| `text-gray-900` | `dark:text-gray-50` |
| `text-gray-800` | `dark:text-gray-100` |
| `text-gray-700` | `dark:text-gray-200` |
| `text-gray-600` | `dark:text-gray-300` |
| `text-gray-500` | `dark:text-gray-400` |
| `text-gray-400` | `dark:text-gray-500` |
| `border-gray-200` | `dark:border-gray-700` |
| `border-gray-100` | `dark:border-gray-800` |
| `hover:bg-gray-50` | `dark:hover:bg-gray-800` |
| `hover:bg-gray-100` | `dark:hover:bg-gray-700` |
| `focus:ring-brand-500` | `dark:focus:ring-brand-400` |

#### 3.1 Update `app/page.tsx`

Key changes:
- `bg-gray-50` → `bg-gray-50 dark:bg-gray-950`
- `bg-white` → `bg-white dark:bg-gray-900`
- `border-gray-200` → `border-gray-200 dark:border-gray-700`
- `text-gray-500` → `text-gray-500 dark:text-gray-400`

#### 3.2 Update `components/EventFeed.tsx`

Key areas:
- Date group headers (sticky headers)
- Event container backgrounds
- Scroll-to-top button
- Filtering indicator overlay
- "No events found" message

#### 3.3 Update `components/EventCard.tsx`

Key areas:
- Card background and hover states
- Border colors
- Text colors (title, date, location, description)
- Price and tag badges
- Action buttons
- Hidden event overlay

#### 3.4 Update `components/FilterBar.tsx`

Key areas:
- Search input styling
- Filter dropdown buttons
- Dropdown menus and options
- Radio buttons and checkboxes
- Calendar component styling
- Day-of-week buttons

#### 3.5 Update `components/SettingsModal.tsx`

Key areas:
- Modal overlay and container
- Section backgrounds (especially the amber warning section)
- Toggle switch styling
- Form elements

#### 3.6 Update `components/AIChatModal.tsx`

Key areas:
- Modal container
- Message bubbles (user vs assistant)
- Input field
- Suggestion buttons
- Loading states

#### 3.7 Update `components/ActiveFilters.tsx`

Key areas:
- Background container (sticky bar)
- Filter count text
- Export links

#### 3.8 Update `components/InfoBanner.tsx`

Key areas:
- Banner background (brand colors should remain but may need adjustment)
- Close button

#### 3.9 Update UI Components

**`components/ui/FilterChip.tsx`**
- All variant styles need dark mode equivalents

**`components/ui/Calendar.tsx`**
- Navigation buttons
- Day cells
- Selected/today states
- Disabled days

**`components/ui/Toast.tsx`**
- Toast backgrounds (may need adjustment for dark mode visibility)

**`components/ui/TriStateCheckbox.tsx`**
- Checkbox backgrounds
- Label text

**`components/ui/ChipInput.tsx`**
- Container border and background
- Chip styling
- Input placeholder

---

### Phase 4: Special Considerations

#### 4.1 Brand Colors in Dark Mode

The brand color (#0871aa) works well in both modes but may need slight adjustments for dark mode:
- Light mode: `brand-600` for primary actions
- Dark mode: Consider `brand-500` or `brand-400` for better visibility

#### 4.2 Images and Generated Content

- AI-generated event images (base64) will display the same in both modes
- External images may need `dark:brightness-90` if they appear too bright
- Placeholder icons should invert colors appropriately

#### 4.3 Status Colors

For success/error/warning colors:
- Green variants: `bg-green-50 dark:bg-green-950/50`, `text-green-700 dark:text-green-400`
- Red variants: `bg-red-50 dark:bg-red-950/50`, `text-red-700 dark:text-red-400`
- Amber variants: `bg-amber-50 dark:bg-amber-950/50`, `text-amber-700 dark:text-amber-400`

#### 4.4 Scrollbar Styling (Optional Enhancement)

Add custom scrollbar colors for dark mode:

```css
/* In globals.css */
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
  }
}

.dark {
  color-scheme: dark;
}
```

#### 4.5 Logo Considerations

The current logo (`avlgo_banner_logo_v2.svg`) should be checked for dark mode visibility. Options:
1. If SVG uses black text → create a light version or use `dark:invert`
2. If SVG is already adaptable → no changes needed
3. Consider a CSS filter: `dark:brightness-0 dark:invert` for simple inversions

---

### Phase 5: Testing & Polish

#### 5.1 Testing Checklist

- [ ] System preference detection works (toggle OS dark mode)
- [ ] Manual toggle overrides system preference
- [ ] Preference persists across page refreshes
- [ ] No flash of unstyled content (FOUC) on page load
- [ ] All components render correctly in both modes
- [ ] Contrast ratios meet WCAG AA standards
- [ ] Focus states are visible in both modes
- [ ] Modals have proper backdrop in both modes

#### 5.2 Accessibility Verification

- Ensure all text has sufficient contrast (4.5:1 for normal text, 3:1 for large text)
- Focus indicators visible in both modes
- Interactive elements clearly distinguishable

---

## File Change Summary

| File | Changes |
|------|---------|
| `package.json` | Add `next-themes` dependency |
| `app/globals.css` | Add `@custom-variant dark`, CSS variables |
| `app/layout.tsx` | Add `suppressHydrationWarning` to `<html>` |
| `components/ThemeProvider.tsx` | **New file** - Theme provider wrapper |
| `components/ThemeToggle.tsx` | **New file** - Theme toggle dropdown |
| `components/Providers.tsx` | Wrap with ThemeProvider |
| `app/page.tsx` | Add dark mode classes, add ThemeToggle to header |
| `components/EventFeed.tsx` | Add dark mode classes |
| `components/EventCard.tsx` | Add dark mode classes |
| `components/FilterBar.tsx` | Add dark mode classes |
| `components/SettingsModal.tsx` | Add dark mode classes |
| `components/AIChatModal.tsx` | Add dark mode classes |
| `components/ActiveFilters.tsx` | Add dark mode classes |
| `components/InfoBanner.tsx` | Add dark mode classes |
| `components/ui/FilterChip.tsx` | Add dark mode variants |
| `components/ui/Calendar.tsx` | Add dark mode classes |
| `components/ui/Toast.tsx` | Add dark mode classes |
| `components/ui/TriStateCheckbox.tsx` | Add dark mode classes |
| `components/ui/ChipInput.tsx` | Add dark mode classes |

---

## Estimated Scope

- **New files**: 2 (ThemeProvider, ThemeToggle)
- **Modified files**: ~15
- **Total dark mode class additions**: ~200-300 class modifications

---

## References

- [Tailwind CSS v4 Dark Mode Docs](https://tailwindcss.com/docs/dark-mode)
- [next-themes GitHub](https://github.com/pacocoursey/next-themes)
- [shadcn/ui Dark Mode Guide](https://ui.shadcn.com/docs/dark-mode/next)
- [Tailwind CSS v4 with Next.js Guide](https://www.storieasy.com/blog/light-and-dark-mode-in-tailwind-css-v4-with-next-js)
