import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ProfileLogout({ onLogout }) {
  return <footer className="business-profile-logout">
    <Button type="button" variant="outline" disabled={!onLogout} onClick={onLogout}><LogOut size={16} aria-hidden="true"/> Log out</Button>
  </footer>;
}
