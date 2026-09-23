import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
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
      <h3>{referralUrl ? 'Your referral link' : 'Invite guests'}</h3>
      {referralUrl && <p>Purchases and guestlist requests made through your link are attributed to you for this event.</p>}
    </div>
    {referralUrl && <Button type="button" variant="outline" onClick={copyLink}>{copyMessage === 'Referral link copied.' ? 'Copied' : 'Copy link'}</Button>}
    {copyMessage && <p className="guestlist-referral-status" role="status">{copyMessage}</p>}
    {canInviteGuest && <div className="guestlist-share-invite">
      <p>Add an existing customer to the guestlist, or create a private invitation link using their email or phone.</p>
      <Button className="guestlist-invite-button" type="button" onClick={onInviteGuest}><UserPlus size={16}/> Invite guest</Button>
    </div>}
  </section>;
}
