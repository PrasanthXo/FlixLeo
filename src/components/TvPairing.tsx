import React, { useEffect, useState } from 'react';
import { cloudApproveTvPair, cloudSignInTv, type CloudUser } from '../lib/cloudSync';

type Pair = { id: string; secret: string; url: string; expiresIn: number };

export function TvSignIn({ onSignedIn, onCancel }: { onSignedIn: (user: CloudUser) => void; onCancel: () => void }) {
  const [pair, setPair] = useState<Pair | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [seconds, setSeconds] = useState(300);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let clock: ReturnType<typeof setInterval> | undefined;
    setLoading(true); setPair(null); setError('');
    (async () => {
      try {
        const response = await fetch('/api/tv/pair', { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not start TV sign-in.');
        if (stopped) return;
        setPair(data); setSeconds(data.expiresIn || 300); setLoading(false);
        interval = setInterval(async () => {
          if (stopped) return;
          try {
            const check = await fetch('/api/tv/pair/' + encodeURIComponent(data.id), {
              headers: { 'x-tv-pair-secret': data.secret }, cache: 'no-store'
            });
            const result = await check.json();
            if (stopped) return;
            if (result.status === 'approved' && result.tokenHash) {
              if (interval) clearInterval(interval);
              const user = await cloudSignInTv(result.tokenHash);
              if (result.deviceId) localStorage.setItem('flixleo_tv_device_id', result.deviceId);
              if (!stopped) onSignedIn(user);
            } else if (result.status === 'expired') {
              if (interval) clearInterval(interval);
              setError('Code expired. Select New code.');
            }
          } catch (e) {
            if (!stopped) setError(e instanceof Error ? e.message : 'Could not sign in on TV.');
          }
        }, 3500);
        clock = setInterval(() => setSeconds(s => Math.max(0, s - 1)), 1000);
      } catch (e) {
        if (!stopped) { setLoading(false); setError(e instanceof Error ? e.message : 'Cannot connect TV.'); }
      }
    })();
    return () => { stopped = true; if (interval) clearInterval(interval); if (clock) clearInterval(clock); };
  }, [attempt]);
  return <div className="space-y-4 text-center">
    <h3 className="text-xl sm:text-2xl font-bold text-white">Sign in on your TV</h3>
    <p className="text-slate-300 text-sm">Scan with your phone, sign in if needed, then approve this TV.</p>
    {loading ? <p className="text-amber-300 py-8">Creating secure sign-in code…</p> : pair && !error ? <>
      <div className="bg-white rounded-2xl p-3 w-56 h-56 mx-auto">
        <img className="w-full h-full" alt="Scan to sign in to FlixLeo on TV" src={'https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=' + encodeURIComponent(pair.url)} />
      </div>
      <p className="text-sm text-slate-300">Or open <strong className="text-white">flixleo.cyou</strong> on your phone and scan the QR code.</p>
      <p className="text-amber-300 font-bold">Expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</p>
      <p className="text-xs text-slate-400">Waiting for approval on your phone…</p>
    </> : null}
    {error && <p role="alert" className="text-rose-300">{error}</p>}
    <div className="flex gap-2"><button type="button" onClick={() => setAttempt(x => x + 1)} className="flex-1 rounded-xl bg-amber-500 p-3 font-bold text-black">New code</button>
      <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-white/20 p-3 font-semibold text-white">Other sign-in</button></div>
  </div>;
}

export function TvPairApproval({ id, user, onComplete }: { id: string; user: CloudUser; onComplete: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  return <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
    <h3 className="font-bold text-lg text-white">Connect your TV?</h3>
    <p className="text-sm text-slate-200">Approve this request only if you are signing in on a TV in front of you.</p>
    <p className="text-xs text-slate-400">Account: {user.email}</p>
    {done ? <><p role="status" className="text-green-300">TV approved. Your TV should sign in automatically.</p><button type="button" onClick={onComplete} className="text-white underline">Done</button></> :
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await cloudApproveTvPair(id); setDone(true); }
        catch (e) { setError(e instanceof Error ? e.message : 'Approval failed'); }
        finally { setBusy(false); }
      }} className="w-full bg-amber-500 text-black rounded-xl p-3 font-bold disabled:opacity-50">{busy ? 'Connecting…' : 'Approve TV sign-in'}</button>}
    {error && <p role="alert" className="text-rose-300 text-sm">{error}</p>}
  </div>;
}
