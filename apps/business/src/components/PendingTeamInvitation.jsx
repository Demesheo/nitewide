import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { CopyLinkButton } from '../../../shared/copy-link-button.jsx';
import { ManualCopyLink, useClipboardCopy } from '../../../shared/clipboard-copy.jsx';
import { teamInvitationUrl } from '@/lib/team-invitation-link';

const roleName = role => role === 'affiliate' ? 'Promoter' : role === 'manager' ? 'Manager' : role === 'owner' ? 'Owner' : 'Employee';

export function PendingTeamInvitation({ invitation, busy, onDelete, onResend }) {
  // The authorized directory response prepares the link before any tap.
  const link = invitation.token ? teamInvitationUrl(invitation.token) : '';
  const { copy, manualLink } = useClipboardCopy(link);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setCopied(false); setError(''); }, [link]);
  async function copyLink() {
    try { await copy(link); setCopied(true); setError(''); }
    catch (err) { setCopied(false); setError(err.message); }
  }
  return <li className="pending-team-invitation">
    <div className="pending-invitation-person"><strong>{invitation.name || invitation.email}</strong>
      {invitation.name && <span>{invitation.email}</span>}
      <small>{roleName(invitation.role)} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small>
    </div>
    <div className="pending-invitation-actions">
      <Button className="pending-invitation-delete" size="sm" variant="outline" disabled={busy} onClick={onDelete}>Delete</Button>
      <CopyLinkButton component={Button} size="sm" disabled={busy || !link} copied={copied} onClick={copyLink}/>
      <Button size="sm" variant="outline" disabled={busy} onClick={onResend}>Resend</Button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <ManualCopyLink link={manualLink}/>
    <span className="sr-only" role="status">{copied ? 'Invitation link copied.' : ''}</span>
  </li>;
}
