import { useCallback } from 'react';
import { BookingMessages } from '../../../shared/BookingMessages';
import { ContactNitewide as SharedContact } from '../../../shared/SupportMessages';
import { api } from '../lib/api';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
const ui = { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription };
export function Messages({ session, request = api, ...props }) {
  const token = session?.accessToken;
  const send = useCallback((path, options) => token ? request(path, { ...options, token }) : Promise.reject(new Error('Sign in to view booking messages.')), [request, token]);
  return <BookingMessages {...props} session={session} side="customer" request={send} ui={ui} polling={false} />;
}
export function ContactNitewide({ session }) {
  const send = useCallback((path, options) => api(path, { ...options, token: session?.accessToken }), [session?.accessToken]);
  return <SharedContact session={session} source="customer" request={send} ui={ui} polling={false} />;
}
