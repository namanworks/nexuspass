"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserPlus, Loader2 } from "lucide-react";
import { fetchApi } from "../../lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await fetchApi("/auth/register", {
        method: "POST",
        body: { name, email, password },
      });

      router.push("/login");
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-grow flex items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8 relative overflow-hidden">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-accent/20 rounded-full flex items-center justify-center mb-4">
            <UserPlus className="w-6 h-6 text-accent neon-text" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Create Account</h1>
          <p className="text-muted-foreground mt-2 text-center">
            Join NexusPass to secure your tickets
          </p>
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive-foreground p-3 rounded-lg text-sm mb-6 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">
              Full Name
            </label>
            <input
              type="text"
              required
              className="px-4 py-3 bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-foreground"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Email</label>
            <input
              type="email"
              required
              className="px-4 py-3 bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-foreground"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              className="px-4 py-3 bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-foreground"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="mt-2 w-full py-3 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold rounded-lg transition-all shadow-sm flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              "Sign Up"
            )}
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-accent hover:text-accent/80 font-medium transition-colors"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
