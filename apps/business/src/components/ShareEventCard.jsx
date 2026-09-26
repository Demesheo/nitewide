import { useEffect, useState } from 'react';
import { Share, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ShareEventCard({ referralUrl, canInviteGuest = false, onInviteGuest }) {
  const [copyMessage, setCopyMessage] = useState('');
  useEffect(() => setCopyMessage(''), [referralUrl]);
  if (!referralUrl && !canInviteGuest) return null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopyMessage('Referral link copied.');
    } catch {
      setCopyMessage('Could not copy the link. Please try again.');
    }
  }

  return <section className="panel guestlist-referral-card">
    <div className="guestlist-referral-copy">
      <span className="eyebrow">SHARE THIS EVENT</span>
      {referralUrl && <><h3>Your referral link</h3><p>Purchases and guestlist requests made through your link are attributed to you for this event.</p></>}
    </div>
    {referralUrl && <Button type="button" variant="outline" onClick={copyLink}><Share size={16} aria-hidden="true"/>{copyMessage === 'Referral link copied.' ? 'Copied' : 'Copy link'}</Button>}
    {copyMessage && <p className="guestlist-referral-status" role="status">{copyMessage}</p>}
    {canInviteGuest && <div className="guestlist-share-invite">
      <h3>Invite to guestlist</h3>
      <p>Add an existing customer to the guestlist, or create a private invitation link using their email or phone.</p>
      <Button className="guestlist-invite-button" type="button" onClick={onInviteGuest}><UserPlus size={16}/> Invite guest</Button>
    </div>}
  </section>;
}
