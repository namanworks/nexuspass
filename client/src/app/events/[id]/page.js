'use client';

import { useState, useEffect, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, MapPin, Users, Loader2, CheckCircle2, Ticket } from 'lucide-react';
import { fetchApi } from '../../../lib/api';
import { useSocket } from '../../../hooks/useSocket';

export default function EventDetailPage({ params }) {
  const { id: eventId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlGroupId = searchParams.get('groupId');
  const socket = useSocket({ eventId });
  
  const [activeGroupId, setActiveGroupId] = useState(urlGroupId);
  const groupId = urlGroupId || activeGroupId;
  
  const [event, setEvent] = useState(null);
  const [slots, setSlots] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bookingError, setBookingError] = useState(null);
  
  // Group booking state
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupInviteUrl, setGroupInviteUrl] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        const data = await fetchApi(`/events/${eventId}`);
        setEvent(data.event);
        setSlots(data.slots);
      } catch (err) {
        setError(err.message || 'Failed to load event details');
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [eventId]);

  // Handle Socket.io real-time updates
  useEffect(() => {
    if (!socket) return;

    socket.on('seat_update', (data) => {
      // data: { seatId, status }
      setSlots(current => 
        current.map(slot => 
          slot.id === data.seatId ? { ...slot, status: data.status } : slot
        )
      );
    });

    return () => {
      socket.off('seat_update');
    };
  }, [socket]);

  const handleSeatClick = async (slot) => {
    if (slot.status !== 'available') return;
    
    // Check if user is logged in
    const user = localStorage.getItem('nexusUser');
    if (!user) {
      router.push('/login');
      return;
    }

    // Optimistic UI update
    setSlots(current => 
      current.map(s => s.id === slot.id ? { ...s, status: 'locked' } : s)
    );
    setBookingError(null);

    try {
      const idempotencyKey = `res-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const data = await fetchApi('/bookings/reserve', {
        method: 'POST',
        body: { slotId: slot.id, groupId: groupId || undefined, idempotencyKey }
      });
      
      // Redirect to the group page where payment happens
      router.push(`/groups/${data.inviteToken}`);
    } catch (err) {
      // Revert optimistic update
      setSlots(current => 
        current.map(s => s.id === slot.id ? { ...s, status: 'available' } : s)
      );
      setBookingError(err.message || 'Failed to reserve seat. It may have just been taken.');
      
      // Hide error after 3s
      setTimeout(() => setBookingError(null), 3000);
    }
  };

  const handleCreateGroup = async () => {
    setIsCreatingGroup(true);
    setBookingError(null);
    try {
      const data = await fetchApi('/groups/create', {
        method: 'POST',
        body: { eventId }
      });
      const fullUrl = `${window.location.origin}${data.inviteLink}`;
      setGroupInviteUrl(fullUrl);
      setActiveGroupId(data.groupId);
    } catch (err) {
      setBookingError(err.message || 'Failed to create group');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-grow flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block bg-destructive/10 text-destructive p-4 rounded-lg">
          {error || 'Event not found'}
        </div>
      </div>
    );
  }

  const availableCount = slots.filter(s => s.status === 'available').length;

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Event Header */}
      <div className="glass-card p-8 mb-10 flex flex-col md:flex-row gap-8 justify-between items-start">
        <div className="flex-grow">
          <span className="px-3 py-1 bg-primary/20 text-primary text-xs font-semibold uppercase tracking-wider rounded-full border border-primary/30 mb-4 inline-block">
            {event.category.name}
          </span>
          <h1 className="text-3xl md:text-5xl font-bold mb-4">{event.title}</h1>
          <div className="flex flex-wrap gap-6 text-muted-foreground">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-primary" />
              <span>{new Date(event.start_time).toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" />
              <span>{event.venue}</span>
            </div>
            <div className="flex items-center gap-2">
              <Ticket className="w-5 h-5 text-primary" />
              <span>{availableCount} tickets left</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 w-full md:w-auto">
          <button 
            onClick={handleCreateGroup}
            disabled={isCreatingGroup}
            className="w-full md:w-auto px-6 py-3 bg-secondary hover:bg-secondary/80 text-foreground font-medium rounded-lg flex items-center justify-center gap-2 transition-colors border border-border whitespace-nowrap"
          >
            {isCreatingGroup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            Create Booking Group
          </button>
          
          <button 
            onClick={() => router.push(`/resale/${eventId}`)}
            className="w-full md:w-auto px-6 py-3 bg-accent/20 hover:bg-accent/30 text-accent font-medium rounded-lg flex items-center justify-center gap-2 transition-colors border border-accent/30 whitespace-nowrap"
          >
            View Resale Marketplace
          </button>
        </div>
      </div>

      {/* Group Invite Modal UI */}
      {groupInviteUrl && (
        <div className="glass p-6 rounded-xl mb-10 border border-primary/40 bg-primary/5">
          <div className="flex items-start gap-4">
            <CheckCircle2 className="w-6 h-6 text-primary flex-shrink-0 mt-1" />
            <div className="flex-grow">
              <h3 className="text-xl font-bold text-foreground mb-2">Group Created!</h3>
              <p className="text-muted-foreground mb-4">Share this link with your friends so they can join and pay for their own seats.</p>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  readOnly 
                  value={groupInviteUrl} 
                  className="flex-grow px-4 py-2 bg-background border border-border rounded-md text-foreground font-mono text-sm"
                />
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(groupInviteUrl);
                    alert('Copied to clipboard!');
                  }}
                  className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md font-medium"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {bookingError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 glass bg-destructive/90 text-destructive-foreground px-6 py-3 rounded-full flex items-center gap-2 shadow-2xl animate-in fade-in slide-in-from-bottom-5">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          {bookingError}
        </div>
      )}

      {/* Seat Grid Area */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Select Your Seats</h2>
          <div className="flex gap-4 text-sm font-medium">
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" /> Available</div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]" /> Locked</div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500/50" /> Sold</div>
          </div>
        </div>

        <div className="glass-card p-8 overflow-x-auto">
          {/* Stage representation */}
          <div className="w-full max-w-2xl mx-auto h-8 bg-gradient-to-b from-primary/30 to-transparent rounded-t-full mb-12 flex items-center justify-center border-t border-primary/50 shadow-[0_0_20px_rgba(59,130,246,0.3)]">
            <span className="text-primary font-bold uppercase tracking-widest text-sm opacity-80">Stage</span>
          </div>

          <div className="grid grid-cols-5 md:grid-cols-10 gap-3 min-w-max pb-4">
            {slots.map(slot => {
              // Determine styles based on status
              let seatStyles = 'bg-green-500/20 text-green-400 border-green-500/50 hover:bg-green-500/40 hover:scale-110 cursor-pointer shadow-[0_0_10px_rgba(34,197,94,0.1)]';
              
              if (slot.status === 'locked') {
                seatStyles = 'bg-orange-500/20 text-orange-400 border-orange-500/50 cursor-not-allowed opacity-80 shadow-[0_0_10px_rgba(249,115,22,0.1)]';
              } else if (slot.status === 'sold') {
                seatStyles = 'bg-red-500/10 text-red-500/50 border-red-500/20 cursor-not-allowed opacity-50';
              }

              return (
                <button
                  key={slot.id}
                  onClick={() => handleSeatClick(slot)}
                  disabled={slot.status !== 'available'}
                  className={`w-12 h-12 rounded-t-lg rounded-b-sm border flex items-center justify-center text-xs font-bold transition-all ${seatStyles}`}
                  title={`${slot.seat_label} - ₹${slot.price}`}
                >
                  {slot.seat_label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
