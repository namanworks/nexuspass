"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ScanLine,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
} from "lucide-react";
import { fetchApi } from "../../lib/api";

export default function VerifyPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const [ticketId, setTicketId] = useState("");
  const [token, setToken] = useState("");

  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("nexusUser");
    if (!storedUser) {
      router.push("/login");
    } else {
      const user = JSON.parse(storedUser);
      if (!user.isAdmin) {
        router.push("/");
      } else {
        setIsAdmin(true);
      }
    }
    setIsLoadingAuth(false);
  }, [router]);

  const handleVerify = async (e) => {
    e.preventDefault();
    setIsVerifying(true);
    setResult(null);

    try {
      const data = await fetchApi("/verify", {
        method: "POST",
        body: { ticketId, token },
      });

      setResult({
        success: true,
        message:
          "Ticket successfully verified and marked as used. Entry granted.",
        data: data,
      });

      setTicketId("");
      setToken("");
    } catch (err) {
      setResult({
        success: false,
        message: err.message || "Verification failed. Invalid or expired QR.",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  if (isLoadingAuth)
    return (
      <div className="p-8 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto" />
      </div>
    );
  if (!isAdmin) return null;

  return (
    <div className="flex-grow flex items-center justify-center p-4 py-12">
      <div className="glass-card w-full max-w-lg p-8 relative overflow-hidden border-t-4 border-t-primary">
        <div className="absolute top-0 right-0 p-4">
          <div className="flex items-center gap-2 bg-primary/20 text-primary px-3 py-1 rounded-full text-xs font-bold tracking-wider">
            <ShieldAlert className="w-4 h-4" /> ADMIN MODE
          </div>
        </div>

        <div className="flex flex-col items-center mb-8 pt-4">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4 border border-primary/30 shadow-[0_0_20px_rgba(59,130,246,0.2)]">
            <ScanLine className="w-8 h-8 text-primary neon-text" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Venue Scanner</h1>
          <p className="text-muted-foreground mt-2 text-center">
            Scan or manually enter TOTP tokens for entry validation.
          </p>
        </div>

        {result && (
          <div
            className={`p-6 rounded-xl mb-8 border transition-all ${
              result.success
                ? "bg-green-500/10 border-green-500/40 shadow-[0_0_20px_rgba(34,197,94,0.2)]"
                : "bg-destructive/10 border-destructive/40 shadow-[0_0_20px_rgba(239,68,68,0.2)]"
            }`}
          >
            <div className="flex items-start gap-4">
              {result.success ? (
                <CheckCircle2 className="w-8 h-8 text-green-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-8 h-8 text-destructive flex-shrink-0" />
              )}
              <div>
                <h3
                  className={`text-lg font-bold mb-1 ${result.success ? "text-green-400" : "text-destructive"}`}
                >
                  {result.success ? "Access Granted" : "Access Denied"}
                </h3>
                <p className="text-foreground/90 font-medium mb-2">
                  {result.message}
                </p>

                {result.success && result.data && (
                  <div className="mt-4 pt-4 border-t border-green-500/20 text-sm">
                    <p>
                      <span className="text-muted-foreground">Event:</span>{" "}
                      <strong className="text-foreground">
                        {result.data.event.title}
                      </strong>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Seat:</span>{" "}
                      <strong className="text-foreground">
                        {result.data.seat.seatLabel}
                      </strong>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleVerify} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">
              Ticket ID (UUID)
            </label>
            <input
              type="text"
              required
              className="px-4 py-3 bg-secondary/80 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-mono text-sm"
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">
              6-Digit TOTP Token
            </label>
            <input
              type="text"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              className="px-4 py-3 bg-secondary/80 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-mono text-2xl tracking-[0.5em] text-center"
              placeholder="000000"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={isVerifying || ticketId.length < 10 || token.length !== 6}
            className="mt-4 w-full py-4 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-lg rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isVerifying ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <>
                <ScanLine className="w-6 h-6" /> Verify Ticket
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
