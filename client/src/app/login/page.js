'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogIn, Loader2 } from 'lucide-react';
import { fetchApi } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const data = await fetchApi('/auth/login', {
        method: 'POST',
        body: { email, password },
      });

      // Save user to local storage for quick access in UI (token is httpOnly)
      localStorage.setItem('nexusUser', JSON.stringify(data));
      
      // Dispatch storage event to update Navbar immediately
      window.dispatchEvent(new Event('storage'));
      
      router.push('/');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-grow flex items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8 relative overflow-hidden">

        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center mb-4">
            <LogIn className="w-6 h-6 text-primary neon-text" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome Back</h1>
          <p className="text-muted-foreground mt-2 text-center">Log in to manage your tickets and events</p>
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive-foreground p-3 rounded-lg text-sm mb-6 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Email</label>
            <input
              type="email"
              required
              className="px-4 py-3 bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all text-foreground"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Password</label>
            <input
              type="password"
              required
              className="px-4 py-3 bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all text-foreground"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="mt-2 w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg transition-all shadow-sm flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Sign In'}
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Don't have an account?{' '}
          <Link href="/register" className="text-primary hover:text-primary/80 font-medium transition-colors">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
