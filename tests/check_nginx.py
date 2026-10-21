"""Validate the shipped example with temporary self-signed certificates; never reload Nginx."""
import shutil
import subprocess
import tempfile
from pathlib import Path


with tempfile.TemporaryDirectory(prefix='translate-nginx-') as folder:
    root = Path(folder)
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                    '-keyout', str(root / 'privkey.pem'), '-out', str(root / 'fullchain.pem'),
                    '-days', '1', '-subj', '/CN=app.example.com'], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    config = (Path(__file__).resolve().parents[1] / 'deploy/nginx.conf').read_text()
    config = config.replace('/etc/translate-rt/tls/', str(root) + '/')
    config = config.replace('/var/log/nginx/translate-rt-access.log', str(root / 'access.log'))
    config = config.replace('/tmp/translate-rt-nginx.pid', str(root / 'nginx.pid'))
    config_path = root / 'nginx.conf'
    config_path.write_text(config)
    subprocess.run([shutil.which('nginx') or '/usr/sbin/nginx', '-t', '-c', str(config_path)], check=True)
