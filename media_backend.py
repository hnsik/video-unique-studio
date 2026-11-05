"""Download routing and isolated CLI workers (also used by the frozen Windows app)."""
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

MARKER = 'VDS_FILE:'
IMAGES = ('jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'gif')


def dispatch_cli():
    if len(sys.argv) < 2 or sys.argv[1] not in ('--gallery-worker', '--video-worker'):
        return
    mode = sys.argv.pop(1)
    if mode == '--gallery-worker':
        import gallery_dl
        gallery_dl.main()
    else:
        import yt_dlp
        yt_dlp.main()
    raise SystemExit(0)


def platform(url):
    p = urlsplit(url)
    if p.scheme not in ('https', 'http') or not p.hostname or p.username or p.password:
        raise ValueError('Введите ссылку HTTP(S) без логина и пароля в адресе.')
    host = p.hostname.lower()
    for domain, label in [('instagram.com', 'instagram'), ('facebook.com', 'facebook'), ('fb.watch', 'facebook')]:
        if host == domain or host.endswith('.' + domain):
            return label
    return 'other'


def route(url, media):
    site = platform(url)
    if media not in ('all', 'photos', 'videos'):
        raise ValueError('Неизвестный тип загрузки.')
    p = urlsplit(url)
    if site == 'instagram':
        import re
        if not re.search(r'/(?:p|reel|reels|tv|share)/', p.path):
            raise ValueError('Instagram: нужна ссылка на публикацию или Reels, не на профиль.')
        return 'gallery' if media != 'videos' else 'video'
    if site == 'facebook':
        photo = 'fbid' in parse_qs(p.query) or '/photos/' in p.path or '/media/set/' in p.path
        if media == 'photos' and not photo:
            raise ValueError('Facebook: откройте фото и скопируйте прямую ссылку (photo/?fbid=…) или ссылку альбома.')
        if media == 'photos' or photo:
            if media == 'videos':
                raise ValueError('Это ссылка на фото. Выберите «Фото» или «Всё».')
            return 'gallery'
        if not (p.path.strip('/') or 'v' in parse_qs(p.query)):
            raise ValueError('Facebook: нужна ссылка на конкретную публикацию.')
    if media == 'photos':
        raise ValueError('Режим фото поддерживает ссылки Instagram и Facebook.')
    return 'video'


def command(url, folder, cookies='', quality='best', media='all'):
    engine = route(url, media)
    if getattr(sys, 'frozen', False):
        cmd = [sys.executable, '--gallery-worker' if engine == 'gallery' else '--video-worker']
    else:
        cmd = [sys.executable, '-u', '-m', 'gallery_dl' if engine == 'gallery' else 'yt_dlp']
    if engine == 'gallery':
        # Explicit configuration only; no user hooks or postprocessors are executed.
        cmd += ['--config-ignore', '--no-input', '--no-colors', '--windows-filenames',
                '-d', str(Path(folder).resolve()), '--retries', '3', '--http-timeout', '30',
                '--Print', 'after:' + MARKER + '{_path}',
                '--Print', 'skip:' + MARKER + '{_path}',
                '-o', 'extractor.instagram.videos=true', '-o', 'extractor.facebook.videos=false']
        if media == 'photos':
            cmd += ['--filter', 'extension.lower() in ' + repr(IMAGES)]
        if cookies:
            cmd += ['--cookies', cookies]
    else:
        if quality not in ('best', '2160', '1440', '1080', '720', '480'):
            raise ValueError('Неизвестное качество.')
        fmt = ('bestvideo+bestaudio/best' if quality == 'best' else
               f'bestvideo[height<={quality}]+bestaudio/best[height<={quality}]')
        cmd += ['--ignore-config', '--no-playlist', '--newline', '--no-colors',
                '--windows-filenames', '--retries', '3', '--socket-timeout', '30',
                '--format', fmt, '--merge-output-format', 'mp4',
                '--output', str(Path(folder).resolve() / '%(title).150B [%(id)s].%(ext)s'),
                '--print', 'after_move:' + MARKER + '%(filepath)s', '--no-simulate']
        if cookies:
            cmd += ['--cookies', cookies]
    return cmd + ['--', url]


def facebook_retry(url, engine, code, found, output):
    return (engine == 'video' and platform(url) == 'facebook' and code != 0
            and found == 0 and 'cannot parse data' in output.lower())


def browser_command(args):
    # Preserve the supplied cookies and URL. One bounded compatibility retry.
    return args[:-2] + ['--impersonate', 'chrome-99'] + args[-2:]


def explain_error(engine, output=''):
    lower = output.lower()
    if '[facebook]' in lower and 'cannot parse data' in lower:
        return ('Facebook не предоставил загрузчику распознаваемые данные ролика. '
                'Проверьте воспроизведение в браузере и выберите актуальный cookies.txt именно от Facebook. '
                'Если ролик открывается, а ошибка остаётся, обработчик Facebook пока несовместим с этой страницей. '
                'FFmpeg к этой ошибке не относится.')
    if 'sign in to confirm your age' in lower:
        return 'YouTube требует аккаунт с доступом по возрасту. Выберите свежие cookies YouTube из аккаунта, где ролик воспроизводится.'
    if 'removed by the uploader' in lower:
        return 'YouTube сообщает, что ролик удалён автором. Проверьте доступность ссылки в браузере.'
    if 'ffmpeg' in lower and ('not found' in lower or 'not installed' in lower):
        return 'Не найден FFmpeg. Для EXE-версии восстановите установку программы.'
    if engine == 'gallery':
        return ('Фото не получены. Проверьте доступ и cookies. Для Facebook используйте прямую ссылку открытой фотографии или альбома.')
    return 'Видео не получено. Проверьте сообщение загрузчика выше, доступ к ролику и актуальность cookies нужного сайта.'
