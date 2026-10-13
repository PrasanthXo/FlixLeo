import React, { useEffect, useState } from 'react';
import { Maximize2, Minimize2, Pause, Play, RotateCcw, RotateCw, Subtitles, Volume2, VolumeX, X } from 'lucide-react';
import { desktopBridge, fullLanguage, type NativeTrack } from './DesktopNativeSurface';

const clock = (seconds: number): string => {
  const n = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60]
    .map((value, index) => index === 0 ? String(value) : String(value).padStart(2, '0'))
    .filter((_, index) => index !== 0 || n >= 3600)
    .join(':');
};

/**
 * mpv is a real Win32 child HWND, so HTML controls cannot overlap the
 * video. The embedding helper reserves exactly 96 physical pixels along
 * the bottom of the fullscreen window for this clickable HTML toolbar.
 */
export function DesktopFullscreenControls({ title, onClose }: { title: string; onClose: () => void }) {
  const [tracks, setTracks] = useState<{ audio: NativeTrack[]; subtitles: NativeTrack[] }>({ audio: [], subtitles: [] });
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    let mounted = true;
    const update = () => {
      void bridge.playbackStatus?.().then(status => {
        if (mounted && status.ready && Number.isFinite(status.position)) setPosition(status.position!);
      }).catch(() => {});
      void bridge.durationNative?.().then(seconds => {
        if (mounted && Number.isFinite(seconds)) setDuration(Math.max(0, seconds));
      }).catch(() => {});
      void bridge.tracksNative?.().then(value => {
        if (mounted && value) setTracks(value);
      }).catch(() => {});
    };
    update();
    const timer = window.setInterval(update, 1800);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);
  const command = (action: Parameters<NonNullable<ReturnType<typeof desktopBridge>>['commandNative']>[0], value?: number) =>
    void desktopBridge()?.commandNative(action, value);
  const close = async () => {
    try { await desktopBridge()?.commandNative('toggleFullscreen'); }
    finally { onClose(); }
  };
  return <div className="absolute bottom-0 left-0 right-0 z-[200] flex h-[96px] flex-col border-t border-white/15 bg-[#101521] text-white shadow-[0_-8px_25px_rgba(0,0,0,0.6)]" role="toolbar" aria-label="Windows fullscreen video controls">
    <div className="flex h-[32px] shrink-0 items-center gap-3 px-4">
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100" title={title}>{title}</span>
      <label className="flex max-w-[190px] shrink-0 items-center gap-1 text-xs text-slate-200" title="Audio language">
        <Volume2 size={14} aria-hidden="true" />
        <select aria-label="Audio language" disabled={!tracks.audio.length} value={tracks.audio.find(t => t.selected)?.id ?? ''} onChange={e => command('setAudioTrack', Number(e.target.value))} className="min-w-0 max-w-[160px] rounded bg-slate-800 px-2 py-1 text-xs text-white disabled:opacity-60">
          {!tracks.audio.length && <option value="">Audio tracks</option>}
          {tracks.audio.map(track => <option key={track.id} value={track.id}>{fullLanguage(track.language, track.title)}</option>)}
        </select>
      </label>
      <label className="flex max-w-[190px] shrink-0 items-center gap-1 text-xs text-slate-200" title="Subtitle language">
        <Subtitles size={14} aria-hidden="true" />
        <select aria-label="Subtitle language" value={tracks.subtitles.find(t => t.selected)?.id ?? 'off'} onChange={e => e.target.value === 'off' ? command('disableSubtitles') : command('setSubtitleTrack', Number(e.target.value))} className="min-w-0 max-w-[160px] rounded bg-slate-800 px-2 py-1 text-xs text-white">
          <option value="off">Subtitles off</option>
          {tracks.subtitles.map(track => <option key={track.id} value={track.id}>{fullLanguage(track.language, track.title)}</option>)}
        </select>
      </label>
    </div>
    <div className="flex h-[14px] shrink-0 items-center gap-2 px-4">
      <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-slate-300">{clock(position)}</span>
      <input type="range" aria-label="Seek video" min="0" max={Math.max(1, duration)} step="1" value={Math.min(position, Math.max(1, duration))} disabled={!duration} onChange={e => { const next = Number(e.target.value); setPosition(next); command('seekTo', next); }} className="min-w-0 flex-1 accent-amber-400 disabled:opacity-40" />
      <span className="w-10 shrink-0 text-[10px] tabular-nums text-slate-300">{duration ? clock(duration) : '--:--'}</span>
    </div>
    <div className="flex h-[50px] shrink-0 items-center justify-center gap-3 px-4">
      <button type="button" aria-label="Rewind 10 seconds" title="Rewind 10s" onClick={() => command('seekBackward')} className="rounded-lg p-2 hover:bg-white/10"><RotateCcw size={18}/></button>
      <button type="button" aria-label={paused ? 'Play' : 'Pause'} title="Play / Pause" onClick={() => { command('togglePause'); setPaused(p => !p); }} className="rounded-full bg-amber-400 p-2 text-black hover:bg-amber-300">{paused ? <Play size={19} fill="currentColor" /> : <Pause size={19} fill="currentColor" />}</button>
      <button type="button" aria-label="Forward 10 seconds" title="Forward 10s" onClick={() => command('seekForward')} className="rounded-lg p-2 hover:bg-white/10"><RotateCw size={18}/></button>
      <span className="mx-1 h-5 w-px bg-white/15" />
      <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'} onClick={() => { command('toggleMute'); setMuted(m => !m); }} className="rounded-lg p-2 hover:bg-white/10">{muted ? <VolumeX size={18}/> : <Volume2 size={18}/>}</button>
      <input aria-label="Volume" title="Volume" type="range" min="0" max="100" value={volume} onChange={e => { const next = Number(e.target.value); setVolume(next); command('setVolume', next); }} className="w-20 accent-amber-400"/>
      <span className="mx-1 h-5 w-px bg-white/15" />
      <button type="button" title="Exit fullscreen (F11)" aria-label="Exit fullscreen" onClick={() => command('toggleFullscreen')} className="rounded-lg p-2 hover:bg-white/10"><Minimize2 size={20}/></button>
      <button type="button" title="Close player" aria-label="Close player" onClick={() => void close()} className="rounded-lg p-2 hover:bg-red-500/20"><X size={21}/></button>
    </div>
  </div>;
}
