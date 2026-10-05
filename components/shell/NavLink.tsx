"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { isCurrent } from "./current";

type Props = { href: string; className?: string; match?: "exact" | "section"; children: React.ReactNode };

function Current({ href, className, match, children }: Props) {
  const current = isCurrent(href, usePathname(), useSearchParams(), match);
  return (
    <Link href={href} className={className} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}

/** A navigation link that marks itself as the current page (rules in ./current.ts). */
export function NavLink(props: Props) {
  return (
    <Suspense
      fallback={
        <Link href={props.href} className={props.className}>
          {props.children}
        </Link>
      }
    >
      <Current {...props} />
    </Suspense>
  );
}
