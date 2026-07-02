"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CalendarDays, MapPin, Loader2, ArrowRight } from "lucide-react";
import { fetchApi } from "../lib/api";

export default function Home() {
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("All");

  useEffect(() => {
    async function loadEvents() {
      try {
        const data = await fetchApi("/events");
        setEvents(data.events);
      } catch (err) {
        setError(err.message || "Failed to load events");
      } finally {
        setIsLoading(false);
      }
    }
    loadEvents();
  }, []);

  const categories = [
    "All",
    ...new Set(events.map((e) => e.category.name)),
  ].filter(Boolean);
  const filteredEvents =
    activeTab === "All"
      ? events
      : events.filter((e) => e.category.name === activeTab);

  if (isLoading) {
    return (
      <div className="flex-grow flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block bg-destructive/10 text-destructive p-4 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-7xl">
      <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Discover <span className="text-primary neon-text">Events</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Secure your spot at the best concerts, movies, and comedy shows.
            Regulated resale guarantees fair pricing.
          </p>
        </div>

        {}
        <div className="flex bg-secondary/50 p-1 rounded-lg border border-border overflow-x-auto w-full md:w-auto">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveTab(category)}
              className={`px-6 py-2 rounded-md font-medium text-sm transition-all whitespace-nowrap ${
                activeTab === category
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredEvents.map((event) => (
          <Link
            href={`/events/${event.id}`}
            key={event.id}
            className="group h-full"
          >
            <div className="glass-card h-full flex flex-col p-6 transition-all duration-300 hover:scale-[1.02] hover:shadow-md border-t border-t-border">
              {}
              <div className="flex justify-between items-start mb-6">
                <span className="px-3 py-1 bg-primary/20 text-primary text-xs font-semibold uppercase tracking-wider rounded-full border border-primary/30">
                  {event.category.name}
                </span>
                <div className="text-right">
                  <span className="text-xs text-muted-foreground uppercase">
                    Starting from
                  </span>
                  <div className="text-lg font-bold text-accent">
                    ₹{event.price_range.min}
                  </div>
                </div>
              </div>

              <h2 className="text-2xl font-bold mb-4 line-clamp-2 group-hover:text-primary transition-colors">
                {event.title}
              </h2>

              <div className="flex-grow flex flex-col gap-3 text-muted-foreground text-sm mb-8">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-primary/70" />
                  <span>
                    {new Date(event.start_time).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-primary/70" />
                  <span>{event.venue}</span>
                </div>
              </div>

              <div className="mt-auto flex items-center justify-between text-sm font-medium text-foreground pt-4 border-t border-border">
                <span>View Seats</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </Link>
        ))}

        {filteredEvents.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground glass-card rounded-xl">
            No events found in this category.
          </div>
        )}
      </div>
    </div>
  );
}
