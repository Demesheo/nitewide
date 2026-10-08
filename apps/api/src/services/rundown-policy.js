const { access, ownGuestlistReviewAssignments } = require('./business-read-service');

// Reuse My events' real team/venue/event scope, without an internal-admin
// override. An event-specific removal or expired attribution overrides a
// broader organization role, just as on the individual referral action.
const personalRundownScope = `(${access.replace(/:isAdmin\b/g, 'false')}
  AND NOT EXISTS (SELECT 1 FROM event_affiliates removed
    WHERE removed.event_id=e.id AND removed.user_id=:userId
      AND (NOT EXISTS (${ownGuestlistReviewAssignments} AND ea.id=removed.id)
        OR (removed.org_affiliate_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM org_affiliates linked
          WHERE linked.id=removed.org_affiliate_id AND linked.status='active'
            AND (linked.starts_at IS NULL OR linked.starts_at<=:currentTime)
            AND (linked.ends_at IS NULL OR linked.ends_at>=:currentTime))))))`;
const publicRundownEventScope = `e.status='published' AND e.lifecycle_state='active' AND e.is_discoverable=true
  AND e.ends_at>:currentTime
  AND (e.organization_id IS NULL OR EXISTS (SELECT 1 FROM organizations org
    WHERE org.id=e.organization_id AND org.lifecycle_state='active' AND org.status='active'))
  AND (e.location_id IS NULL OR EXISTS (SELECT 1 FROM locations loc WHERE loc.id=e.location_id AND loc.lifecycle_state='active'))
  AND (e.organization_id IS NOT NULL OR EXISTS (SELECT 1 FROM users creator
    WHERE creator.id=e.creator_user_id AND creator.lifecycle_state='active' AND creator.is_active=true AND creator.onboarding_pending=false))`;
module.exports = { personalRundownScope, publicRundownEventScope };
