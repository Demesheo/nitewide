import { useCallback } from 'react';
import { BookingMessages } from '../../../shared/BookingMessages';
import { ContactNitewide as SharedContact } from '../../../shared/SupportMessages';
import { api } from '../lib/api';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
const ui = { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription };
export function Messages({ session, request = api, ...props }) {
  const token = session?.accessToken;
  const send = useCallback((path, { body, ...options } = {}) => token ? request(path, session, { ...options, ...(body ? { body: JSON.stringify(body) } : {}) }) : Promise.reject(new Error('Sign in to view booking messages.')), [request, token]);
  return <BookingMessages {...props} session={session} side="business" request={send} ui={ui} />;
}
export function ContactNitewide({ session }) {
  const send = useCallback((path, { body, ...options } = {}) => api(path, session, { ...options, ...(body ? { body: JSON.stringify(body) } : {}) }), [session?.accessToken]);
  return <SharedContact session={session} source="business" request={send} ui={ui} />;
}
