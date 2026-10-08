import { useCallback } from 'react';
import { SupportMessages } from '../../../shared/SupportMessages';
import { api } from '../lib/api';
import PageHeader from './PageHeader';
import { Button } from './ui/button';
import '../../../shared/booking-messages.css';

const ui = { Button };

export default function Messages({ session, params, onUpdate, onOpenCase, onUnreadChange, refreshKey = 0 }) {
  const request = useCallback((path, { body, ...options } = {}) => api(path, {
    ...options, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), []);
  return <section className="admin-messages-workspace">
    <PageHeader title="Messages" description="Private customer and business conversations with Nitewide support." />
    <div className="panel management-panel">
      <SupportMessages session={session} admin request={request} ui={ui} refreshKey={refreshKey}
        initialThreadId={params.get('thread') || undefined}
        onOpened={() => onUpdate({ thread: null }, true)}
        onOpenCase={onOpenCase} onUnreadChange={onUnreadChange} />
    </div>
  </section>;
}
