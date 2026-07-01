'use client';

import { useState, useEffect } from 'react';
import QRCode from 'react-qr-code';
import { generateSync } from 'otplib';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { fetchApi } from '../lib/api';

// By default otplib authenticator uses 30s step. Our backend verifies with default.
// The specs say "QR generation ... setInterval for 15000ms to regenerate token and re-render QR".
// We will generate the token and refresh the QR every 15s to be safe.

export default function QRDisplay({ ticketId }) {
  const [seed, setSeed] = useState(null);
  const [token, setToken] = useState(null);
  const [error, setError] = useState(null);
  const [countdown, setCountdown] = useState(15);

  useEffect(() => {
    let intervalId;
    let countdownId;

    async function fetchSeedAndStart() {
      try {
        const data = await fetchApi(`/tickets/${ticketId}/seed`);
        const fetchedSeed = data.seed;
        setSeed(fetchedSeed);
        
        // Initial generation
        setToken(generateSync({ secret: fetchedSeed }));
        
        // Refresh token every 15 seconds
        intervalId = setInterval(() => {
          setToken(generateSync({ secret: fetchedSeed }));
          setCountdown(15);
        }, 15000);

        // Countdown timer for UI
        countdownId = setInterval(() => {
          setCountdown(c => (c > 0 ? c - 1 : 15));
        }, 1000);

      } catch (err) {
        setError(err.message || 'Could not load secure QR seed');
      }
    }

    fetchSeedAndStart();

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (countdownId) clearInterval(countdownId);
    };
  }, [ticketId]);

  if (error) {
    return (
      <div className="bg-destructive/10 p-4 rounded-xl border border-destructive/20 text-center flex flex-col items-center">
        <AlertCircle className="w-8 h-8 text-destructive mb-2" />
        <p className="text-destructive font-medium">{error}</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="bg-secondary p-12 rounded-xl flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground font-medium">Generating Secure Ticket...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="bg-white p-4 rounded-xl shadow-[0_0_30px_rgba(59,130,246,0.3)] mb-6 transition-all">
        <QRCode 
          value={token} 
          size={256}
          level="H"
          bgColor="#ffffff"
          fgColor="#000000"
        />
      </div>
      
      <div className="flex items-center gap-3 bg-secondary/80 px-4 py-2 rounded-full border border-border">
        <RefreshCw className={`w-4 h-4 text-primary ${countdown === 15 ? 'animate-spin' : ''}`} />
        <span className="text-sm font-medium text-foreground tracking-wide">
          QR refreshes in <span className="text-primary w-4 inline-block text-center">{countdown}</span>s
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-4 max-w-xs text-center">
        This is a cryptographic rotating QR code. Screenshots will not work for entry.
      </p>
    </div>
  );
}
