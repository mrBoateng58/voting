// Realtime subscription manager for live updates
// Handles Supabase Realtime subscriptions for votes, students, elections, and results

import { supabase } from "../supabase-config.js";

export const RealtimeManager = {
    subscriptions: new Map(),

    /**
     * Subscribe to votes table changes for a specific student
     * Calls callback when student's vote status changes
     */
    subscribeToStudentVotes(studentId, onVoteInserted) {
        const key = `student-votes-${studentId}`;
        if (this.subscriptions.has(key)) {
            return; // Already subscribed
        }

        const subscription = supabase
            .channel(`student-votes-${studentId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'votes',
                    filter: `student_id=eq.${studentId}`
                },
                (payload) => {
                    if (onVoteInserted) {
                        onVoteInserted(payload.new);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('✓ Realtime votes subscription active');
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    this.subscriptions.delete(key);
                }
            });

        this.subscriptions.set(key, subscription);
        return subscription;
    },

    /**
     * Subscribe to students table changes for a specific student
     * Calls callback when student record is updated (e.g., has_voted)
     */
    subscribeToStudentStatus(studentId, onStudentUpdated) {
        const key = `student-status-${studentId}`;
        if (this.subscriptions.has(key)) {
            return; // Already subscribed
        }

        const subscription = supabase
            .channel(`student-status-${studentId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'students',
                    filter: `id=eq.${studentId}`
                },
                (payload) => {
                    if (onStudentUpdated) {
                        onStudentUpdated(payload.new);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('✓ Realtime student status subscription active');
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    this.subscriptions.delete(key);
                }
            });

        this.subscriptions.set(key, subscription);
        return subscription;
    },

    /**
     * Subscribe to all votes in an election for live result updates
     * Calls callback when any vote is inserted, updated, or deleted
     */
    subscribeToElectionVotes(electionId, onVoteChange) {
        const key = `election-votes-${electionId}`;
        if (this.subscriptions.has(key)) {
            return; // Already subscribed
        }

        const subscription = supabase
            .channel(`election-votes-${electionId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'votes',
                    filter: `election_id=eq.${electionId}`
                },
                (payload) => {
                    if (onVoteChange) {
                        onVoteChange(payload);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('✓ Realtime election votes subscription active');
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    this.subscriptions.delete(key);
                }
            });

        this.subscriptions.set(key, subscription);
        return subscription;
    },

    /**
     * Subscribe to elections table for live status changes
     * Calls callback when election status changes (e.g., active -> inactive)
     */
    subscribeToElectionStatus(electionId, onElectionUpdated) {
        const key = `election-status-${electionId}`;
        if (this.subscriptions.has(key)) {
            return; // Already subscribed
        }

        const subscription = supabase
            .channel(`election-status-${electionId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'elections',
                    filter: `id=eq.${electionId}`
                },
                (payload) => {
                    if (onElectionUpdated) {
                        onElectionUpdated(payload.new);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('✓ Realtime election status subscription active');
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    this.subscriptions.delete(key);
                }
            });

        this.subscriptions.set(key, subscription);
        return subscription;
    },

    /**
     * Subscribe to candidates for an election
     * Calls callback when candidates are added/updated/deleted
     */
    subscribeToElectionCandidates(electionId, onCandidateChange) {
        const key = `election-candidates-${electionId}`;
        if (this.subscriptions.has(key)) {
            return; // Already subscribed
        }

        const subscription = supabase
            .channel(`election-candidates-${electionId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'election_candidates',
                    filter: `election_id=eq.${electionId}`
                },
                (payload) => {
                    if (onCandidateChange) {
                        onCandidateChange(payload);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('✓ Realtime candidates subscription active');
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    this.subscriptions.delete(key);
                }
            });

        this.subscriptions.set(key, subscription);
        return subscription;
    },

    /**
     * Unsubscribe from a specific channel
     */
    unsubscribe(key) {
        const subscription = this.subscriptions.get(key);
        if (subscription) {
            supabase.removeChannel(subscription);
            this.subscriptions.delete(key);
        }
    },

    /**
     * Unsubscribe from all channels
     */
    unsubscribeAll() {
        this.subscriptions.forEach((subscription) => {
            supabase.removeChannel(subscription);
        });
        this.subscriptions.clear();
    }
};

export default RealtimeManager;
