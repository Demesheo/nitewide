import logo from '../assets/nitewide-logo-v1.png';

export function BrandMark({ className = '' }) {
  return <img className={`business-brand-image ${className}`} src={logo} alt="" aria-hidden="true"
    width="192" height="192" decoding="async" draggable="false" />;
}

export function BusinessBrand({ landing = false, href }) {
  const Element = href ? 'a' : 'div';
  return <Element className={landing ? 'lp-brand' : 'brand'} href={href}
    aria-label={href ? 'Nitewide Business home' : undefined}>
    <span className={landing ? 'lp-brand-icon' : 'brand-icon'}><BrandMark /></span>
    <span>nitewide{landing ? <small>BUSINESS</small> : <span className="brand-sub">BUSINESS</span>}</span>
  </Element>;
}
