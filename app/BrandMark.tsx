/**
 * The UI brand mark — separate from /favicon.png, which is only the
 * browser-tab icon (wired via metadata.icons in layout.tsx). This is what
 * shows in every on-screen header.
 */
export default function BrandMark({ size = 20 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/icon.png" alt="Hestia" height={size} className="brand-mark" />;
}
