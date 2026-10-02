import logo from '../assets/nitewide-logo-v1.png';

export function AdminBrand({ href = '/', onClick }) {
  return <a className="brand" href={href} onClick={onClick} aria-label="Nitewide Admin home">
    <img className="admin-brand-logo" src={logo} alt="" aria-hidden="true" width="192" height="192" decoding="async" draggable="false" />
    NITEWIDE <em>ADMIN</em>
  </a>;
}

export function AdminLoginMark() {
  return <img className="admin-login-logo" src={logo} alt="" aria-hidden="true" width="192" height="192" decoding="async" draggable="false" />;
}
