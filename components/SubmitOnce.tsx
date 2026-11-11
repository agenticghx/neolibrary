"use client";

import { useFormStatus } from "react-dom";

/**
 * A form's submit button that cannot be pressed again while the form is being sent: a second press before the first
 * was saved made the same note twice (the Path view's notes).
 */
export function SubmitOnce({ className, children }: { className?: string; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {children}
    </button>
  );
}
