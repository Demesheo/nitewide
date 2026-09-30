import { ProfileDetails } from './profile/ProfileDetails';
import { ProfileSettings } from './profile/ProfileSettings';
import { ProfileLogout } from './profile/ProfileLogout';

export function BusinessProfile({ session, onUpdated, onLogout, capabilities = {} }) {
  return <section className="business-profile-panel" aria-label="Your profile">
    <ProfileDetails session={session} onUpdated={onUpdated} capabilities={capabilities}/>
    <ProfileSettings session={session}/>
    <ProfileLogout onLogout={onLogout}/>
  </section>;
}
