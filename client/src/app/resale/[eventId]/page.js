"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  RefreshCcw,
  Loader2,
  Clock,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { fetchApi } from "../../../lib/api";

export default function ResaleMarketplacePage({ params }) {
  const { eventId } = use(params);
  const router = useRouter();

  const [event, setEvent] = useState(null);
  const [listings, setListings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [buyingId, setBuyingId] = useState(null);
  const [buyError, setBuyError] = useState(null);
  const [buySuccess, setBuySuccess] = useState(false);

  useEffect(() => {
    async function loadMarketplace() {
      try {
        const [eventData, resaleData] = await Promise.all([
          fetchApi(`/events/${eventId}`),
          fetchApi(`/resale/${eventId}`),
        ]);

        setEvent(eventData.event);
        setListings(resaleData.listings);
      } catch (err) {
        setError(err.message || "Failed to load marketplace");
      } finally {
        setIsLoading(false);
      }
    }
    loadMarketplace();
  }, [eventId]);

  const handleBuy = async (listing) => {
    const user = localStorage.getItem("nexusUser");
    if (!user) {
      router.push("/login");
      return;
    }

    setBuyingId(listing.id);
    setBuyError(null);

    try {
      const idempotencyKey = `buy-${Date.now()}`;
      await fetchApi(`/resale/buy/${listing.id}`, {
        method: "POST",
        body: { idempotencyKey },
      });

      setBuySuccess(true);

      setTimeout(() => {
        router.push("/tickets");
      }, 2000);
    } catch (err) {
      setBuyError(err.message || "Failed to purchase ticket");
    } finally {
      setBuyingId(null);
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
      <div className="p-8 text-center max-w-md mx-auto mt-12">
        <div className="glass-card p-8 border-destructive/30">
          <h2 className="text-xl font-bold mb-2">Error</h2>
          <p className="text-muted-foreground mb-6">{error}</p>
          <Link
            href="/"
            className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl relative">
      <Link
        href={`/events/${eventId}`}
        className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors mb-6 font-medium"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Event
      </Link>

      <div className="flex items-center gap-4 mb-10">
        <div className="w-12 h-12 bg-accent/20 rounded-xl flex items-center justify-center shadow-sm">
          <RefreshCcw className="w-6 h-6 text-accent neon-text" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Resale Marketplace</h1>
          <p className="text-muted-foreground">
            Secure, verified tickets for {event.title}
          </p>
        </div>
      </div>

      {buySuccess && (
        <div className="mb-8 p-4 bg-primary/10 border border-primary/30 rounded-lg flex items-center justify-center gap-3 animate-in fade-in slide-in-from-top-4">
          <CheckCircle2 className="w-6 h-6 text-primary" />
          <span className="font-bold text-lg text-primary">
            Purchase Successful! A new secure QR code has been generated.
            Redirecting to your wallet...
          </span>
        </div>
      )}

      {buyError && (
        <div className="mb-8 p-4 bg-destructive/10 border border-destructive/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
          <span className="font-medium text-destructive">{buyError}</span>
        </div>
      )}

      {listings.length === 0 ? (
        <div className="glass-card p-12 text-center rounded-2xl flex flex-col items-center">
          <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center mb-6">
            <RefreshCcw className="w-8 h-8 text-muted-foreground opacity-50" />
          </div>
          <h2 className="text-2xl font-bold mb-2">No tickets listed yet</h2>
          <p className="text-muted-foreground max-w-md mx-auto mb-8">
            There are currently no tickets available for resale for this event.
            Check back later!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((listing) => {
            const timeRemaining = new Date(listing.closes_at) - new Date();
            const hoursLeft = Math.max(
              0,
              Math.floor(timeRemaining / (1000 * 60 * 60)),
            );
            const minsLeft = Math.max(
              0,
              Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60)),
            );

            return (
              <div
                key={listing.id}
                className="glass-card p-6 flex flex-col border-t border-t-border hover:shadow-md transition-shadow"
              >
                <div className="flex justify-between items-start mb-6">
                  <span className="font-mono font-bold text-foreground bg-secondary px-3 py-1 rounded-md border border-border">
                    Seat {listing.seat_label}
                  </span>

                  <div className="flex items-center gap-1 text-xs font-medium text-orange-400 bg-orange-500/10 px-2 py-1 rounded border border-orange-500/20">
                    <Clock className="w-3 h-3" />
                    {hoursLeft > 0 ? `${hoursLeft}h ` : ""}
                    {minsLeft}m left
                  </div>
                </div>

                <div className="flex-grow flex flex-col justify-center items-center py-4">
                  <span className="text-sm text-muted-foreground uppercase tracking-widest mb-1">
                    Buy Now
                  </span>
                  <div className="text-4xl font-black text-accent">
                    ₹{parseFloat(listing.list_price)}
                  </div>
                </div>

                <button
                  onClick={() => handleBuy(listing)}
                  disabled={buyingId !== null || buySuccess}
                  className="mt-6 w-full py-3 bg-accent hover:bg-accent/90 text-accent-foreground font-bold rounded-lg transition-all shadow-sm flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {buyingId === listing.id ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Purchase Ticket"
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
