import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ManualCopyLink, useClipboardCopy } from '../../../shared/clipboard-copy.jsx';
import { CopyLinkButton } from '../../../shared/copy-link-button.jsx';

export function ShareEventCard({ referralUrl, canInviteGuest = false, onInviteGuest, referralError = '', onRetryReferral }) {
  const [copyMessage, setCopyMessage] = useState('');
  const { copy, manualLink } = useClipboardCopy(referralUrl);
  useEffect(() => setCopyMessage(''), [referralUrl]);
  if (!referralUrl && !canInviteGuest && !referralError) return null;

  async function copyLink() {
    try {
      await copy(referralUrl);
      setCopyMessage('Referral link copied.');
    } catch (error) {
      setCopyMessage(error.message);
    }
  }

  return <section className="panel guestlist-referral-card">
    <div className="guestlist-referral-copy">
      <span className="eyebrow">SHARE THIS EVENT</span>
      {referralUrl && <><h3>Your referral link</h3><p>Purchases and guestlist requests made through your link are attributed to you for this event.</p></>}
    </div>
    {referralUrl && <CopyLinkButton component={Button} onClick={copyLink} copied={copyMessage === 'Referral link copied.'} copiedLabel="Copied"/>}
    {referralError && <div><p className="error" role="alert">Your referral link could not be loaded: {referralError}</p><Button type="button" variant="outline" onClick={onRetryReferral}>Retry</Button></div>}
    {copyMessage && <p className="guestlist-referral-status" role="status">{copyMessage}</p>}
    <ManualCopyLink link={manualLink}/>
    {canInviteGuest && <div className="guestlist-share-invite">
      <h3>Invite to guestlist</h3>
      <p>Invite your guest by name and share their private entry passes. No guest account is required.</p>
      <Button className="guestlist-invite-button" type="button" onClick={onInviteGuest}><UserPlus size={16}/> Invite guest</Button>
    </div>}
  </section>;
}
