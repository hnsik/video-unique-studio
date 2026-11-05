import os
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
from PySide6.QtWidgets import QApplication
from app import DownloadWorker, Window

class WorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_queue_continues_after_failed_link(self):
        w = DownloadWorker(['https://bad.test/a', 'https://good.test/b'], '.', '', 'best', 'all')
        done = []
        w.finished_result.connect(lambda ok, msg: done.append((ok, msg)))
        def fake(url, *args):
            return [sys.executable, '-c', 'raise SystemExit(1)' if 'bad.' in url else "print('VDS_FILE:ok.mp4')"]
        with patch('app.command', side_effect=fake):
            w.run()
        self.assertFalse(done[0][0])
        self.assertIn('Обработано ссылок: 1; ошибок: 1; файлов: 1', done[0][1])

    def test_cancel_subprocess(self):
        w = DownloadWorker(['https://example.test/a'], '.', '', 'best', 'all')
        with patch('app.command', return_value=[sys.executable, '-c', 'import time; time.sleep(60)']):
            w.start()
            deadline = time.monotonic() + 3
            while w.process is None and time.monotonic() < deadline:
                time.sleep(.01)
            w.cancel()
            self.assertTrue(w.wait(3000))

    def test_ui(self):
        window = Window()
        self.assertEqual(window.media.count(), 3)
        self.assertFalse(window.stop.isEnabled())
        window.show()
        self.app.processEvents()
        window.close()

if __name__ == '__main__': unittest.main()
