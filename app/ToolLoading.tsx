import BrandMark from "./BrandMark";

/**
 * Shown while a workspace route fetches. Every app route is force-dynamic and
 * the editor alone runs eight queries, so without this the reader sits on a
 * blank page. The bar is drawn for real and only the body is skeletal, so the
 * frame does not jump when the data lands.
 */
export default function ToolLoading({ label }: { label: string }) {
  return (
    <div className="surface tool-loading">
      <header className="bar">
        <span className="bar-mark">
          <BrandMark size={28} />
        </span>
        <p className="crumb" aria-hidden="true">
          {label}
        </p>
      </header>

      <div className="doc-scroll" role="status" aria-live="polite">
        <span className="sr-only">{label} 불러오는 중</span>
        <div className="skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
