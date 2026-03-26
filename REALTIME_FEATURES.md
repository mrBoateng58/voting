# Live Updates / Realtime Features

## Overview
The voting system now uses **Supabase Realtime** to automatically update pages without requiring manual refresh. Pages detect changes intelligently—**updating only when necessary** while letting you continue your work without interruption.

## What Updates Automatically

### Student Dashboard (`student/dashboard.html`)
- **Election Status**: Reflects changes when election closes (e.g., active → inactive)
- **Vote Confirmation**: Quick update when their vote is submitted, with a subtle success toast
- No jarring full-page refreshes while browsing

**Update Triggers:**
- Their vote is confirmed in database
- Election status changes (e.g., election closes)

### Admin Results Page (`admin/results.html`)
- **Vote Counts & Charts**: Update quietly in the background
- **New Votes Notification**: Toast shows "X new votes received"
- **Smart Batching**: Multiple rapid votes bundle into one refresh (after 2 seconds) instead of constant janky updates  
- **No Full Page Refresh**: You stay on the page doing your work while charts update silently

**Update Triggers:**
- Any vote inserted
- When you switch elections

## Technical Implementation

### Smart Batching for Results
Instead of refreshing immediately when each vote arrives:
1. Toast appears: "1 new vote received"
2. If more votes come in the next 2 seconds, counter updates: "3 new votes received"
3. After 2 seconds of quiet time, results refresh once
4. This prevents constant page jitter and keeps your workflow smooth

### Core Module: `js/realtime.js`
Reusable Supabase Realtime subscription manager:
- `subscribeToStudentVotes(studentId, callback)` — Detect votes for a specific student
- `subscribeToStudentStatus(studentId, callback)` — Detect student record updates
- `subscribeToElectionVotes(electionId, callback)` — Detect all votes in an election
- `subscribeToElectionStatus(electionId, callback)` — Detect election status changes
- `subscribeToElectionCandidates(electionId, callback)` — Detect candidate changes
- `unsubscribe(key)` — Stop listening to specific channel
- `unsubscribeAll()` — Stop all subscriptions

### Integration

**Student Dashboard** (`js/student.js`):
```javascript
// Vote confirmation: quick targeted update
RealtimeManager.subscribeToStudentVotes(student.id, async () => {
    const updatedState = await initializeVotingContext(student);
    renderDashboardStatus(updatedState);
    // Shows subtle toast on confirmation
});

// Election close: immediate awareness
RealtimeManager.subscribeToElectionStatus(activeElectionId, async (updated) => {
    if (updated.status !== 'active') {
        // Update immediately - important event
    }
});
```

**Admin Results** (`js/admin.js`):
```javascript
// Batches votes over 2 seconds to prevent constant jitter
let pendingVoteCount = 0;
let refreshTimeout = null;

RealtimeManager.subscribeToElectionVotes(selectedElectionId, () => {
    pendingVoteCount++;
    showToast(`${pendingVoteCount} new vote(s) received...`, 'info');
    // Waits 2 seconds, then refreshes once (batching)
    scheduleRefresh();
});
```

## Browser Console
You'll see subscription confirmation messages:
- ✓ `Realtime votes subscription active`
- ✓ `Realtime election status subscription active`
- And when data changes: ✓ `Refreshing results (3 new votes)`

## User Experience

### Before (Annoying)
- Vote comes in → Page completely re-renders → Charts disappear and rebuild → You lose focus

### After (Smooth)
- Vote comes in → Toast: "New vote received" → Charts quietly update in background → Your view stays stable

## Supabase Requirements
- Realtime must be enabled in Supabase project settings
- Tables must have RLS (Row Level Security) appropriate for the data type
- Subscriptions automatically clean up when leaving the page

## Performance Notes
- Subscriptions are lightweight and efficient
- Only relevant data changes trigger callbacks (filtered at DB level)
- Batching prevents excessive re-renders
- Subscriptions auto-unsubscribe on page exit
- Multiple users can monitor results simultaneously without performance issues

## Future Enhancements
- Incremental chart updates (add vote bar without full redraw)
- Admin dashboard live metrics (total votes, participation % - similar smart batching)
- Candidate list sync across admin tabs
- Mobile-optimized subscription for better battery life

