"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ticket,
  CalendarDays,
  MapPin,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { fetchApi } from "../../lib/api";

export default function TicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadTickets() {
      try {
        const storedUser = localStorage.getItem("nexusUser");
        if (!storedUser) {
          router.push("/login");
          return;
        }

        const data = await fetchApi("/tickets");
        setTickets(data.tickets);
      } catch (err) {
        setError(err.message || "Failed to load tickets");
      } finally {
        setIsLoading(false);
      }
    }
    loadTickets();
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex-grow flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center max-w-md mx-auto mt-12">
        <div className="glass-card p-8 border-destructive/30">
          <h2 className="text-xl font-bold mb-2">Error</h2>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="flex items-center gap-4 mb-10">
        <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center shadow-sm">
          <Ticket className="w-6 h-6 text-primary neon-text" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">My Tickets</h1>
          <p className="text-muted-foreground">
            Manage your event passes and resale listings
          </p>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="glass-card p-12 text-center rounded-2xl flex flex-col items-center">
          <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center mb-6">
            <Ticket className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-2">No tickets yet</h2>
          <p className="text-muted-foreground max-w-md mx-auto mb-8">
            You don't have any tickets in your wallet. Explore upcoming events
            and secure your spot!
          </p>
          <Link
            href="/"
            className="px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-all shadow-sm"
          >
            Explore Events
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {tickets.map((ticket) => {
            let statusConfig = {
              color: "text-green-400",
              bg: "bg-green-500/10 border-green-500/30",
              label: "Valid",
            };

            if (ticket.status === "used") {
              statusConfig = {
                color: "text-muted-foreground",
                bg: "bg-secondary border-border",
                label: "Used",
              };
            } else if (ticket.status === "listed") {
              statusConfig = {
                color: "text-orange-400",
                bg: "bg-orange-500/10 border-orange-500/30",
                label: "Listed for resale",
              };
            }

            return (
              <Link
                href={`/tickets/${ticket.id}`}
                key={ticket.id}
                className="group"
              >
                <div
                  className="glass-card p-6 h-full flex flex-col transition-all duration-300 hover:scale-[1.02] hover:shadow-md border-l-4"
                  style={{
                    borderLeftColor: statusConfig.color.replace("text-", ""),
                  }}
                >
                  <div className="flex justify-between items-start mb-4">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border ${statusConfig.bg} ${statusConfig.color}`}
                    >
                      {statusConfig.label}
                    </span>
                    <span className="font-mono font-bold text-foreground bg-secondary px-3 py-1 rounded-md border border-border">
                      Seat {ticket.seat.seatLabel}
                    </span>
                  </div>

                  <h2 className="text-2xl font-bold mb-4 line-clamp-1">
                    {ticket.event.title}
                  </h2>

                  <div className="flex-grow flex flex-col gap-2 text-sm text-muted-foreground mb-6">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="w-4 h-4" />
                      <span>
                        {new Date(ticket.event.start_time).toLocaleString(
                          undefined,
                          {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      <span>{ticket.event.venue}</span>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between text-sm font-medium pt-4 border-t border-border group-hover:text-primary transition-colors">
                    <span>View Ticket Details</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
