'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ticket, LogOut, User, Menu, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { fetchApi } from '../lib/api';

export default function Navbar() {
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [user, setUser] = useState(null);

  // Quick check for logged-in user in localStorage (we'll store basic info on login)
  useEffect(() => {
    const storedUser = localStorage.getItem('nexusUser');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const handleLogout = async () => {
    try {
      await fetchApi('/auth/logout', { method: 'POST' });
      localStorage.removeItem('nexusUser');
      setUser(null);
      router.push('/login');
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  return (
    <nav className="sticky top-0 z-50 w-full glass-nav px-6 py-4 flex items-center justify-between">
      <Link href="/" className="flex items-center gap-2 group">
        <div className="bg-primary/20 p-2 rounded-lg group-hover:bg-primary/30 transition-colors">
          <Ticket className="w-6 h-6 text-primary neon-text" />
        </div>
        <span className="font-bold text-xl tracking-tight">NexusPass</span>
      </Link>

      {/* Desktop Nav */}
      <div className="hidden md:flex items-center gap-6">
        {user ? (
          <>
            <Link href="/tickets" className="text-muted-foreground hover:text-foreground transition-colors font-medium">
              My Tickets
            </Link>
            {user.isAdmin && (
              <Link href="/verify" className="text-accent hover:text-accent-foreground transition-colors font-medium">
                Scanner (Admin)
              </Link>
            )}
            <div className="flex items-center gap-4 pl-6 border-l border-border">
              <span className="text-sm text-muted-foreground flex items-center gap-2">
                <User className="w-4 h-4" /> {user.name}
              </span>
              <button 
                onClick={handleLogout}
                className="p-2 rounded-full hover:bg-secondary transition-colors text-muted-foreground hover:text-destructive"
                title="Log out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-muted-foreground hover:text-foreground transition-colors font-medium">
              Log in
            </Link>
            <Link href="/register" className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors shadow-sm">
              Sign up
            </Link>
          </div>
        )}
      </div>

      {/* Mobile Nav Toggle */}
      <button 
        className="md:hidden p-2 text-foreground"
        onClick={() => setIsMenuOpen(!isMenuOpen)}
      >
        {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="absolute top-full left-0 w-full glass-card border-t-0 rounded-t-none p-4 flex flex-col gap-4 md:hidden">
          {user ? (
            <>
              <Link href="/tickets" className="p-2 hover:bg-secondary rounded-md" onClick={() => setIsMenuOpen(false)}>
                My Tickets
              </Link>
              {user.isAdmin && (
                <Link href="/verify" className="p-2 text-accent hover:bg-secondary rounded-md" onClick={() => setIsMenuOpen(false)}>
                  Scanner (Admin)
                </Link>
              )}
              <button 
                onClick={() => { handleLogout(); setIsMenuOpen(false); }}
                className="p-2 text-left text-destructive hover:bg-secondary rounded-md flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" /> Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="p-2 hover:bg-secondary rounded-md" onClick={() => setIsMenuOpen(false)}>
                Log in
              </Link>
              <Link href="/register" className="p-2 bg-primary text-primary-foreground rounded-md text-center" onClick={() => setIsMenuOpen(false)}>
                Sign up
              </Link>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
