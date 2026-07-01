'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Users, Loader2, CreditCard, Clock, CheckCircle2, AlertCircle, Wallet } from 'lucide-react';
import { fetchApi } from '../../../lib/api';
import { useSocket } from '../../../hooks/useSocket';

export default function GroupPage({ params }) {
  const { token } = use(params);
  const router = useRouter();
  
  const [group, setGroup] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState({}); // slotId -> status
  const [currentUser, setCurrentUser] = useState(null);
  const [payMode, setPayMode] = useState('split');
  const [isPayingAll, setIsPayingAll] = useState(false);

  // We only get the groupId after joining, so we conditionally initialize the socket
  const socket = useSocket({ groupId: group?.groupId });

  useEffect(() => {
    async function joinAndLoad() {
      try {
        const storedUser = localStorage.getItem('nexusUser');
        if (!storedUser) {
          router.push('/login');
          return;
        }
        const user = JSON.parse(storedUser);
        setCurrentUser(user);

        // Join group logic (idempotent on backend)
        const data = await fetchApi(`/groups/join/${token}`, { method: 'POST' });
        setGroup(data);
      } catch (err) {
        setError(err.message || 'Failed to join group');
      } finally {
        setIsLoading(false);
      }
    }
    joinAndLoad();
  }, [token, router]);

  // Handle Socket.io real-time updates for group members paying
  useEffect(() => {
    if (!socket) return;

    socket.on('group_update', (data) => {
      // Refresh group data when someone pays
      fetchApi(`/groups/${group.groupId}`)
        .then(res => setGroup(res))
        .catch(console.error);
    });

    return () => {
      socket.off('group_update');
    };
  }, [socket, group?.groupId]);

  const handlePayAll = async () => {
    setIsPayingAll(true);
    try {
      const idempotencyKey = `payall-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await fetchApi(`/groups/${group.groupId}/pay-all`, {
        method: 'POST',
        body: { idempotencyKey }
      });
      setTimeout(() => { router.push('/tickets'); }, 2000);
    } catch (err) {
      alert(`Payment failed: ${err.message}`);
    } finally {
      setIsPayingAll(false);
    }
  };

  const handlePay = async (slotId) => {
    setPaymentStatus(prev => ({ ...prev, [slotId]: 'processing' }));
    
    try {
      const idempotencyKey = `pay-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await fetchApi(`/groups/${group.groupId}/pay`, {
        method: 'POST',
        body: { slotId, idempotencyKey }
      });
      
      setPaymentStatus(prev => ({ ...prev, [slotId]: 'success' }));
      
      // Navigate to tickets page after short delay
      setTimeout(() => {
        router.push('/tickets');
      }, 2000);
    } catch (err) {
      setPaymentStatus(prev => ({ ...prev, [slotId]: 'error' }));
      alert(`Payment failed: ${err.message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-grow flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="p-8 text-center max-w-md mx-auto mt-12">
        <div className="glass-card p-8 border-destructive/30">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Could not load group</h2>
          <p className="text-muted-foreground mb-6">{error}</p>
          <Link href="/" className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md transition-colors">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Find my seat
  const mySeat = group.members.find(m => m.userId === currentUser?.userId && m.seatLabel);
  const isLeader = currentUser?.userId === group.leaderUserId;
  const unpaidSeatedMembers = group.members.filter(m => m.seatLabel && m.paymentStatus === 'pending');
  const totalAmount = unpaidSeatedMembers.reduce((sum, m) => sum + m.price, 0);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center border border-primary/30">
          <Users className="w-6 h-6 text-primary neon-text" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Group Checkout</h1>
          <p className="text-muted-foreground flex items-center gap-2">
            <Clock className="w-4 h-4" /> 
            Lock expires: {new Date(group.expiresAt).toLocaleTimeString()}
          </p>
        </div>
      </div>

      <div className="glass-card p-6 md:p-8">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 pb-6 border-b border-border gap-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">Group Members <span className="px-3 py-1 bg-secondary text-muted-foreground rounded-full text-xs font-medium border border-border ml-2">{group.members.length} joined</span></h2>
          </div>
          
          {isLeader && (
            <div className="flex bg-secondary/30 p-1 rounded-lg w-full sm:w-auto self-start">
              <button
                onClick={() => setPayMode('split')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all ${payMode === 'split' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Split Payment
              </button>
              <button
                onClick={() => setPayMode('all')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all ${payMode === 'all' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Pay for Everyone
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {group.members.map((member, index) => {
            const isMe = member.userId === currentUser?.userId;
            const isPaid = member.paymentStatus === 'paid';
            const hasSeat = !!member.seatLabel;
            
            return (
              <div key={index} className={`flex items-center justify-between p-4 rounded-lg border transition-all ${isMe ? 'bg-primary/5 border-primary/30' : 'bg-secondary/30 border-border'}`}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center font-bold text-muted-foreground">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold flex items-center gap-2">
                      {member.name} {isMe && <span className="text-xs px-2 py-0.5 bg-primary text-primary-foreground rounded-full">You</span>}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {hasSeat ? (
                        <span className="flex items-center gap-1">Seat: <strong className="text-foreground">{member.seatLabel}</strong></span>
                      ) : (
                        <span className="text-orange-400">Has not selected a seat yet</span>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  {isPaid ? (
                    <div className="flex items-center gap-2 text-green-400 bg-green-500/10 px-4 py-2 rounded-full text-sm font-medium border border-green-500/20">
                      <CheckCircle2 className="w-4 h-4" /> Paid
                    </div>
                  ) : hasSeat && payMode === 'all' ? (
                    <div className="text-sm text-muted-foreground font-medium px-4 py-2 bg-secondary rounded-full border border-border">
                      Pending (Leader Pays)
                    </div>
                  ) : hasSeat && isMe ? (
                    <button
                      onClick={() => handlePay(member.slotId)}
                      disabled={paymentStatus[member.slotId] === 'processing' || paymentStatus[member.slotId] === 'success'}
                      className="flex items-center gap-2 px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full font-medium transition-all shadow-[0_0_15px_rgba(59,130,246,0.3)] disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                      {paymentStatus[member.slotId] === 'processing' ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Processing</>
                      ) : paymentStatus[member.slotId] === 'success' ? (
                        <><CheckCircle2 className="w-4 h-4" /> Success</>
                      ) : (
                        <><CreditCard className="w-4 h-4" /> Pay Now</>
                      )}
                    </button>
                  ) : hasSeat ? (
                    <div className="text-sm text-muted-foreground font-medium px-4 py-2 bg-secondary rounded-full border border-border">
                      Pending
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {!mySeat && (
          <div className="mt-8 p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg flex items-start gap-4">
            <AlertCircle className="w-5 h-5 text-orange-400 mt-0.5" />
            <div>
              <p className="font-medium text-orange-400">You haven't selected a seat yet.</p>
              <p className="text-sm text-muted-foreground mt-1">Please return to the event page to select and lock a seat for yourself within this group.</p>
              <Link href={`/events/${group.eventId}?groupId=${group.groupId}`} className="inline-block mt-3 px-4 py-2 bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium rounded-md transition-colors">
                Go to Event Page
              </Link>
            </div>
          </div>
        )}
        
        {isLeader && payMode === 'all' && unpaidSeatedMembers.length > 0 && (
          <div className="mt-8 p-6 bg-primary/10 border border-primary/30 rounded-xl flex flex-col sm:flex-row justify-between items-center gap-6">
            <div>
              <h3 className="text-xl font-bold">Pay for {unpaidSeatedMembers.length} Seat{unpaidSeatedMembers.length > 1 ? 's' : ''}</h3>
              <p className="text-muted-foreground">Total: ₹{totalAmount}</p>
            </div>
            <button
              onClick={handlePayAll}
              disabled={isPayingAll}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full font-bold text-lg shadow-[0_0_20px_rgba(59,130,246,0.4)] disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isPayingAll ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Processing...</>
              ) : (
                <><Wallet className="w-5 h-5" /> Pay ₹{totalAmount}</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
