import React, { useEffect, useState } from 'react';
import {
  Youtube,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
  PlugZap,
} from 'lucide-react';
import {
  fetchYoutubeMusicStatus,
  saveDownloaderConfig,
  testDownloader,
  YtmStatus,
} from '../../lib/ytmusic/youtubeMusic.js';

const FORMAT_OPTIONS = [
  { value: 'mp3', label: 'MP3 (widely compatible)' },
  { value: 'opus', label: 'Opus (smallest size)' },
  { value: 'best', label: 'Best available' },
];

export const YoutubeMusicCard: React.FC = () => {
  const [status, setStatus] = useState<YtmStatus | null>(null);
  const [downloaderUrl, setDownloaderUrl] = useState('');
  const [downloaderKey, setDownloaderKey] = useState('');
  const [audioFormat, setAudioFormat] = useState('mp3');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const loadStatus = async () => {
    setIsRefreshing(true);
    const s = await fetchYoutubeMusicStatus();
    if (s) {
      setStatus(s);
      setDownloaderUrl(s.downloader.url || '');
      setAudioFormat(s.downloader.audioFormat === 'm4a' ? 'mp3' : s.downloader.audioFormat || 'mp3');
    }
    setIsRefreshing(false);
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const saveCurrentConfig = () => saveDownloaderConfig({
    enabled: Boolean(downloaderUrl.trim()),
    url: downloaderUrl.trim(),
    apiKey: downloaderKey.trim() || undefined,
    audioFormat,
  });

  const handleTest = async () => {
    setIsTesting(true);
    setMessage(null);
    try {
      await saveCurrentConfig();
      const result = await testDownloader();
      setMessage({ type: result.ok ? 'ok' : 'error', text: result.message });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Downloader test failed.' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await saveCurrentConfig();
      setStatus(previous => ({ searchAvailable: previous?.searchAvailable ?? true, downloader: result }));
      setMessage({ type: 'ok', text: 'Saved for this server instance. On Vercel, use COBALT_API_URL in project environment variables and redeploy to keep this setting across restarts.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not save downloader settings.' });
    } finally {
      setIsSaving(false);
    }
  };

  const configured = status?.downloader.configured ?? false;

  return (
    <section className="p-6 rounded-3xl bg-zinc-900/50 border border-zinc-800/80 shadow-xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
              configured
                ? 'bg-red-500/10 text-red-400 border-red-500/20 shadow-lg shadow-red-500/5'
                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
            }`}
          >
            <Youtube className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>YouTube Music Integration</span>
              {configured ? (
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/50 font-medium">
                  Downloader Ready
                </span>
              ) : (
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800/50 font-medium">
                  Fallback Mode
                </span>
              )}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Search the YouTube Music catalog and keep songs offline in browser storage
              (IndexedDB quota). Audio downloads route through your third-party downloader.
            </p>
          </div>
        </div>

        <button
          onClick={loadStatus}
          className="p-2 text-zinc-400 hover:text-white rounded-xl bg-zinc-800 hover:bg-zinc-700 transition"
          title="Refresh integration status"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {message && (
        <div
          className={`flex items-start gap-2 p-3 rounded-xl text-xs ${
            message.type === 'ok'
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
              : 'bg-rose-500/10 border border-rose-500/20 text-rose-300'
          }`}
        >
          {message.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5">
            Downloader API endpoint (Cobalt-compatible)
          </label>
          <input
            type="url"
            value={downloaderUrl}
            onChange={(e) => setDownloaderUrl(e.target.value)}
            placeholder="https://my-cobalt-instance.example.com/"
            className="w-full px-3.5 py-2.5 bg-zinc-950/70 border border-zinc-800 focus:border-red-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-hidden transition"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5">
              API key (optional)
            </label>
            <input
              type="password"
              value={downloaderKey}
              onChange={(e) => setDownloaderKey(e.target.value)}
              placeholder="Only if your instance requires one"
              className="w-full px-3.5 py-2.5 bg-zinc-950/70 border border-zinc-800 focus:border-red-500 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-hidden transition"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5">
              Preferred audio format
            </label>
            <select
              value={audioFormat}
              onChange={(e) => setAudioFormat(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-zinc-950/70 border border-zinc-800 focus:border-red-500 rounded-xl text-sm text-zinc-100 focus:outline-hidden transition"
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving || isTesting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-lg shadow-red-600/20 transition active:scale-95 disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{isSaving ? 'Saving...' : 'Save Downloader'}</span>
          </button>

          <button
            onClick={handleTest}
            disabled={isSaving || isTesting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-semibold border border-zinc-700 transition active:scale-95 disabled:opacity-50"
          >
            {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
            <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
          </button>

          <a
            href="https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            How to run your own Cobalt instance
          </a>
        </div>
      </div>

      <div className="text-[11px] text-zinc-500 space-y-1.5 leading-relaxed border-t border-zinc-800/80 pt-4">
        <p>
          <span className="text-zinc-300 font-semibold">How it works:</span> Search results stream
          directly through this server. When you press the download icon, Sonora asks your
          configured downloader for the audio file and stores the bytes in the browser's
          IndexedDB offline quota (visible under Offline Storage below).
        </p>
        <p>
          <span className="text-zinc-300 font-semibold">Fallback mode:</span> with no downloader
          configured, downloads use the built-in audio resolver. A self-hosted Cobalt instance is
          recommended for best reliability and format choices.
        </p>
        <p className="text-zinc-600">
          Note: only download content you have the right to keep. Respect YouTube's Terms of
          Service and applicable copyright law.
        </p>
      </div>
    </section>
  );
};
