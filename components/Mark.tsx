/** The Neolibrary mark: an open book with a doorway in its spine. */
export function Mark({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="M16 9.5C12.8 7 8.6 6.4 4 7v17.5c4.6-.6 8.8 0 12 2.5 3.2-2.5 7.4-3.1 12-2.5V7c-4.6-.6-8.8 0-12 2.5Z" />
      <path d="M13.2 26V16.5a2.8 2.8 0 0 1 5.6 0V26" fill="var(--accent)" stroke="var(--accent)" />
    </svg>
  );
}
