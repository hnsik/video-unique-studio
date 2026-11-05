import os
import sys
from pathlib import Path
BUNDLE = Path(getattr(sys, '_MEIPASS', Path(__file__).parent))
if (BUNDLE / 'ffmpeg.exe').is_file():
    os.environ['PATH'] = str(BUNDLE) + os.pathsep + os.environ.get('PATH', '')
from media_backend import dispatch_cli
dispatch_cli()

import os
import subprocess
import threading
from media_backend import command, route, explain_error, MARKER
import sys
from pathlib import Path
from PySide6.QtCore import QThread, Signal
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton, QFileDialog, QComboBox, QTextEdit, QMessageBox, QProgressBar, QCheckBox)

class DownloadWorker(QThread):
    log = Signal(str)
    progress = Signal(int)
    finished_result = Signal(bool, str)
    def __init__(self, urls, folder, cookies, quality, media):
        super().__init__()
        self.urls, self.folder, self.cookies, self.quality, self.media = urls, folder, cookies, quality, media
        self.cancelled = threading.Event()
        self.process = None
    def cancel(self):
        self.cancelled.set()
        p = self.process
        if p and p.poll() is None:
            if sys.platform == 'win32':
                subprocess.run(['taskkill', '/PID', str(p.pid), '/T', '/F'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=subprocess.CREATE_NO_WINDOW)
            else:
                p.terminate()
    def run(self):
        errors = completed = files = 0
        for i, url in enumerate(self.urls, 1):
            if self.cancelled.is_set():
                break
            self.log.emit(f'[{i}/{len(self.urls)}] {url}')
            try:
                engine = route(url, self.media)
                args = command(url, self.folder, self.cookies, self.quality, self.media)
                env = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1')
                found = 0
                self.process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding='utf-8', errors='replace', env=env,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
                if self.cancelled.is_set():
                    self.cancel()
                for line in self.process.stdout:
                    line = line.strip()
                    if line.startswith(MARKER):
                        found += 1
                        self.log.emit('Файл готов / уже скачан: ' + line[len(MARKER):])
                    elif line:
                        self.log.emit(line)
                code = self.process.wait()
                self.process.stdout.close()
                self.process = None
                files += found
                if self.cancelled.is_set():
                    break
                if code or not found:
                    raise RuntimeError(explain_error(engine))
                completed += 1
            except Exception as exc:
                errors += 1
                self.log.emit('Ошибка: ' + str(exc))
            self.progress.emit(int(i * 100 / len(self.urls)))
        if self.cancelled.is_set():
            self.finished_result.emit(False, f'Остановлено. Готовых файлов: {files}.')
        else:
            self.finished_result.emit(errors == 0, f'Обработано ссылок: {completed}; ошибок: {errors}; файлов: {files}.')

class Window(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle('Video Downloader Studio 1.1 — Instagram / Facebook')
        self.setWindowIcon(QIcon(str(BUNDLE / 'app.ico')))
        self.resize(760, 610)
        self.setStyleSheet('QWidget { font-size: 13px; } QPushButton { padding: 8px; } QLineEdit, QTextEdit, QComboBox { padding: 6px; }')
        root = QVBoxLayout(self)
        title = QLabel('Video Downloader Studio')
        title.setStyleSheet('font-size: 23px; font-weight: bold;')
        root.addWidget(title)
        root.addWidget(QLabel('Ссылки на видео, Reels, фото или карусели (по одной в строке):'))
        self.urls = QTextEdit()
        self.urls.setPlaceholderText('https://www.instagram.com/p/…\nhttps://www.facebook.com/reel/…\nhttps://www.facebook.com/photo/?fbid=…')
        self.urls.setMaximumHeight(105)
        root.addWidget(self.urls)
        self.media = QComboBox()
        for label, value in [('Всё: фото и видео', 'all'), ('Только видео / Reels', 'videos'), ('Только фото', 'photos')]:
            self.media.addItem(label, value)
        root.addWidget(self.media)
        hint = QLabel('Instagram: публикации и карусели. Facebook: видео, Reels, прямые ссылки на фото и альбомы.\nДля фото внутри поста Facebook откройте фотографию и скопируйте её адрес. Качество фото — исходное.')
        hint.setWordWrap(True)
        root.addWidget(hint)
        quality_row = QHBoxLayout()
        quality_row.addWidget(QLabel('Качество:'))
        self.quality = QComboBox()
        for label, value in [('Лучшее доступное', 'best'), ('До 2160p (4K)', '2160'), ('До 1440p', '1440'), ('До 1080p', '1080'), ('До 720p', '720'), ('До 480p', '480')]:
            self.quality.addItem(label, value)
        quality_row.addWidget(self.quality)
        root.addLayout(quality_row)
        root.addWidget(QLabel('Cookies (Netscape cookies.txt, необязательно):'))
        cookie_row = QHBoxLayout()
        self.cookie = QLineEdit()
        self.cookie.setReadOnly(True)
        cookie_row.addWidget(self.cookie)
        pick_cookie = QPushButton('Выбрать cookies.txt')
        pick_cookie.clicked.connect(self.select_cookie)
        cookie_row.addWidget(pick_cookie)
        clear_cookie = QPushButton('Очистить')
        clear_cookie.clicked.connect(self.cookie.clear)
        cookie_row.addWidget(clear_cookie)
        root.addLayout(cookie_row)
        root.addWidget(QLabel('Папка загрузки:'))
        folder_row = QHBoxLayout()
        self.folder = QLineEdit(str(Path.home() / 'Downloads'))
        folder_row.addWidget(self.folder)
        pick_folder = QPushButton('Выбрать папку')
        pick_folder.clicked.connect(self.select_folder)
        folder_row.addWidget(pick_folder)
        root.addLayout(folder_row)
        self.consent = QCheckBox('У меня есть право скачивать выбранные материалы')
        root.addWidget(self.consent)
        self.start = QPushButton('Скачать')
        self.start.clicked.connect(self.download)
        root.addWidget(self.start)
        self.stop = QPushButton('Остановить')
        self.stop.setEnabled(False)
        self.stop.clicked.connect(lambda: self.worker.cancel())
        root.addWidget(self.stop)
        self.bar = QProgressBar()
        root.addWidget(self.bar)
        root.addWidget(QLabel('Журнал:'))
        self.log = QTextEdit()
        self.log.setReadOnly(True)
        root.addWidget(self.log)
        open_folder = QPushButton('Открыть папку загрузок')
        open_folder.clicked.connect(self.open_folder)
        root.addWidget(open_folder)
    def select_cookie(self):
        path, _ = QFileDialog.getOpenFileName(self, 'Выберите Netscape cookies.txt', '', 'Text (*.txt);;All files (*)')
        if path:
            self.cookie.setText(path)
    def select_folder(self):
        path = QFileDialog.getExistingDirectory(self, 'Папка загрузок', self.folder.text())
        if path:
            self.folder.setText(path)
    def open_folder(self):
        path = Path(self.folder.text())
        path.mkdir(parents=True, exist_ok=True)
        os.startfile(str(path)) if sys.platform == 'win32' else None
    def download(self):
        urls = [x.strip() for x in self.urls.toPlainText().splitlines() if x.strip()]
        if not urls or any(not u.startswith(('https://', 'http://')) for u in urls):
            QMessageBox.warning(self, 'Ошибка', 'Введите корректные HTTP(S) ссылки, по одной на строке.')
            return
        if not self.consent.isChecked():
            QMessageBox.warning(self, 'Подтверждение', 'Подтвердите право скачивать выбранные материалы.')
            return
        if self.cookie.text() and not Path(self.cookie.text()).is_file():
            QMessageBox.warning(self, 'Ошибка', 'Файл cookies не найден.')
            return
        folder = Path(self.folder.text())
        try:
            folder.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            QMessageBox.warning(self, 'Папка недоступна', str(exc))
            return
        self.start.setEnabled(False)
        self.stop.setEnabled(True)
        self.log.append('Начинаем. Прогресс — по обработанным ссылкам. Для объединения видео нужен FFmpeg в PATH.')
        self.bar.setValue(0)
        self.worker = DownloadWorker(urls, str(folder), self.cookie.text(), self.quality.currentData(), self.media.currentData())
        self.worker.log.connect(self.log.append)
        self.worker.progress.connect(self.bar.setValue)
        self.worker.finished_result.connect(self.done)
        self.worker.finished.connect(lambda: (self.start.setEnabled(True), self.stop.setEnabled(False)))
        self.worker.start()
    def done(self, ok, message):
        self.log.append(('✓ ' if ok else '✗ ') + message)
        if not ok:
            QMessageBox.warning(self, 'Ошибка загрузки', message)

    def closeEvent(self, event):
        if hasattr(self, 'worker') and self.worker.isRunning():
            self.worker.cancel()
            self.log.append('Останавливаем загрузку. Закройте окно после завершения остановки.')
            event.ignore()
        else:
            event.accept()

if __name__ == '__main__' and '--self-test' in sys.argv:
    import json
    import unittest
    import test_backend
    target = Path(sys.argv[sys.argv.index('--self-test') + 1])
    suite = unittest.defaultTestLoader.loadTestsFromModule(test_backend)
    result = unittest.TextTestRunner().run(suite)
    qapp = QApplication([])
    window = Window()
    window.show()
    qapp.processEvents()
    icon_ok = not window.windowIcon().isNull()
    window.close()
    target.write_text(json.dumps({'ok': result.wasSuccessful() and icon_ok, 'tests': result.testsRun, 'icon': icon_ok}))
    sys.exit(0 if result.wasSuccessful() and icon_ok else 1)

if __name__ == '__main__':
    app = QApplication(sys.argv)
    w = Window()
    w.show()
    sys.exit(app.exec())
