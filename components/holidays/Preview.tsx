import Link from 'next/link';

/** The preview buttons, in the page's colours (`className`) */
function PreviewButton({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex rounded-full px-5 py-2.5 text-sm font-semibold ${className}`}
    >
      {children}
    </Link>
  );
}

/** On a closed holiday page, for an admin or a dev server: open it anyway */
export function PreviewLink({ className }: { className: string }) {
  return (
    <span className="mt-5 block">
      <PreviewButton href="?preview=1" className={className}>
        Preview it
      </PreviewButton>
    </span>
  );
}

/** While previewing a closed page: back to it as visitors see it */
export function PreviewNotice({ path, className }: { path: string; className: string }) {
  return (
    <div className="relative z-10 pt-4 text-center">
      <PreviewButton href={path} className={className}>
        Exit preview
      </PreviewButton>
    </div>
  );
}
