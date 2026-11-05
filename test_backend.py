import functools
import http.server
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from media_backend import command, route, platform, MARKER, facebook_retry, browser_command, explain_error


class RoutingTests(unittest.TestCase):
    def test_facebook_retry(self):
        url = 'https://www.facebook.com/reel/123'
        error = 'ERROR: [facebook] 123: Cannot parse data'
        self.assertTrue(facebook_retry(url, 'video', 1, 0, error))
        for code, found, msg in [(0, 1, error), (1, 1, error), (1, 0, 'Private video')]:
            self.assertFalse(facebook_retry(url, 'video', code, found, msg))
        self.assertFalse(facebook_retry('https://youtube.com/watch?v=x', 'video', 1, 0, error))
        args = command(url, '.', 'facebook cookies.txt')
        retry = browser_command(args)
        self.assertEqual(retry[-2:], ['--', url])
        self.assertEqual(retry[retry.index('--cookies')+1], 'facebook cookies.txt')
        self.assertIn('chrome-99', retry)
        self.assertIn('FFmpeg к этой ошибке не относится', explain_error('video', error))

    def test_browser_transport_available(self):
        import yt_dlp
        from yt_dlp.networking.impersonate import ImpersonateTarget
        with yt_dlp.YoutubeDL({'quiet': True, 'impersonate': ImpersonateTarget.from_str('chrome-99')}) as ydl:
            self.assertTrue(ydl._impersonate_target_available(ImpersonateTarget.from_str('chrome-99')))

    def test_routes(self):
        self.assertEqual(route('https://www.instagram.com/p/ABC/', 'all'), 'gallery')
        self.assertEqual(route('https://www.instagram.com/p/ABC/', 'photos'), 'gallery')
        self.assertEqual(route('https://www.instagram.com/reel/ABC/', 'videos'), 'video')
        self.assertEqual(route('https://www.facebook.com/photo/?fbid=123', 'all'), 'gallery')
        self.assertEqual(route('https://m.facebook.com/media/set/?set=a.123', 'photos'), 'gallery')
        self.assertEqual(route('https://www.facebook.com/reel/123', 'all'), 'video')
        self.assertEqual(route('https://fb.watch/abc/', 'videos'), 'video')
        self.assertEqual(platform('https://instagram.com.example.org/a'), 'other')
        for url, mode in [('file:///x', 'all'), ('https://instagram.com/user/', 'all'),
                          ('https://facebook.com/user', 'photos'), ('https://youtube.com/x', 'photos')]:
            with self.assertRaises(ValueError): route(url, mode)

    def test_commands(self):
        args = command('https://instagram.com/p/ABC/', '.', 'cookies with spaces.txt', media='photos')
        self.assertIn('--filter', args)
        self.assertEqual(args[args.index('--cookies') + 1], 'cookies with spaces.txt')
        self.assertEqual(args[-2], '--')
        with patch.object(sys, 'frozen', True, create=True):
            self.assertEqual(command('https://facebook.com/reel/123', '.')[1], '--video-worker')
            self.assertEqual(command('https://instagram.com/p/ABC/', '.')[1], '--gallery-worker')

    def test_installed_extractors(self):
        from gallery_dl import extractor
        from yt_dlp.extractor import gen_extractor_classes
        for url in ('https://www.instagram.com/p/ABC/', 'https://www.facebook.com/photo/?fbid=123',
                    'https://www.facebook.com/media/set/?set=a.123'):
            self.assertIsNotNone(extractor.find(url))
        self.assertTrue(any(cls.suitable('https://www.facebook.com/reel/1234567890')
                            for cls in gen_extractor_classes() if cls.IE_NAME != 'generic'))

    def test_actual_download_engines(self):
        # Real engine downloads against a local fixture, without platform login.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'image.jpg').write_bytes(b'\xff\xd8\xff\xe0fixture\xff\xd9')
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:d=0.2',
                            '-c:v', 'libx264', str(root / 'clip.mp4')], check=True)
            class Quiet(http.server.SimpleHTTPRequestHandler):
                def log_message(self, *args): pass
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=temp))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base = f'http://127.0.0.1:{server.server_port}'
                args = command('https://instagram.com/p/ABC/', str(root / 'photos'), media='photos')
                args[-1] = base + '/image.jpg'
                run = subprocess.run(args, capture_output=True, text=True, timeout=30)
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertIn(MARKER, run.stdout)
                self.assertEqual(len(list((root / 'photos').rglob('*.jpg'))), 1)
                repeat = subprocess.run(args, capture_output=True, text=True, timeout=30)
                self.assertIn(MARKER, repeat.stdout)  # Existing-file event
                args[-1] = base + '/clip.mp4'
                filtered = subprocess.run(args, capture_output=True, text=True, timeout=30)
                self.assertEqual(filtered.returncode, 0, filtered.stderr)
                self.assertNotIn(MARKER, filtered.stdout)
                self.assertFalse(list((root / 'photos').rglob('*.mp4')))
                args = command(base + '/clip.mp4', str(root / 'videos'), media='videos')
                run = subprocess.run(args, capture_output=True, text=True, timeout=30)
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertIn(MARKER, run.stdout)
                self.assertEqual(len(list((root / 'videos').rglob('*.mp4'))), 1)
            finally:
                server.shutdown()
                server.server_close()

if __name__ == '__main__':
    unittest.main()
