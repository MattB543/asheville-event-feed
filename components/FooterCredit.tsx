const LINK_CLASS = 'underline hover:text-gray-700 dark:hover:text-gray-300';

/**
 * The credit line every page footer shares. Below xl the header no longer has
 * room for "Open-sourced by Matt", so this is where the GitHub link lives.
 */
export default function FooterCredit() {
  return (
    <p className="mb-2">
      <a
        href="https://github.com/MattB543/asheville-event-feed"
        target="_blank"
        rel="noopener noreferrer"
        className={LINK_CLASS}
      >
        Open-sourced
      </a>{' '}
      and built by{' '}
      <a
        href="https://mattbrooks.xyz"
        target="_blank"
        rel="noopener noreferrer"
        className={LINK_CLASS}
      >
        Matt
      </a>{' '}
      at Brooks Solutions, LLC.
    </p>
  );
}
