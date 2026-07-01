'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { Ticket as TicketIcon, CalendarDays, MapPin, Loader2, ArrowLeft, RefreshCcw, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { fetchApi } from '../../../lib/api';
import QRDisplay from '../../../components/QRDisplay';

export default function TicketDetailPage({ params }) {
  const { id: ticketId } = use(params);
  const router = useRouter();
  const [ticket, setTicket] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Relist Modal State
  const [showRelistModal, setShowRelistModal] = useState(false);
  const [listPrice, setListPrice] = useState('');
  const [relistError, setRelistError] = useState(null);
  const [isRelisting, setIsRelisting] = useState(false);

  useEffect(() => {
    async function loadTicket() {
      try {
        const data = await fetchApi(`/tickets/${ticketId}`);
        setTicket(data);
        setListPrice(data.purchased_price.toString()); // default to purchased price
      } catch (err) {
        setError(err.message || 'Failed to load ticket details');
      } finally {
        setIsLoading(false);
      }
    }
    loadTicket();
  }, [ticketId]);

  const handleRelist = async (e) => {
    e.preventDefault();
    setRelistError(null);
    setIsRelisting(true);

    const parsedPrice = parseFloat(listPrice);
    if (parsedPrice > ticket.purchased_price) {
      setRelistError(`Price cannot exceed your purchased price of ₹${ticket.purchased_price}`);
      setIsRelisting(false);
      return;
    }

    try {
      const idempotencyKey = `list-${Date.now()}`;
      await fetchApi('/resale/list', {
        method: 'POST',
        body: { ticketId, listPrice: parsedPrice, idempotencyKey }
      });
      
      // Update local state to reflect it is listed
      setTicket(prev => ({ ...prev, status: 'listed', relist_used: true }));
      setShowRelistModal(false);
    } catch (err) {
      setRelistError(err.message || 'Failed to list ticket for resale');
    } finally {
      setIsRelisting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-grow flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="p-8 text-center max-w-md mx-auto mt-12">
        <div className="glass-card p-8 border-destructive/30">
          <h2 className="text-xl font-bold mb-2">Error</h2>
          <p className="text-muted-foreground mb-6">{error}</p>
          <Link href="/tickets" className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md transition-colors">
            Back to Wallet
          </Link>
        </div>
      </div>
    );
  }

  const canRelist = ticket.status === 'valid' && !ticket.relist_used;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl relative">
      <Link href="/tickets" className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors mb-6 font-medium">
        <ArrowLeft className="w-4 h-4" /> Back to Tickets
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Ticket Details Panel */}
        <div className="glass-card p-8 flex flex-col h-full border-t border-t-border relative overflow-hidden">
          {ticket.status === 'used' && (
            <div className="absolute top-0 right-0 w-32 h-32 bg-secondary/50 rounded-bl-full flex items-start justify-end p-6 pointer-events-none">
              <span className="font-bold text-muted-foreground rotate-45 transform origin-top-left -ml-10 mt-2">USED</span>
            </div>
          )}

          <div className="mb-8">
            <span className="px-3 py-1 bg-secondary text-foreground text-xs font-semibold uppercase tracking-wider rounded-md border border-border mb-4 inline-block">
              Seat {ticket.seat.seatLabel}
            </span>
            <h1 className="text-3xl font-bold mb-4 text-foreground">{ticket.event.title}</h1>
            <div className="flex flex-col gap-3 text-muted-foreground">
              <div className="flex items-center gap-3">
                <CalendarDays className="w-5 h-5 text-primary/70" />
                <span className="text-lg">{new Date(ticket.event.start_time).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-primary/70" />
                <span className="text-lg">{ticket.event.venue}</span>
              </div>
            </div>
          </div>

          <div className="mt-auto pt-6 border-t border-border">
            <div className="flex justify-between items-center text-sm mb-6">
              <span className="text-muted-foreground">Purchased for</span>
              <span className="font-bold text-lg text-foreground">₹{ticket.purchased_price}</span>
            </div>

            {canRelist && (
              <button 
                onClick={() => setShowRelistModal(true)}
                className="w-full py-3 bg-secondary hover:bg-secondary/80 border border-primary/30 text-primary font-medium rounded-lg flex items-center justify-center gap-2 transition-all"
              >
                <RefreshCcw className="w-4 h-4" /> Relist this ticket
              </button>
            )}
            
            {!canRelist && ticket.status === 'valid' && (
              <p className="text-sm text-center text-muted-foreground bg-secondary/30 p-3 rounded-lg border border-border">
                This ticket has already been listed once and cannot be relisted again.
              </p>
            )}
          </div>
        </div>

        {/* QR / Status Panel */}
        <div className="glass-card p-8 flex flex-col items-center justify-center border-t border-t-border min-h-[400px]">
          {ticket.status === 'valid' ? (
            <QRDisplay ticketId={ticket.id} />
          ) : ticket.status === 'listed' ? (
            <div className="text-center">
              <div className="w-20 h-20 bg-orange-500/20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                <RefreshCcw className="w-10 h-10 text-orange-400" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Listed for Resale</h2>
              <p className="text-muted-foreground">
                Your ticket is currently listed on the marketplace.
              </p>
              <div className="mt-6 p-4 bg-secondary/50 rounded-lg border border-border">
                <p className="text-sm">The QR code is securely hidden while the ticket is listed to prevent fraud.</p>
              </div>
            </div>
          ) : (
            <div className="text-center opacity-70">
              <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-10 h-10 text-muted-foreground" />
              </div>
              <h2 className="text-2xl font-bold mb-2 text-muted-foreground">Ticket Used</h2>
              <p className="text-sm">This ticket has already been scanned for entry.</p>
            </div>
          )}
        </div>
      </div>

      {/* Relist Modal */}
      {showRelistModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md p-6 border border-primary/30 relative">
            <h2 className="text-2xl font-bold mb-2">Relist Ticket</h2>
            <p className="text-muted-foreground mb-6 text-sm">
              List your ticket on the secure resale marketplace. A non-refundable ₹30 relist fee applies. You can only relist a ticket once.
            </p>

            {relistError && (
              <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md mb-4 border border-destructive/20">
                {relistError}
              </div>
            )}

            <form onSubmit={handleRelist} className="flex flex-col gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Listing Price (₹)</label>
                <input 
                  type="number"
                  required
                  min="0"
                  max={ticket.purchased_price}
                  step="0.01"
                  value={listPrice}
                  onChange={e => setListPrice(e.target.value)}
                  className="w-full px-4 py-2 bg-secondary/50 border border-border rounded-lg focus:outline-none focus:border-primary text-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">Maximum allowed: ₹{ticket.purchased_price}</p>
              </div>

              <div className="flex justify-between items-center p-4 bg-secondary/30 rounded-lg border border-border mt-2">
                <span className="font-medium text-sm">Relisting Fine</span>
                <span className="font-bold text-accent">₹30.00</span>
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setShowRelistModal(false)}
                  disabled={isRelisting}
                  className="flex-1 py-2 bg-secondary hover:bg-secondary/80 rounded-lg transition-colors font-medium text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRelisting}
                  className="flex-1 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors font-medium flex items-center justify-center"
                >
                  {isRelisting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Pay & Relist'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
