export default function PageHeader({ title, description, children }) {
  return <header className="page-head admin-page-header" role="region" aria-label={`${title} workspace`}>
    <p className="eyebrow">NITEWIDE ADMIN</p><h1>{title}</h1>
    {description && <p className="page-description">{description}</p>}
    {children && <div className="page-header-actions">{children}</div>}
  </header>;
}
