// M13 (c3): `webkitdirectory` lets a file input choose a whole folder (Chrome,
// Safari, Firefox). Browsers know it; React's types do not list it yet.
import "react";

declare module "react" {
  // The type parameter must match React's own declaration to merge with it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
  }
}
