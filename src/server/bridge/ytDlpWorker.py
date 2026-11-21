import sys, json, struct
import yt_dlp
raw = sys.stdout.buffer

def frame(kind, data=b''):
    if isinstance(data, str): data=data.encode('utf-8', 'replace')
    raw.write(kind + struct.pack('>I', len(data)) + data)
    raw.flush()

class AudioWriter:
    def write(self, data):
        for pos in range(0, len(data), 65536): frame(b'D', data[pos:pos+65536])
        return len(data)
    def flush(self): raw.flush()
    def isatty(self): return False
    def fileno(self): return raw.fileno()
    def close(self): pass

class Output:
    buffer=AudioWriter()
    def write(self, text): frame(b'L', text); return len(text)
    def flush(self): raw.flush()
    def isatty(self): return False
    def fileno(self): return raw.fileno()

class Logger:
    def debug(self, message): frame(b'L', message+'\n')
    def warning(self, message): frame(b'L', message+'\n')
    def error(self, message): frame(b'L', message+'\n')

def client_for(client, resolving, node, fast=True):
    key = (client, resolving, fast)
    if key not in clients:
        opts = {
            'quiet': True, 'noprogress': True, 'logtostderr': True, 'logger': Logger(),
            'noplaylist': True, 'format': 'bestaudio', 'outtmpl': '-',
            'socket_timeout': 12, 'retries': 1, 'extractor_retries': 1,
            'js_runtimes': {'node': {'path': node}},
        }
        youtube = opts.setdefault('extractor_args', {}).setdefault('youtube', {})
        if client != 'default': youtube['player_client'] = [client]
        if resolving:
            opts['format'] = 'bestaudio[ext=mp3][acodec=mp3][protocol=https]/bestaudio[ext=m4a][protocol=https]'
            youtube['skip'] = ['hls', 'dash', 'translated_subs']
            if fast:
                # Keep the watch page and player response. Skip extra catalog/config metadata.
                youtube['player_skip'] = ['configs', 'initial_data']
        clients[key] = yt_dlp.YoutubeDL(opts)
    return clients[key]


sys.stdout = Output()
clients = {}
if len(sys.argv) > 1:
    # Initialize the extractor before reporting ready. This never looks up a song.
    client_for('visionos', True, sys.argv[1]).get_info_extractor('Youtube').initialize()
frame(b'R')
for line in sys.stdin:
    try:
        job = json.loads(line)
        client = job.get('client') or 'default'
        resolving = job.get('resolveAudio', False)
        node = job['node']
        url = 'https://www.youtube.com/watch?v=' + job['videoId']
        downloader = client_for(client, resolving, node)
        if resolving:
            try:
                info = downloader.extract_info(url, download=False)
            except yt_dlp.utils.DownloadError:
                # Some uploads need the standard configuration lookup to expose AAC.
                info = client_for(client, resolving, node, fast=False).extract_info(url, download=False)
            frame(b'D', json.dumps({'url': info['url'], 'duration': info.get('duration'), 'size': info.get('filesize'), 'format': info.get('ext')}))
            code = 0
        else:
            code = downloader.download([url])
        frame(b'E', json.dumps({'code': code}))
    except Exception as error:
        frame(b'L', str(error) + '\n')
        frame(b'E', json.dumps({'code': 1}))

