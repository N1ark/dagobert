/// <reference types="vite/client" />

declare module "virtual:icons" {
  /** Every icon's regular-weight shapes by kebab-case name (vite.config.js). */
  const icons: Record<string, string>;
  export default icons;
}

declare module "virtual:icon-names" {
  /** Every icon's kebab-case name, sorted. */
  const names: string[];
  export default names;
}
